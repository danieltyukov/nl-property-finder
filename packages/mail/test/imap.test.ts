import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MailSchema, memoryLogger, type InboundMessage, type OutboundEmail } from '@nlpf/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createImapMailbox, type ImapClient, type ImapMailboxOptions } from '../src/imap.js';
import type { MailSender } from '../src/smtp.js';

/* ---------- a fake IMAP server shared by every client it hands out ---------- */

interface StoredMessage {
  uid: number;
  raw: string;
  seen: boolean;
}

class FakeServer {
  uidValidity = 1111n;
  nextUid = 1;
  messages: StoredMessage[] = [];
  folders: { path: string; specialUse?: string }[] = [{ path: 'INBOX', specialUse: '\\Inbox' }];
  appended: { path: string; content: string; flags?: string[] }[] = [];
  failConnects = 0;
  connectAttempts: number[] = [];
  clients: FakeClient[] = [];

  add(raw: string, seen = false): number {
    const uid = this.nextUid++;
    this.messages.push({ uid, raw, seen });
    return uid;
  }

  /** New mail while a client is idling: store it and tell the live client. */
  deliver(raw: string): number {
    const uid = this.add(raw);
    for (const c of this.clients) if (c.usable) c.emit('exists', { path: 'INBOX', count: this.messages.length });
    return uid;
  }

  factory = (): ImapClient => {
    const c = new FakeClient(this);
    this.clients.push(c);
    return c as unknown as ImapClient;
  };

  get live(): FakeClient | undefined {
    return this.clients.filter((c) => c.usable).at(-1);
  }
}

class FakeClient extends EventEmitter {
  usable = false;
  mailbox: { path: string; uidValidity: bigint; uidNext: number; exists: number } | false = false;
  constructor(private server: FakeServer) {
    super();
  }
  async connect() {
    this.server.connectAttempts.push(Date.now());
    if (this.server.failConnects > 0) {
      this.server.failConnects--;
      throw new Error('connect ECONNREFUSED 127.0.0.1:993');
    }
    this.usable = true;
  }
  async mailboxOpen(path: string) {
    this.mailbox = { path, uidValidity: this.server.uidValidity, uidNext: this.server.nextUid, exists: this.server.messages.length };
    return this.mailbox;
  }
  async search(query: { uid?: string; seen?: boolean }) {
    this.alive();
    if (query.uid) {
      const from = Number(query.uid.split(':')[0]);
      const hits = this.server.messages.filter((m) => m.uid >= from).map((m) => m.uid);
      // Like a real server, "n:*" returns the highest UID even when n is above it.
      const last = this.server.messages.at(-1);
      return hits.length ? hits : last ? [last.uid] : [];
    }
    if (query.seen === false) return this.server.messages.filter((m) => !m.seen).map((m) => m.uid);
    return this.server.messages.map((m) => m.uid);
  }
  async fetchOne(uid: string) {
    this.alive();
    const m = this.server.messages.find((x) => x.uid === Number(uid));
    return m ? { seq: 1, uid: m.uid, source: Buffer.from(m.raw), internalDate: new Date('2026-09-23T08:00:00Z') } : false;
  }
  async messageFlagsAdd(range: string, flags: string[]) {
    this.alive();
    const m = this.server.messages.find((x) => x.uid === Number(range));
    if (m && flags.includes('\\Seen')) m.seen = true;
    return true;
  }
  async list() {
    return this.server.folders;
  }
  async append(path: string, content: Buffer | string, flags?: string[]) {
    this.server.appended.push({ path, content: content.toString(), flags });
    return { destination: path };
  }
  async logout() {
    this.drop();
  }
  close() {
    this.drop();
  }
  drop() {
    if (!this.usable) return;
    this.usable = false;
    this.emit('close');
  }
  private alive() {
    if (!this.usable) throw new Error('Connection not available');
  }
}

const rawMail = (id: string, from = 'landlord@example.test'): string =>
  [
    `From: Landlord <${from}>`,
    'To: agent@nlpf.test',
    `Subject: Bericht ${id}`,
    `Message-ID: <${id}@example.test>`,
    'Date: Wed, 23 Sep 2026 10:00:00 +0200',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Tekst van ${id}`,
    '',
  ].join('\r\n');

const cfg = (over: Partial<ReturnType<typeof MailSchema.parse>> = {}) =>
  MailSchema.parse({ provider: 'imap', address: 'agent@nlpf.test', imap: { host: 'imap.example.test', port: 993, secure: true }, ...over });

const fakeSender = (): MailSender & { sent: OutboundEmail[] } => {
  const sent: OutboundEmail[] = [];
  return {
    sent,
    async send(mail) {
      sent.push(mail);
      return { messageId: '<sent-1@nlpf.test>', raw: Buffer.from('Subject: x\r\n\r\nbody'), from: 'agent@nlpf.test', to: [mail.to] };
    },
    close() {},
  };
};

const settle = async (ms = 20) => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, ms / 5));
};

const opened: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  vi.useRealTimers();
  while (opened.length) await opened.pop()?.stop();
});

function setup(server: FakeServer, over: ImapMailboxOptions = {}, c = cfg()) {
  const log = memoryLogger();
  const mb = createImapMailbox(c, 'app-password', log, {
    clientFactory: server.factory,
    sender: fakeSender(),
    pollIntervalMs: 0,
    backoff: { minMs: 5, maxMs: 40 },
    ...over,
  });
  opened.push(mb);
  const got: InboundMessage[] = [];
  const onMessage = async (m: InboundMessage) => {
    got.push(m);
  };
  return { mb, got, onMessage, log };
}

describe('IMAP mailbox', () => {
  test('fetches messages above the watermark in UID order, marks them seen and moves the watermark', async () => {
    const server = new FakeServer();
    server.add(rawMail('old'), true);
    server.add(rawMail('two'));
    server.add(rawMail('three'));
    const marks: [number, string][] = [];
    const { mb, got, onMessage } = setup(server, { onWatermark: (uid, validity) => marks.push([uid, validity]) });
    mb.setWatermark(1, '1111');
    await mb.start(onMessage);
    await settle();
    expect(got.map((m) => m.id)).toEqual(['<two@example.test>', '<three@example.test>']);
    expect(server.messages.map((m) => m.seen)).toEqual([true, true, true]);
    expect(mb.watermark()).toBe(3);
    expect(mb.uidValidity()).toBe('1111');
    expect(marks.at(-1)).toEqual([3, '1111']);
    expect(mb.status()).toMatchObject({ connected: true, address: 'agent@nlpf.test' });
  });

  test('the first start takes only unread mail, then every new message the server reports', async () => {
    const server = new FakeServer();
    server.add(rawMail('read-long-ago'), true);
    server.add(rawMail('unread'));
    const { mb, got, onMessage } = setup(server);
    await mb.start(onMessage);
    await settle();
    expect(got.map((m) => m.id)).toEqual(['<unread@example.test>']);
    expect(mb.watermark()).toBe(2);
    server.deliver(rawMail('pushed'));
    await settle();
    expect(got.map((m) => m.id)).toEqual(['<unread@example.test>', '<pushed@example.test>']);
    expect(mb.watermark()).toBe(3);
  });

  test('a changed UIDVALIDITY discards the old watermark', async () => {
    const server = new FakeServer();
    server.uidValidity = 2222n;
    server.add(rawMail('a'), true);
    server.add(rawMail('b'), true);
    server.add(rawMail('c'));
    const { mb, got, onMessage } = setup(server);
    mb.setWatermark(1, '1111');
    await mb.start(onMessage);
    await settle();
    // With a stale watermark, UID 2 (already read) would have been fetched again.
    expect(got.map((m) => m.id)).toEqual(['<c@example.test>']);
    expect(mb.uidValidity()).toBe('2222');
  });

  test('restarting with the saved watermark does not deliver anything twice', async () => {
    const server = new FakeServer();
    const first = setup(server);
    await first.mb.start(first.onMessage);
    server.deliver(rawMail('one'));
    await settle();
    expect(first.got).toHaveLength(1);
    const saved = { uid: first.mb.watermark(), validity: first.mb.uidValidity() };
    await first.mb.stop();
    server.add(rawMail('while-down'));
    // Mark the first message unread again: only the watermark keeps it from coming back.
    server.messages[0]!.seen = false;
    const second = setup(server);
    second.mb.setWatermark(saved.uid, saved.validity);
    await second.mb.start(second.onMessage);
    await settle();
    expect(second.got.map((m) => m.id)).toEqual(['<while-down@example.test>']);
  });

  test('reconnects after failures with a backoff that starts at 1 s and doubles up to 60 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const server = new FakeServer();
    server.failConnects = 8;
    const { mb, onMessage } = setup(server, { backoff: undefined });
    const t0 = Date.now();
    await mb.start(onMessage);
    expect(mb.status().connected).toBe(false);
    expect(mb.status().error).toContain('ECONNREFUSED');
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 8000 + 16000 + 32000 + 60000 + 60000);
    expect(server.connectAttempts.map((t) => (t - t0) / 1000)).toEqual([0, 1, 3, 7, 15, 31, 63, 123, 183]);
    expect(mb.status().connected).toBe(true);
    expect(mb.status().error).toBeUndefined();

    // A dropped connection starts again from 1 s, and mail that arrived meanwhile is fetched.
    server.live?.drop();
    server.add(rawMail('while-dropped'));
    const before = server.connectAttempts.length;
    await vi.advanceTimersByTimeAsync(999);
    expect(server.connectAttempts.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.connectAttempts.length).toBe(before + 1);
    expect(mb.status().connected).toBe(true);
  });

  test('a failing handler keeps the message for a retry and gives up after three attempts, leaving it unread', async () => {
    const server = new FakeServer();
    server.add(rawMail('poison'));
    server.add(rawMail('fine'));
    const { mb, log } = setup(server, { pollIntervalMs: 10 });
    const calls: string[] = [];
    await mb.start(async (m) => {
      calls.push(m.id);
      if (m.id === '<poison@example.test>') throw new Error('database is locked');
    });
    await settle(120);
    expect(calls.filter((c) => c === '<poison@example.test>')).toHaveLength(3);
    expect(calls.filter((c) => c === '<fine@example.test>')).toHaveLength(1);
    expect(server.messages.map((m) => m.seen)).toEqual([false, true]);
    expect(mb.watermark()).toBe(2);
    expect(log.entries.some((e) => e.lvl === 'error' && /giving up/i.test(e.msg))).toBe(true);
  });

  test('mail from the mailbox itself is skipped', async () => {
    const server = new FakeServer();
    server.add(rawMail('own', 'agent@nlpf.test'));
    server.add(rawMail('theirs'));
    const { mb, got, onMessage } = setup(server);
    await mb.start(onMessage);
    await settle();
    expect(got.map((m) => m.id)).toEqual(['<theirs@example.test>']);
    expect(mb.watermark()).toBe(2);
  });

  test('send appends to the Sent folder, except on Gmail which files sent mail itself', async () => {
    const server = new FakeServer();
    server.folders.push({ path: 'Verzonden', specialUse: '\\Sent' });
    const sender = fakeSender();
    const { mb, onMessage } = setup(server, { sender });
    await mb.start(onMessage);
    const res = await mb.send({ to: 'jan@example.test', subject: 'Reactie', text: 'Beste Jan' });
    expect(res).toEqual({ messageId: '<sent-1@nlpf.test>' });
    expect(sender.sent).toHaveLength(1);
    expect(server.appended).toEqual([{ path: 'Verzonden', content: 'Subject: x\r\n\r\nbody', flags: ['\\Seen'] }]);

    const gmailServer = new FakeServer();
    gmailServer.folders.push({ path: '[Gmail]/Sent Mail', specialUse: '\\Sent' });
    const gmail = setup(gmailServer, { sender: fakeSender() }, cfg({ imap: { host: 'imap.gmail.com', port: 993, secure: true } }));
    await gmail.mb.start(gmail.onMessage);
    await gmail.mb.send({ to: 'jan@example.test', subject: 'Reactie', text: 'Beste Jan' });
    expect(gmailServer.appended).toEqual([]);
  });

  test('attachments are saved under the attachments folder with safe file names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nlpf-att-'));
    const server = new FakeServer();
    server.add(
      [
        'From: Makelaar <verhuur@example.test>',
        'To: agent@nlpf.test',
        'Subject: Contract',
        'Message-ID: <contract@example.test>',
        'Content-Type: multipart/mixed; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Zie bijlage.',
        '--b1',
        'Content-Type: application/pdf; name="../../.bashrc"',
        'Content-Disposition: attachment; filename="../../.bashrc"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('%PDF-1.4 fake').toString('base64'),
        '--b1--',
        '',
      ].join('\r\n'),
    );
    const { mb, got, onMessage } = setup(server, { attachmentsDir: dir });
    await mb.start(onMessage);
    await settle();
    const att = got[0]?.attachments[0];
    expect(att?.filename).toBe('../../.bashrc');
    expect(att?.path?.startsWith(dir)).toBe(true);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(readFileSync(att!.path!, 'utf8')).toBe('%PDF-1.4 fake');
  });

  test('stop waits for a handler that is still running before it closes the connection', async () => {
    const server = new FakeServer();
    server.add(rawMail('slow'));
    const { mb } = setup(server);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let finished = false;
    await mb.start(async () => {
      await gate;
      finished = true;
    });
    await settle();
    const stopping = mb.stop();
    await settle(50);
    expect(server.live).toBeDefined(); // still connected while the handler runs
    release();
    await stopping;
    expect(finished).toBe(true);
    expect(server.messages[0]!.seen).toBe(true); // marked read before the connection closed
    expect(mb.watermark()).toBe(1);
  });

  test('stop gives up waiting after stopTimeoutMs and says so', async () => {
    const server = new FakeServer();
    server.add(rawMail('stuck'));
    const { mb, log } = setup(server, { stopTimeoutMs: 30 });
    await mb.start(() => new Promise<void>(() => {}));
    await settle();
    await mb.stop();
    expect(mb.status().connected).toBe(false);
    expect(log.entries.some((e) => e.lvl === 'warn' && /still running/i.test(e.msg))).toBe(true);
  });

  test('stop logs out, and mail that arrives afterwards is not handled', async () => {
    const server = new FakeServer();
    const { mb, got, onMessage } = setup(server);
    await mb.start(onMessage);
    await mb.stop();
    expect(mb.status().connected).toBe(false);
    server.add(rawMail('late'));
    await settle();
    expect(got).toEqual([]);
    expect(server.clients.every((c) => !c.usable)).toBe(true);
  });
});

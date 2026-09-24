import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { MailSchema, memoryLogger, type InboundMessage } from '@nlpf/core';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createImapMailbox, type ImapMailbox } from '../src/imap.js';
import { parseEmail } from '../src/parse.js';

// Runs the IMAP mailbox against a real IMAP/SMTP server: GreenMail in Docker,
// on random loopback ports, removed afterwards even when a test fails.
// Needs Docker; without it this file fails rather than skipping.

const IMAGE = 'greenmail/standalone:2.1.3';
const CONTAINER = `nlpf-greenmail-${process.pid}-${randomBytes(3).toString('hex')}`;
const HOST = '127.0.0.1';
let imapPort = 0;
let smtpPort = 0;

const docker = (args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const hostPort = (containerPort: string): number => {
  const first = docker(['port', CONTAINER, containerPort]).split('\n')[0] ?? '';
  const port = Number(first.split(':').pop());
  if (!port) throw new Error(`no host port for ${containerPort}: ${first}`);
  return port;
};

const rawClient = (user: string) =>
  new ImapFlow({ host: HOST, port: imapPort, secure: false, auth: { user, pass: 'any' }, logger: false });

async function waitForServer(deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs;
  let last: unknown;
  while (Date.now() < until) {
    const c = rawClient('agent');
    try {
      await c.connect();
      await c.logout();
      return;
    } catch (err) {
      last = err;
      c.close();
      await sleep(500);
    }
  }
  throw new Error(`GreenMail did not come up: ${String(last)}`);
}

async function waitFor(check: () => boolean, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`condition not met within ${ms} ms`);
    await sleep(25);
  }
}

beforeAll(async () => {
  docker([
    'run', '-d', '--rm', '--name', CONTAINER,
    '-p', `${HOST}::3143`, '-p', `${HOST}::3025`,
    '-e', 'GREENMAIL_OPTS=-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled -Dgreenmail.users=agent:pw@nlpf.test',
    IMAGE,
  ]);
  try {
    imapPort = hostPort('3143/tcp');
    smtpPort = hostPort('3025/tcp');
    await waitForServer(60_000);
  } catch (err) {
    try {
      docker(['rm', '-f', CONTAINER]);
    } catch {
      // nothing to remove
    }
    throw err;
  }
});

afterAll(() => {
  try {
    docker(['rm', '-f', CONTAINER]);
  } catch {
    // already gone
  }
});

const mailConfig = () =>
  MailSchema.parse({
    provider: 'imap',
    address: 'agent@nlpf.test',
    user: 'agent',
    imap: { host: HOST, port: imapPort, secure: false },
    smtp: { host: HOST, port: smtpPort, secure: false },
  });

const landlordSmtp = () => createTransport({ host: HOST, port: smtpPort, secure: false });

describe('IMAP mailbox against GreenMail', () => {
  const log = memoryLogger();
  let first: ImapMailbox;
  const got: InboundMessage[] = [];

  test('a new message reaches onMessage through IDLE within 5 s', async () => {
    first = createImapMailbox(mailConfig(), 'pw', log, { pollIntervalMs: 0 });
    await first.start(async (m) => {
      got.push(m);
    });
    expect(first.status()).toMatchObject({ connected: true, address: 'agent@nlpf.test' });
    await sleep(1500); // the connection is idling now, so only a server push can deliver the next message

    const sentAt = Date.now();
    await landlordSmtp().sendMail({
      from: 'Jan de Vries <landlord@nlpf.test>',
      to: 'agent@nlpf.test',
      subject: 'Bezichtiging Oude Delft 12A',
      text: 'Kun je donderdag om 18:30 komen kijken?',
      messageId: '<greenmail-1@nlpf.test>',
    });
    await waitFor(() => got.length === 1, 5000);
    expect(Date.now() - sentAt).toBeLessThan(5000);
    expect(got[0]).toMatchObject({
      id: '<greenmail-1@nlpf.test>',
      from: { name: 'Jan de Vries', address: 'landlord@nlpf.test' },
      subject: 'Bezichtiging Oude Delft 12A',
      text: 'Kun je donderdag om 18:30 komen kijken?',
      autoSubmitted: false,
    });

    // Marked read once handled.
    await waitFor(() => first.watermark() > 0, 2000);
    const c = rawClient('agent');
    await c.connect();
    await c.mailboxOpen('INBOX');
    const msg = await c.fetchOne('*', { flags: true });
    expect(msg && msg.flags?.has('\\Seen')).toBe(true);
    await c.logout();
  });

  test('send delivers to another user with thread headers and files a copy in Sent', async () => {
    const setup = rawClient('agent');
    await setup.connect();
    await setup.mailboxCreate('Sent');
    await setup.logout();

    const { messageId } = await first.send({
      to: 'landlord@nlpf.test',
      subject: 'Re: Bezichtiging Oude Delft 12A',
      text: 'Donderdag om 18:30 past goed. Tot dan.',
      inReplyTo: got[0]!.id,
    });
    expect(messageId).toMatch(/@nlpf\.test>$/);

    const landlord = rawClient('landlord@nlpf.test');
    await landlord.connect();
    await landlord.mailboxOpen('INBOX');
    const found = await landlord.fetchAll('1:*', { source: true });
    await landlord.logout();
    const parsed = await Promise.all(found.map((m) => parseEmail(m.source!)));
    const reply = parsed.find((m) => m.id === messageId);
    expect(reply).toMatchObject({
      from: { address: 'agent@nlpf.test' },
      inReplyTo: '<greenmail-1@nlpf.test>',
      references: ['<greenmail-1@nlpf.test>'],
      text: 'Donderdag om 18:30 past goed. Tot dan.',
    });

    const agent = rawClient('agent');
    await agent.connect();
    const sent = await agent.status('Sent', { messages: true });
    await agent.logout();
    expect(sent.messages).toBe(1);
  });

  test('restarting with the saved watermark does not deliver anything twice', async () => {
    const saved = { uid: first.watermark(), validity: first.uidValidity() };
    expect(saved.uid).toBeGreaterThan(0);
    await first.stop();

    await landlordSmtp().sendMail({
      from: 'landlord@nlpf.test',
      to: 'agent@nlpf.test',
      subject: 'Nog een vraag',
      text: 'Heb je een huisdier?',
      messageId: '<greenmail-2@nlpf.test>',
    });
    // Unread again, so only the watermark keeps the first message from coming back.
    const c = rawClient('agent');
    await c.connect();
    await c.mailboxOpen('INBOX');
    await c.messageFlagsRemove('1:*', ['\\Seen']);
    await c.logout();

    const again: InboundMessage[] = [];
    const second = createImapMailbox(mailConfig(), 'pw', log, { pollIntervalMs: 0 });
    second.setWatermark(saved.uid, saved.validity);
    await second.start(async (m) => {
      again.push(m);
    });
    try {
      await waitFor(() => again.length >= 1, 5000);
      await sleep(1000);
      expect(again.map((m) => m.id)).toEqual(['<greenmail-2@nlpf.test>']);

      // An out-of-office reply is delivered like any message, marked auto-submitted.
      await landlordSmtp().sendMail({
        from: 'landlord@nlpf.test',
        to: 'agent@nlpf.test',
        subject: 'Afwezig: Re: Bezichtiging Oude Delft 12A',
        text: 'Ik ben afwezig tot maandag.',
        messageId: '<greenmail-oof@nlpf.test>',
        headers: { 'Auto-Submitted': 'auto-replied' },
      });
      await waitFor(() => again.length === 2, 5000);
      expect(again[1]).toMatchObject({ id: '<greenmail-oof@nlpf.test>', autoSubmitted: true });
    } finally {
      await second.stop();
    }
  });
});

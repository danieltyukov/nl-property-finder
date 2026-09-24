import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Attachment, Config, InboundMessage, Logger, Mailbox, MailStatus, OutboundEmail } from '@nlpf/core';
import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { simpleParser, type Attachment as ParsedAttachment } from 'mailparser';
import { toInbound } from './parse.js';
import { createSmtpSender, type MailSender } from './smtp.js';

/** The part of ImapFlow the mailbox uses, so tests can hand in a fake server. */
export type ImapClient = Pick<
  ImapFlow,
  'connect' | 'mailboxOpen' | 'search' | 'fetchOne' | 'messageFlagsAdd' | 'list' | 'append' | 'logout' | 'close' | 'on' | 'usable' | 'mailbox'
>;

export interface ImapMailboxOptions {
  /** Display name on outgoing mail, usually the profile's name. */
  fromName?: string;
  /** When set, attachments are written here and `Attachment.path` is filled in. */
  attachmentsDir?: string;
  /** Called whenever the watermark moves, so the daemon can persist it (kv). */
  onWatermark?: (uid: number, uidValidity: string) => void;
  /** Called on every status change, for the `mail.status` event. */
  onStatus?: (status: MailStatus) => void;
  /** On a first start without a watermark, unread mail from this many days back is processed. Default 2. */
  firstRunLookbackDays?: number;
  /** A catch-up sync on this interval in case a push was missed; 0 turns it off. Default 5 minutes. */
  pollIntervalMs?: number;
  /** Idle time after a command before IDLE starts. Default 1 s, so new mail is pushed within seconds. */
  autoIdleDelayMs?: number;
  /** IDLE is restarted this often, which also proves the connection is alive. Default 5 minutes. */
  maxIdleTimeMs?: number;
  /** Reconnect backoff. Default 1 s doubling to 60 s. */
  backoff?: { minMs: number; maxMs: number };
  /** Attempts before a message whose handler keeps failing is skipped (left unread). Default 3. */
  maxAttempts?: number;
  clientFactory?: (options: ImapFlowOptions) => ImapClient;
  sender?: MailSender;
}

export interface ImapMailbox extends Mailbox {
  /** The highest UID already handed to the handler. Set it from storage before `start`. */
  setWatermark(uid: number, uidValidity?: string): void;
  watermark(): number;
  uidValidity(): string | undefined;
}

const GMAIL = /(^|\.)(gmail|googlemail)\.com$/i;
const SENT_NAMES = /^(sent|sent items|sent messages|sent mail|verzonden|verzonden items|verzonden berichten)$/i;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const isAuthError = (err: unknown): boolean =>
  !!err && typeof err === 'object' && ((err as { authenticationFailed?: boolean }).authenticationFailed === true || (err as Error).name === 'AuthenticationFailure');

/** A file name that cannot leave the folder or hide as a dotfile. */
export function safeFileName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
    .replace(/^[.\s_-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return cleaned || 'attachment';
}

async function saveAttachments(dir: string, inbound: InboundMessage, parsed: ParsedAttachment[]): Promise<Attachment[]> {
  const kept = parsed.filter((a) => !a.related);
  if (!kept.length) return inbound.attachments;
  const root = resolve(dir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const prefix = createHash('sha256').update(inbound.id).digest('hex').slice(0, 12);
  return Promise.all(
    kept.map(async (a, i) => {
      const path = join(root, `${prefix}-${i + 1}-${safeFileName(a.filename)}`);
      if (!path.startsWith(root + sep)) throw new Error('attachment path escaped the folder');
      await writeFile(path, a.content, { mode: 0o600 });
      return { ...(inbound.attachments[i] ?? { filename: a.filename ?? 'attachment' }), path };
    }),
  );
}

/**
 * The dedicated mailbox over IMAP IDLE, with SMTP for sending.
 *
 * On start it opens the folder, catches up on everything above the UID
 * watermark, then waits in IDLE; the server pushes new mail and each message
 * is parsed, handed to `onMessage`, marked `\Seen` and only then counted in
 * the watermark. A dropped connection is retried with a backoff of 1 s
 * doubling to 60 s. A handler that throws keeps its message below the
 * watermark for a retry; after `maxAttempts` it is logged as an error and
 * left unread in the mailbox, where the person will see it.
 */
export function createImapMailbox(cfg: Config['mail'], password: string, log: Logger, opts: ImapMailboxOptions = {}): ImapMailbox {
  const own = cfg.address.trim().toLowerCase();
  const backoff = opts.backoff ?? { minMs: 1000, maxMs: 60_000 };
  const maxAttempts = opts.maxAttempts ?? 3;
  const lookbackDays = opts.firstRunLookbackDays ?? 2;
  const pollIntervalMs = opts.pollIntervalMs ?? 5 * 60_000;
  const sender = opts.sender ?? createSmtpSender(cfg, password, { fromName: opts.fromName });
  const factory =
    opts.clientFactory ??
    ((o: ImapFlowOptions): ImapClient => new ImapFlow(o));

  let running = false;
  let handler: ((m: InboundMessage) => Promise<void>) | null = null;
  let client: ImapClient | null = null;
  let mark = 0;
  let known = false; // false until the watermark means something: then the first sync looks at unread mail only
  let validity: string | undefined;
  let delay = backoff.minMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let syncing: Promise<void> = Promise.resolve();
  let queued = false;
  let sentFolder: string | null | undefined;
  const attempts = new Map<number, number>();
  let status: MailStatus = { connected: false, address: cfg.address };

  const setStatus = (patch: Partial<MailStatus>, clearError = false) => {
    const next: MailStatus = { ...status, ...patch };
    if (clearError) delete next.error;
    status = next;
    opts.onStatus?.({ ...status });
  };

  const moveMark = (uid: number) => {
    if (uid <= mark && known) return;
    mark = Math.max(mark, uid);
    known = true;
    if (validity) opts.onWatermark?.(mark, validity);
  };

  const imapLogger = {
    debug: () => {},
    info: () => {},
    warn: (o: { msg?: string; err?: Error }) => log.debug(`imap: ${o?.msg ?? ''}`, o?.err ? { error: o.err.message } : undefined),
    error: (o: { msg?: string; err?: Error }) => log.warn(`imap: ${o?.msg ?? ''}`, o?.err ? { error: o.err.message } : undefined),
  };

  function scheduleReconnect(authFailed: boolean) {
    if (!running || reconnectTimer) return;
    const wait = authFailed ? backoff.maxMs : delay;
    delay = Math.min(delay * 2, backoff.maxMs);
    log.info('mailbox reconnecting', { inMs: wait });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, wait);
  }

  async function connect(): Promise<void> {
    if (!running) return;
    const c = factory({
      host: cfg.imap.host,
      port: cfg.imap.port,
      secure: cfg.imap.secure,
      auth: { user: cfg.user || cfg.address, pass: password },
      logger: imapLogger,
      autoIdleDelay: opts.autoIdleDelayMs ?? 1000,
      maxIdleTime: opts.maxIdleTimeMs ?? 5 * 60_000,
      clientInfo: { name: 'nl-property-finder' },
      connectionTimeout: 30_000,
    });
    client = c;
    c.on('error', (err: Error) => log.warn('mailbox connection error', { error: err.message }));
    c.on('close', () => {
      if (client !== c) return;
      client = null;
      setStatus({ connected: false });
      if (running) {
        log.warn('mailbox connection closed');
        scheduleReconnect(false);
      }
    });
    c.on('exists', () => {
      if (client === c) void queueSync(c);
    });
    try {
      await c.connect();
      const box = await c.mailboxOpen(cfg.folder);
      const serverValidity = String(box.uidValidity);
      if (validity && validity !== serverValidity) {
        log.warn('mailbox UIDVALIDITY changed, reading unread mail again', { was: validity, now: serverValidity });
        mark = 0;
        known = false;
      }
      validity = serverValidity;
      delay = backoff.minMs;
      setStatus({ connected: true, lastIdleAt: new Date().toISOString() }, true);
      log.info('mailbox connected', { folder: cfg.folder });
      await queueSync(c);
    } catch (err) {
      if (client === c) client = null;
      setStatus({ connected: false, error: message(err) });
      log.warn('mailbox connect failed', { error: message(err) });
      try {
        c.close();
      } catch {
        // already closed
      }
      scheduleReconnect(isAuthError(err));
    }
  }

  function queueSync(c: ImapClient): Promise<void> {
    if (queued) return syncing;
    queued = true;
    syncing = syncing
      .then(async () => {
        queued = false;
        if (running && client === c) await syncOnce(c);
      })
      .catch((err) => {
        queued = false;
        log.warn('mailbox sync failed', { error: message(err) });
      });
    return syncing;
  }

  async function syncOnce(c: ImapClient): Promise<void> {
    const firstRun = !known;
    let uids: number[];
    let baseline = 0;
    if (firstRun) {
      const since = new Date(Date.now() - lookbackDays * 86_400_000);
      uids = (await c.search({ seen: false, since }, { uid: true })) || [];
      baseline = c.mailbox ? c.mailbox.uidNext - 1 : 0;
    } else {
      uids = (await c.search({ uid: `${mark + 1}:*` }, { uid: true })) || [];
    }
    // "n:*" returns the highest UID even when it is below n, so filter again.
    const todo = [...new Set(uids)].filter((u) => firstRun || u > mark).sort((a, b) => a - b);
    let highest = 0;
    let complete = true;
    for (const uid of todo) {
      if (!running || client !== c) return;
      const done = await processOne(c, uid, firstRun);
      if (!done) {
        complete = false;
        break;
      }
      highest = Math.max(highest, uid);
    }
    // On a first run the watermark moves only once all unread mail is handled, so a
    // failure is retried through the unread search instead of skipping older read mail.
    if (firstRun && complete) moveMark(Math.max(baseline, highest));
    setStatus({ lastIdleAt: new Date().toISOString() });
  }

  /** Handles one message. Returns false when it should be retried on the next sync. */
  async function processOne(c: ImapClient, uid: number, firstRun: boolean): Promise<boolean> {
    const fetched = await c.fetchOne(String(uid), { uid: true, source: true, internalDate: true }, { uid: true });
    const advance = () => {
      if (!firstRun) moveMark(uid);
    };
    if (!fetched || !fetched.source) {
      advance(); // expunged in the meantime
      return true;
    }
    const markSeen = async () => {
      try {
        await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      } catch (err) {
        log.warn('could not mark message as read', { uid, error: message(err) });
      }
    };

    let inbound: InboundMessage;
    let parsedAttachments: ParsedAttachment[] = [];
    try {
      const parsed = await simpleParser(fetched.source, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
      const receivedAt = fetched.internalDate ? new Date(fetched.internalDate) : undefined;
      inbound = toInbound(parsed, receivedAt ? { receivedAt } : {});
      parsedAttachments = parsed.attachments;
    } catch (err) {
      log.error('could not parse a message, it stays unread in the mailbox', { uid, error: message(err) });
      advance();
      return true;
    }

    if (inbound.from.address === own) {
      log.debug('skipping mail sent by the mailbox itself', { uid });
      await markSeen();
      advance();
      return true;
    }

    try {
      if (opts.attachmentsDir) inbound.attachments = await saveAttachments(opts.attachmentsDir, inbound, parsedAttachments);
      if (!handler) return false;
      await handler(inbound);
    } catch (err) {
      const n = (attempts.get(uid) ?? 0) + 1;
      attempts.set(uid, n);
      setStatus({ error: `handling ${inbound.id} failed: ${message(err)}` });
      if (n < maxAttempts) {
        log.warn('handling a message failed, will retry', { uid, id: inbound.id, attempt: n, error: message(err) });
        return false;
      }
      attempts.delete(uid);
      log.error('giving up on a message after repeated failures; it stays unread in the mailbox', {
        uid,
        id: inbound.id,
        attempts: n,
        error: message(err),
      });
      advance();
      return true;
    }
    attempts.delete(uid);
    await markSeen();
    advance();
    return true;
  }

  async function findSentFolder(c: ImapClient): Promise<string | null> {
    if (sentFolder !== undefined) return sentFolder;
    const folders = await c.list();
    const special = folders.find((f) => f.specialUse === '\\Sent');
    const named = folders.find((f) => SENT_NAMES.test(f.path.split(/[./]/).pop() ?? ''));
    sentFolder = special?.path ?? named?.path ?? null;
    return sentFolder;
  }

  async function appendSent(raw: Buffer): Promise<void> {
    const c = client;
    if (!c) {
      log.debug('not connected, sent message not copied to Sent');
      return;
    }
    try {
      const folder = await findSentFolder(c);
      if (folder) await c.append(folder, raw, ['\\Seen']);
    } catch (err) {
      log.warn('could not copy the sent message to the Sent folder', { error: message(err) });
    }
  }

  return {
    address: cfg.address,

    async start(onMessage) {
      if (running) throw new Error('mailbox already started');
      running = true;
      handler = onMessage;
      if (pollIntervalMs > 0) {
        pollTimer = setInterval(() => {
          if (client) void queueSync(client);
        }, pollIntervalMs);
        pollTimer.unref?.();
      }
      await connect();
    },

    async stop() {
      running = false;
      handler = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollTimer) clearInterval(pollTimer);
      reconnectTimer = undefined;
      pollTimer = undefined;
      await Promise.race([syncing, new Promise((r) => setTimeout(r, 5000).unref?.())]);
      const c = client;
      client = null;
      if (c) {
        try {
          await Promise.race([c.logout(), new Promise((r) => setTimeout(r, 3000).unref?.())]);
        } catch {
          // closing anyway
        }
        try {
          c.close();
        } catch {
          // already closed
        }
      }
      sender.close();
      setStatus({ connected: false });
    },

    async send(mail: OutboundEmail) {
      const built = await sender.send(mail);
      if (!GMAIL.test(cfg.imap.host)) await appendSent(built.raw);
      return { messageId: built.messageId };
    },

    status() {
      return { ...status };
    },

    setWatermark(uid, uidValidity) {
      mark = Math.max(0, Math.floor(uid));
      known = mark > 0;
      if (uidValidity !== undefined) validity = uidValidity;
    },

    watermark() {
      return mark;
    },

    uidValidity() {
      return validity;
    },
  };
}

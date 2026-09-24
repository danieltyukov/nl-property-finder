import type { ActionChannel, ActionEvent, Config, Logger, Notification, Notifier } from '@nlpf/core';
import { headerValue, phoneForTel, request, sleep, trimSlash, type FetchFn } from './http.js';
import { signAction, verifyAction } from './sign.js';

export type NtfyConfig = NonNullable<Config['notify']['ntfy']>;

export interface NtfyNotifierOptions {
  /** Per-install action secret. Without it no action buttons are added. */
  secret?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}

const MAX_BUTTONS = 3; // ntfy's limit per notification
const MAX_BODY = 3500; // ntfy turns longer bodies into attachments

/** Button labels travel inside a comma and semicolon separated header, so those characters and quotes go. */
const label = (s: string): string => s.replace(/[,;'"\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Open';

/** The topic the phone's buttons post to and the daemon listens on. */
export const actionsTopic = (cfg: NtfyConfig): string => `${cfg.topic}-actions`;

/**
 * The ntfy `Actions` header: a `view` button with a tel: link for `call`,
 * then `http` buttons that POST `{"taskId","action","sig"}` to
 * `<server>/<topic>-actions`, at most three buttons in all.
 */
export function ntfyActions(cfg: NtfyConfig, n: Notification, secret?: string): string | undefined {
  const parts: string[] = [];
  const tel = n.call ? phoneForTel(n.call) : '';
  if (tel) parts.push(`view, Call, tel:${tel}`);
  if (secret && cfg.actions !== false && n.taskId) {
    const target = `${trimSlash(cfg.server)}/${encodeURIComponent(actionsTopic(cfg))}`;
    for (const a of n.actions ?? []) {
      if (parts.length >= MAX_BUTTONS) break;
      const body = JSON.stringify({ taskId: n.taskId, action: a.id, sig: signAction(secret, n.taskId, a.id) });
      parts.push(`http, ${label(a.label)}, ${target}, method=POST, body='${body}', clear=true`);
    }
  }
  return parts.length ? parts.join('; ') : undefined;
}

/** Push notifications through ntfy (the public ntfy.sh or a self-hosted server). */
export function createNtfyNotifier(cfg: NtfyConfig, opts: NtfyNotifierOptions = {}): Notifier {
  const fetchFn = opts.fetch ?? fetch;
  const url = `${trimSlash(cfg.server)}/${encodeURIComponent(cfg.topic)}`;
  return {
    id: 'ntfy',
    async send(n) {
      const headers: Record<string, string> = {
        Title: headerValue(n.title),
        Priority: String(n.priority),
        'Content-Type': 'text/plain; charset=utf-8',
      };
      if (n.tags?.length) headers.Tags = headerValue(n.tags.join(','));
      if (n.url) headers.Click = headerValue(n.url);
      const actions = ntfyActions(cfg, n, opts.secret);
      if (actions) headers.Actions = headerValue(actions);
      const body = (n.body || n.title).slice(0, MAX_BODY);
      await request(fetchFn, url, { method: 'POST', headers, body }, opts.timeoutMs);
    },
  };
}

export interface NtfyActionChannelOptions {
  fetch?: FetchFn;
  /** Reconnect backoff. Default 1 s doubling to 60 s. */
  backoff?: { minMs: number; maxMs: number };
  /** ntfy sends a keepalive every 45 s; a stream silent for this long is reopened. Default 2 minutes. */
  idleTimeoutMs?: number;
}

interface NtfyEvent {
  id?: string;
  time?: number;
  event?: string;
  message?: string;
}

/**
 * Listens on `<server>/<topic>-actions/json`, the long-lived JSON stream the
 * phone's http buttons post to. Only messages whose `sig` matches
 * `signAction(secret, taskId, action)` become ActionEvents; everything else
 * is ignored. The stream is reopened with a backoff of 1 s doubling to 60 s,
 * asking for messages since the last one seen so a press made during a
 * reconnect is not lost.
 */
export function createNtfyActionChannel(cfg: NtfyConfig, secret: string, log: Logger, opts: NtfyActionChannelOptions = {}): ActionChannel {
  const fetchFn = opts.fetch ?? fetch;
  const backoff = opts.backoff ?? { minMs: 1000, maxMs: 60_000 };
  const idleTimeoutMs = opts.idleTimeoutMs ?? 120_000;
  const base = `${trimSlash(cfg.server)}/${encodeURIComponent(actionsTopic(cfg))}/json`;
  const seen = new Set<string>();
  let lastId: string | undefined;
  let running = false;
  let stopper = new AbortController();
  let current: AbortController | undefined;
  let loop: Promise<void> = Promise.resolve();

  const remember = (id: string) => {
    seen.add(id);
    if (seen.size > 500) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  };

  async function handle(line: string, onAction: (a: ActionEvent) => Promise<void>): Promise<'open' | void> {
    let ev: NtfyEvent;
    try {
      ev = JSON.parse(line) as NtfyEvent;
    } catch {
      return;
    }
    if (ev.event === 'open') return 'open';
    if (ev.event !== 'message' || typeof ev.id !== 'string') return;
    if (seen.has(ev.id)) return;
    remember(ev.id);
    lastId = ev.id;
    let press: { taskId?: unknown; action?: unknown; sig?: unknown };
    try {
      press = JSON.parse(ev.message ?? '') as typeof press;
    } catch {
      log.debug('ignoring an ntfy action that is not JSON');
      return;
    }
    const { taskId, action, sig } = press ?? {};
    if (typeof taskId !== 'string' || typeof action !== 'string' || !verifyAction(secret, taskId, action, sig)) {
      log.warn('ignoring an ntfy action with a missing or wrong signature');
      return;
    }
    const at = typeof ev.time === 'number' ? new Date(ev.time * 1000).toISOString() : new Date().toISOString();
    try {
      await onAction({ taskId, action, channel: 'ntfy', at });
    } catch (err) {
      log.error('handling an ntfy action failed', { taskId, action, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function run(onAction: (a: ActionEvent) => Promise<void>): Promise<void> {
    let delay = backoff.minMs;
    while (running) {
      const ac = new AbortController();
      current = ac;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const kick = () => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => ac.abort(new Error('ntfy stream went quiet')), idleTimeoutMs);
      };
      try {
        kick();
        const url = lastId ? `${base}?since=${encodeURIComponent(lastId)}` : base;
        const res = await fetchFn(url, { signal: ac.signal, headers: { Accept: 'application/x-ndjson' } });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          kick();
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line && (await handle(line, onAction)) === 'open') delay = backoff.minMs;
          }
        }
      } catch (err) {
        if (!running) break;
        log.warn('ntfy action stream failed', { error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (watchdog) clearTimeout(watchdog);
      }
      if (!running) break;
      await sleep(delay, stopper.signal);
      delay = Math.min(delay * 2, backoff.maxMs);
    }
  }

  return {
    id: 'ntfy',
    async start(onAction) {
      if (running) throw new Error('ntfy action channel already started');
      running = true;
      stopper = new AbortController();
      loop = run(onAction);
    },
    async stop() {
      running = false;
      stopper.abort();
      current?.abort();
      await loop;
    },
  };
}

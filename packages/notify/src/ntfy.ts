import type { Config, Notification, Notifier } from '@nlpf/core';
import { headerValue, phoneForTel, request, trimSlash, type FetchFn } from './http.js';
import { signAction } from './sign.js';

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

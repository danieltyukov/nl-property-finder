import type { Config, Notification, Notifier } from '@nlpf/core';
import { request, trimSlash, type FetchFn } from './http.js';
import { callbackData } from './sign.js';

export type TelegramConfig = NonNullable<Config['notify']['telegram']>;

export interface TelegramOptions {
  /** Per-install action secret. Without it no inline buttons are added. */
  secret?: string;
  /** Bot API base URL, for tests. Default https://api.telegram.org */
  apiBase?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}

export const TELEGRAM_API = 'https://api.telegram.org';
const MAX_CALLBACK_BYTES = 64;
const MAX_TEXT = 3800; // Telegram allows 4096 characters after entity parsing

/** Escapes the characters Telegram's HTML parse mode reserves. */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A line the action channel reads back when the person replies to a task message. */
export const refLine = (taskId: string): string => `<i>ref ${escapeHtml(taskId)}</i>`;

export async function telegramCall<T = unknown>(
  fetchFn: FetchFn,
  apiBase: string,
  token: string,
  method: string,
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await request(
    fetchFn,
    `${trimSlash(apiBase)}/bot${token}/${method}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: opts.signal },
    opts.timeoutMs,
  );
  const json = (await res.json()) as { ok?: boolean; result?: T; description?: string };
  if (json.ok === false) throw new Error(`Telegram ${method} failed: ${json.description ?? 'unknown error'}`);
  return json.result as T;
}

/** The message text: bold title, body, call number, link, and the task reference. */
export function telegramText(n: Notification): string {
  const lines = [`<b>${escapeHtml(n.title)}</b>`];
  if (n.body && n.body !== n.title) lines.push(escapeHtml(n.body.slice(0, MAX_TEXT)));
  // Inline buttons only take http(s) and tg:// links, so a tel: button is impossible.
  // Telegram apps turn a phone number in the text into a tappable link instead.
  if (n.call) lines.push(`Call ${escapeHtml(n.call)}`);
  if (n.url) lines.push(`<a href="${escapeHtml(n.url)}">Open</a>`);
  if (n.taskId) lines.push(refLine(n.taskId));
  return lines.join('\n');
}

/** Pushes through a Telegram bot to one chat, with inline buttons for task actions. */
export function createTelegramNotifier(cfg: TelegramConfig, token: string, opts: TelegramOptions = {}): Notifier {
  const fetchFn = opts.fetch ?? fetch;
  const apiBase = opts.apiBase ?? TELEGRAM_API;
  return {
    id: 'telegram',
    async send(n) {
      const payload: Record<string, unknown> = {
        chat_id: cfg.chatId,
        text: telegramText(n),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };
      if (opts.secret && cfg.actions !== false && n.taskId && n.actions?.length) {
        const taskId = n.taskId;
        const secret = opts.secret;
        const row = n.actions
          .map((a) => ({ text: a.label.slice(0, 40), callback_data: callbackData(secret, taskId, a.id) }))
          .filter((b) => Buffer.byteLength(b.callback_data) <= MAX_CALLBACK_BYTES);
        if (row.length) payload.reply_markup = { inline_keyboard: [row] };
      }
      await telegramCall(fetchFn, apiBase, token, 'sendMessage', payload, { timeoutMs: opts.timeoutMs });
    },
  };
}

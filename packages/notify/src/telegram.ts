import type { ActionChannel, ActionEvent, Config, Logger, Notification, Notifier } from '@nlpf/core';
import { request, sleep, trimSlash, type FetchFn } from './http.js';
import { callbackData, parseCallbackData, verifyAction } from './sign.js';

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

export interface TelegramActionChannelOptions {
  apiBase?: string;
  fetch?: FetchFn;
  /** Long-poll timeout in seconds. Default 50. */
  pollTimeoutSec?: number;
  /** Retry backoff after an error. Default 1 s doubling to 60 s. */
  backoff?: { minMs: number; maxMs: number };
}

interface TgMessage {
  message_id: number;
  date?: number;
  chat?: { id?: number | string };
  from?: { is_bot?: boolean };
  text?: string;
  reply_to_message?: TgMessage;
  reply_markup?: { inline_keyboard?: { callback_data?: string }[][] };
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; data?: string; message?: TgMessage };
}

/** The action a text reply to a task message becomes: send this text as the answer. */
export const REPLY_ACTION = 'send_draft';

/**
 * Reads button presses and replies from Telegram with `getUpdates` long
 * polling (outbound only, so the daemon stays on localhost). A button press
 * counts only when it comes from the configured chat and its callback data
 * carries a valid signature; every press is answered with
 * `answerCallbackQuery` so the button stops spinning. A text reply to one of
 * the bot's task messages becomes a `send_draft` action with that text.
 */
export function createTelegramActionChannel(
  cfg: TelegramConfig,
  token: string,
  secret: string,
  log: Logger,
  opts: TelegramActionChannelOptions = {},
): ActionChannel {
  const fetchFn = opts.fetch ?? fetch;
  const apiBase = opts.apiBase ?? TELEGRAM_API;
  const pollTimeoutSec = opts.pollTimeoutSec ?? 50;
  const backoff = opts.backoff ?? { minMs: 1000, maxMs: 60_000 };
  let running = false;
  let stopper = new AbortController();
  let loop: Promise<void> = Promise.resolve();
  let offset: number | undefined;

  const fromOurChat = (m: TgMessage | undefined): boolean => m?.chat?.id !== undefined && String(m.chat.id) === String(cfg.chatId);

  const call = <T>(method: string, payload: Record<string, unknown>, timeoutMs = 15_000) =>
    telegramCall<T>(fetchFn, apiBase, token, method, payload, { timeoutMs, signal: stopper.signal });

  /** The task a bot message belongs to: from its signed buttons, else from its "ref" line. */
  function taskOf(m: TgMessage | undefined): string | undefined {
    if (!m || m.from?.is_bot === false) return undefined;
    for (const row of m.reply_markup?.inline_keyboard ?? []) {
      for (const button of row) {
        const parsed = parseCallbackData(button.callback_data);
        if (parsed && verifyAction(secret, parsed.taskId, parsed.action, parsed.sig)) return parsed.taskId;
      }
    }
    return /(?:^|\n)ref (\S+)\s*$/.exec(m.text ?? '')?.[1];
  }

  async function emit(onAction: (a: ActionEvent) => Promise<void>, event: ActionEvent) {
    try {
      await onAction(event);
    } catch (err) {
      log.error('handling a Telegram action failed', { taskId: event.taskId, action: event.action, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handle(u: TgUpdate, onAction: (a: ActionEvent) => Promise<void>) {
    const cq = u.callback_query;
    if (cq) {
      const parsed = parseCallbackData(cq.data);
      const valid = fromOurChat(cq.message) && !!parsed && verifyAction(secret, parsed.taskId, parsed.action, parsed.sig);
      try {
        await call('answerCallbackQuery', { callback_query_id: cq.id, text: valid ? 'Received' : 'Not accepted' });
      } catch (err) {
        log.warn('could not acknowledge a Telegram button press', { error: err instanceof Error ? err.message : String(err) });
      }
      if (!valid || !parsed) {
        log.warn('ignoring a Telegram button press that is not signed for this install');
        return;
      }
      await emit(onAction, { taskId: parsed.taskId, action: parsed.action, channel: 'telegram', at: new Date().toISOString() });
      return;
    }
    const m = u.message;
    if (!m || !fromOurChat(m) || !m.text) return;
    const taskId = taskOf(m.reply_to_message);
    if (!taskId) {
      log.debug('ignoring a Telegram message that is not a reply to a task');
      return;
    }
    const at = m.date ? new Date(m.date * 1000).toISOString() : new Date().toISOString();
    await emit(onAction, { taskId, action: REPLY_ACTION, text: m.text, channel: 'telegram', at });
  }

  async function run(onAction: (a: ActionEvent) => Promise<void>) {
    let delay = backoff.minMs;
    while (running) {
      try {
        const payload: Record<string, unknown> = { timeout: pollTimeoutSec, allowed_updates: ['message', 'callback_query'] };
        if (offset !== undefined) payload.offset = offset;
        const updates = await call<TgUpdate[]>('getUpdates', payload, (pollTimeoutSec + 15) * 1000);
        delay = backoff.minMs;
        for (const u of updates ?? []) {
          if (!running) break;
          await handle(u, onAction);
          offset = u.update_id + 1; // confirmed to Telegram by the next getUpdates
        }
      } catch (err) {
        if (!running) break;
        log.warn('Telegram polling failed', { error: err instanceof Error ? err.message : String(err) });
        await sleep(delay, stopper.signal);
        delay = Math.min(delay * 2, backoff.maxMs);
      }
    }
  }

  return {
    id: 'telegram',
    async start(onAction) {
      if (running) throw new Error('Telegram action channel already started');
      running = true;
      stopper = new AbortController();
      loop = run(onAction);
    },
    async stop() {
      running = false;
      stopper.abort();
      await loop;
    },
  };
}

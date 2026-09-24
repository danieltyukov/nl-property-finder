import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signature carried by every phone button: HMAC-SHA256 of `taskId:action`
 * with the per-install secret. It is shortened to the first 16 bytes
 * (128 bits, 22 base64url characters) so `<taskId>:<action>:<sig>` fits in
 * Telegram's 64-byte `callback_data`. Someone who guesses the ntfy topic or
 * finds the bot cannot act on a task without it.
 */
export function signAction(secret: string, taskId: string, action: string): string {
  if (!secret) throw new Error('the action secret is empty');
  return createHmac('sha256', secret).update(`${taskId}:${action}`).digest().subarray(0, 16).toString('base64url');
}

/** Constant-time check of a button signature. */
export function verifyAction(secret: string, taskId: string, action: string, sig: unknown): boolean {
  if (!secret || typeof sig !== 'string' || typeof taskId !== 'string' || typeof action !== 'string') return false;
  const expected = Buffer.from(signAction(secret, taskId, action));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A fresh per-install secret (32 random bytes). */
export function generateActionSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** `<taskId>:<action>:<sig>` for a Telegram inline button. */
export function callbackData(secret: string, taskId: string, action: string): string {
  return `${taskId}:${action}:${signAction(secret, taskId, action)}`;
}

/** Splits callback data from the right, so a task id may itself contain a colon. */
export function parseCallbackData(data: unknown): { taskId: string; action: string; sig: string } | null {
  if (typeof data !== 'string') return null;
  const parts = data.split(':');
  if (parts.length < 3) return null;
  const sig = parts.pop() ?? '';
  const action = parts.pop() ?? '';
  const taskId = parts.join(':');
  if (!taskId || !action || !sig) return null;
  return { taskId, action, sig };
}

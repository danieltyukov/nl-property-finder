import { createHmac } from 'node:crypto';
import { expect, test } from 'vitest';
import { callbackData, generateActionSecret, parseCallbackData, signAction, verifyAction } from '../src/sign.js';

const SECRET = 'per-install-secret-for-tests';

test('signAction is an HMAC-SHA256 of "taskId:action", shortened to 128 bits in base64url', () => {
  const full = createHmac('sha256', SECRET).update('t_abc123:approve').digest();
  expect(signAction(SECRET, 't_abc123', 'approve')).toBe(full.subarray(0, 16).toString('base64url'));
  expect(signAction(SECRET, 't_abc123', 'approve')).toHaveLength(22);
});

test('verifyAction accepts the right signature only', () => {
  const sig = signAction(SECRET, 't_abc123', 'approve');
  expect(verifyAction(SECRET, 't_abc123', 'approve', sig)).toBe(true);
  expect(verifyAction(SECRET, 't_abc123', 'dismiss', sig)).toBe(false);
  expect(verifyAction(SECRET, 't_other', 'approve', sig)).toBe(false);
  expect(verifyAction('another-install-secret', 't_abc123', 'approve', sig)).toBe(false);
  expect(verifyAction(SECRET, 't_abc123', 'approve', `${sig}x`)).toBe(false);
  expect(verifyAction(SECRET, 't_abc123', 'approve', undefined)).toBe(false);
  expect(verifyAction('', 't_abc123', 'approve', sig)).toBe(false);
});

test('an empty secret cannot sign', () => {
  expect(() => signAction('', 't_1', 'approve')).toThrow();
});

test('callback data fits in Telegram\'s 64 bytes for a normal task id and parses back', () => {
  const data = callbackData(SECRET, 't_0mfx1a2b3c4d5e6f7', 'send_draft');
  expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
  expect(parseCallbackData(data)).toEqual({
    taskId: 't_0mfx1a2b3c4d5e6f7',
    action: 'send_draft',
    sig: signAction(SECRET, 't_0mfx1a2b3c4d5e6f7', 'send_draft'),
  });
  expect(parseCallbackData('garbage')).toBeNull();
  expect(parseCallbackData('a::b')).toBeNull();
});

test('generated secrets are long and different each time', () => {
  const a = generateActionSecret();
  expect(a.length).toBeGreaterThanOrEqual(43);
  expect(generateActionSecret()).not.toBe(a);
});

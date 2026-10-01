import { expect, test } from 'vitest';
import { mailStatusChanged, mailStatusView } from '../src/mailstatus.js';

test('an error from boot is history once the mailbox is connected', () => {
  const live = { connected: true, address: 'sam@example.test', lastIdleAt: '2026-10-01T18:00:00.000Z' };
  expect(mailStatusView(live, 'sam@example.test', 'getaddrinfo EAI_AGAIN imap.gmail.com')).toEqual(live);
});

test('a disconnected mailbox shows its own error first, then the setup error', () => {
  expect(mailStatusView({ connected: false, error: 'read ETIMEDOUT' }, 'a@b.test', 'old')).toMatchObject({ connected: false, error: 'read ETIMEDOUT' });
  expect(mailStatusView({ connected: false }, 'a@b.test', 'Invalid credentials')).toMatchObject({ error: 'Invalid credentials' });
  expect(mailStatusView(undefined, undefined, 'No mailbox password')).toEqual({ connected: false, error: 'No mailbox password' });
});

test('only a change of connection or error is news for the feed', () => {
  const up = { connected: true, address: 'a@b.test' };
  expect(mailStatusChanged(undefined, up)).toBe(true);
  expect(mailStatusChanged({ connected: true }, { ...up, lastIdleAt: '2026-10-01T18:05:00.000Z' })).toBe(false);
  expect(mailStatusChanged({ connected: true }, { connected: false })).toBe(true);
  expect(mailStatusChanged({ connected: false, error: 'a' }, { connected: false, error: 'b' })).toBe(true);
});

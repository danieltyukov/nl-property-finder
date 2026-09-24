import { expect, test } from 'vitest';
import { openStore, type InboundMessage, type Message } from '@nlpf/core';
import { isAutoSubmitted, replyBudgetLeft } from '../src/loopguard.js';

const mail = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  id: '<a@b>',
  channel: 'email',
  from: { address: 'verhuur@delftrentals.nl' },
  subject: 'Re: Oude Delft 12A',
  text: 'Dank voor uw reactie.',
  at: 't',
  attachments: [],
  ...over,
});

test('a message with Auto-Submitted: auto-replied is auto-submitted', () => {
  // The mail package reads Auto-Submitted, X-Autoreply and Precedence into this flag.
  expect(isAutoSubmitted(mail({ autoSubmitted: true }))).toBe(true);
  expect(isAutoSubmitted(mail())).toBe(false);
});

test('out-of-office subjects and bounce senders are auto-submitted too', () => {
  expect(isAutoSubmitted(mail({ subject: 'Automatisch antwoord: Oude Delft 12A' }))).toBe(true);
  expect(isAutoSubmitted(mail({ subject: 'Out of Office: your enquiry' }))).toBe(true);
  expect(isAutoSubmitted(mail({ subject: 'Afwezig tot 1 oktober' }))).toBe(true);
  expect(isAutoSubmitted(mail({ from: { address: 'MAILER-DAEMON@mx.example.nl' } }))).toBe(true);
  expect(isAutoSubmitted(mail({ from: { address: 'noreply@kamernet.nl' } }))).toBe(true);
  expect(isAutoSubmitted(mail({ subject: 'Re: afwezigheid tijdens bezichtiging?' }))).toBe(false);
});

test('after 3 replies in a day replyBudgetLeft is 0', () => {
  const store = openStore(':memory:');
  const c = store.conversations.create({
    applicationId: null,
    propertyId: null,
    counterpart: { email: 'x@y.nl' },
    lastMessageAt: 't',
    unread: 0,
  });
  const out = (at: string, author: Message['author'] = 'agent') =>
    store.messages.add({
      conversationId: c.id,
      direction: 'out',
      author,
      channel: 'email',
      body: 'x',
      at,
      status: 'sent',
    });
  const now = new Date('2026-09-23T18:00:00Z');
  out('2026-09-22T12:00:00Z'); // more than a day ago
  out('2026-09-23T09:00:00Z', 'human'); // the person's own messages do not count
  expect(replyBudgetLeft(c.id, store, 3, now)).toBe(3);
  out('2026-09-23T09:05:00Z');
  out('2026-09-23T12:00:00Z');
  expect(replyBudgetLeft(c.id, store, 3, now)).toBe(1);
  out('2026-09-23T17:00:00Z');
  expect(replyBudgetLeft(c.id, store, 3, now)).toBe(0);
  out('2026-09-23T17:30:00Z');
  expect(replyBudgetLeft(c.id, store, 3, now)).toBe(0);
  expect(replyBudgetLeft(c.id, store, 3, new Date('2026-09-24T17:10:00Z'))).toBe(2);
});

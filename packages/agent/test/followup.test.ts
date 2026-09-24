import { expect, test } from 'vitest';
import type { Application, Message } from '@nlpf/core';
import { followUpDue } from '../src/followup.js';

const cfg = { enabled: true, afterDays: 3, max: 1 };
const app: Application = { id: 'app_1', propertyId: 'p_1', status: 'contacted', firstSeenAt: '2026-09-20T09:59:00Z', contactedAt: '2026-09-20T10:00:00Z', updatedAt: 't' };
const msg = (direction: 'in' | 'out', at: string): Message => ({
  id: `m_${at}`, conversationId: 'c_1', direction, author: direction === 'in' ? 'landlord' : 'agent', channel: 'email', body: 'x', at, status: direction === 'in' ? 'received' : 'sent',
});
const first = msg('out', '2026-09-20T10:00:00Z');

test('due after afterDays with no answer and fewer than max follow-ups', () => {
  expect(followUpDue(app, undefined, first, cfg, new Date('2026-09-23T10:00:00Z'))).toBe(true);
  expect(followUpDue(app, undefined, first, cfg, new Date('2026-09-23T09:59:00Z'))).toBe(false);
});

test('not due once the landlord replied', () => {
  expect(followUpDue(app, msg('in', '2026-09-21T08:00:00Z'), first, cfg, new Date('2026-09-25T10:00:00Z'))).toBe(false);
});

test('an inbound message from before the contact does not count as a reply', () => {
  expect(followUpDue(app, msg('in', '2026-09-19T08:00:00Z'), first, cfg, new Date('2026-09-25T10:00:00Z'))).toBe(true);
});

test('not due when the application moved on or closed', () => {
  for (const status of ['replied', 'viewing_booked', 'rejected', 'withdrawn', 'gone', 'offer'] as const) {
    expect(followUpDue({ ...app, status }, undefined, first, cfg, new Date('2026-09-30T10:00:00Z'))).toBe(false);
  }
});

test('the number of follow-ups is capped', () => {
  const followUp = msg('out', '2026-09-23T10:00:00Z');
  const now = new Date('2026-09-27T10:00:00Z');
  expect(followUpDue(app, undefined, followUp, cfg, now, 1)).toBe(false);
  expect(followUpDue(app, undefined, followUp, { ...cfg, max: 2 }, now, 1)).toBe(true);
  expect(followUpDue(app, undefined, followUp, { ...cfg, max: 2 }, new Date('2026-09-25T10:00:00Z'), 1)).toBe(false); // counts from the last message
  expect(followUpDue(app, undefined, first, { ...cfg, max: 0 }, now)).toBe(false);
});

test('switched off means never', () => {
  expect(followUpDue(app, undefined, first, { ...cfg, enabled: false }, new Date('2026-10-30T10:00:00Z'))).toBe(false);
});

test('without an outbound message the contact time counts', () => {
  expect(followUpDue(app, undefined, undefined, cfg, new Date('2026-09-23T10:00:00Z'))).toBe(true);
  expect(followUpDue({ ...app, contactedAt: undefined }, undefined, undefined, cfg, new Date('2026-09-30T10:00:00Z'))).toBe(false);
});

import type { InboundMessage } from '@nlpf/core';
import { expect, test } from 'vitest';
import { normalizeMessageId, threadKey } from '../src/threads.js';

const msg = (over: Partial<InboundMessage>): InboundMessage => ({
  id: '<own@example.test>',
  channel: 'email',
  from: { address: 'landlord@example.test' },
  text: '',
  at: '2026-09-23T08:00:00.000Z',
  attachments: [],
  ...over,
});

test('threadKey returns the own id, In-Reply-To and every reference, without duplicates', () => {
  const m = msg({ inReplyTo: '<b@x.test>', references: ['<a@x.test>', '<b@x.test>'] });
  expect(threadKey(m)).toEqual(['<own@example.test>', '<b@x.test>', '<a@x.test>']);
});

test('an email with no thread headers returns only its own id', () => {
  expect(threadKey(msg({}))).toEqual(['<own@example.test>']);
});

test('ids are trimmed and wrapped in angle brackets so they compare with stored ids', () => {
  const m = msg({ id: ' own@example.test ', inReplyTo: 'b@x.test', references: ['<a@x.test> <b@x.test>'] });
  expect(threadKey(m)).toEqual(['<own@example.test>', '<b@x.test>', '<a@x.test>']);
});

test('platform message ids are kept as they are', () => {
  expect(threadKey(msg({ id: 'huisje:4411', channel: 'platform', sourceId: 'huisje' }))).toEqual(['huisje:4411']);
});

test('normalizeMessageId leaves empty input empty', () => {
  expect(normalizeMessageId('  ')).toBe('');
  expect(normalizeMessageId('<x@y>')).toBe('<x@y>');
});

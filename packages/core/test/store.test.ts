import { expect, test } from 'vitest';
import { openStore, type RawListing } from '../src/index.js';

const raw = (over: Partial<RawListing> = {}): RawListing => ({
  sourceId: 'funda', externalId: '42', url: 'https://example.test/42', title: 'Oude Delft 12A',
  priceEur: 1200, sizeM2: 40, address: { street: 'Oude Delft', houseNumber: '12', addition: 'A', city: 'Delft', postcode: '2611 BC' },
  contact: 'form', ...over,
});

test('upsert reports new, then changed on a price change, then neither', () => {
  const s = openStore(':memory:');
  expect(s.listings.upsert(raw(), 'poll', 't1')).toMatchObject({ isNew: true, changed: false });
  expect(s.listings.upsert(raw({ priceEur: 1150 }), 'poll', 't2')).toMatchObject({ isNew: false, changed: true });
  const again = s.listings.upsert(raw({ priceEur: 1150 }), 'poll', 't3');
  expect(again).toMatchObject({ isNew: false, changed: false });
  expect(again.listing.firstSeenAt).toBe('t1');
  expect(again.listing.lastSeenAt).toBe('t3');
});

test('markGone returns only ids not seen', () => {
  const s = openStore(':memory:');
  s.listings.upsert(raw({ externalId: '1' }), 'poll', 't');
  s.listings.upsert(raw({ externalId: '2' }), 'poll', 't');
  expect(s.listings.markGone('funda', ['funda:1'], 't2')).toEqual(['funda:2']);
  expect(s.listings.get('funda:2')?.state).toBe('gone');
});

test('tasks dedupe by key', () => {
  const s = openStore(':memory:');
  const base = { kind: 'source_broken' as const, title: 'Pararius stopped returning listings', reason: 'r', priority: 2 as const };
  expect(s.tasks.open(base, 't', 'broken:pararius').created).toBe(true);
  expect(s.tasks.open(base, 't', 'broken:pararius').created).toBe(false);
  expect(s.tasks.list({ state: 'active' })).toHaveLength(1);
});

test('snoozed tasks wake up', () => {
  const s = openStore(':memory:');
  const { task } = s.tasks.open({ kind: 'reply_needed', title: 'x', reason: 'y', priority: 2 }, '2026-01-01T00:00:00Z');
  s.tasks.update(task.id, { state: 'snoozed', snoozedUntil: '2026-01-02T00:00:00Z' }, '2026-01-01T00:00:00Z');
  expect(s.tasks.wakeSnoozed('2026-01-01T12:00:00Z')).toHaveLength(0);
  expect(s.tasks.wakeSnoozed('2026-01-02T00:00:01Z')[0]?.state).toBe('open');
});

test('messages reject a duplicate external id', () => {
  const s = openStore(':memory:');
  const c = s.conversations.create({ applicationId: null, propertyId: null, counterpart: { email: 'A@Example.nl' }, lastMessageAt: 't', unread: 0 });
  const m = { conversationId: c.id, direction: 'in' as const, author: 'landlord' as const, channel: 'email' as const, body: 'hoi', at: 't', status: 'received' as const, externalId: '<x@y>' };
  s.messages.add(m);
  expect(() => s.messages.add(m)).toThrow();
  expect(s.messages.hasExternal('<x@y>')).toBe(true);
  expect(s.conversations.byEmail('a@example.nl')).toHaveLength(1);
});

test('countContactedSince counts only recent contacts', () => {
  const s = openStore(':memory:');
  const p1 = s.properties.create({ id: 'p1', key: 'k1', address: {}, title: 'a' }, 't');
  const p2 = s.properties.create({ id: 'p2', key: 'k2', address: {}, title: 'b' }, 't');
  const a1 = s.applications.ensure(p1.id, 't');
  const a2 = s.applications.ensure(p2.id, 't');
  s.applications.update(a1.id, { status: 'contacted', contactedAt: '2026-09-23T08:00:00Z' }, 't');
  s.applications.update(a2.id, { status: 'contacted', contactedAt: '2026-09-22T08:00:00Z' }, 't');
  expect(s.applications.countContactedSince('2026-09-23T00:00:00Z')).toBe(1);
  expect(s.applications.ensure(p1.id, 't').id).toBe(a1.id);
});

test('property list filters by application status and match', () => {
  const s = openStore(':memory:');
  s.properties.create({ id: 'p1', key: 'k1', address: { city: 'Delft' }, title: 'Oude Delft 12A' }, '2026-01-01');
  s.properties.create({ id: 'p2', key: 'k2', address: { city: 'Rotterdam' }, title: 'Witte de Withstraat 1' }, '2026-01-02');
  s.matches.put({ propertyId: 'p1', passed: true, score: 80, reasons: [], requirements: {}, scam: { level: 'none', signals: [] }, by: 'rules', evaluatedAt: 't' });
  expect(s.properties.list({ status: 'matched' }).map((p) => p.id)).toEqual(['p1']);
  expect(s.properties.list({ status: 'unmatched' }).map((p) => p.id)).toEqual(['p2']);
  expect(s.properties.list({ q: 'Rotter' }).map((p) => p.id)).toEqual(['p2']);
  expect(s.properties.candidates({ postcode: undefined, city: 'delft', priceEur: 1000 })).toEqual([]);
});

test('events are ordered and readable since an id', () => {
  const s = openStore(':memory:');
  const a = s.events.append('listing.new', 'Found Oude Delft 12A', { id: 1 }, 't1');
  s.events.append('message.sent', 'Sent', {}, 't2');
  expect(s.events.since(a.id).map((e) => e.type)).toEqual(['message.sent']);
  expect(s.events.latest(1)[0]?.type).toBe('message.sent');
  expect(s.events.latest(5, ['listing.new'])).toHaveLength(1);
});

test('usage accumulates per month', () => {
  const s = openStore(':memory:');
  s.usage.add('2026-09', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, calls: 1 });
  s.usage.add('2026-09', { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, calls: 1 });
  expect(s.usage.get('2026-09')).toEqual({ inputTokens: 20, outputTokens: 10, cacheReadTokens: 4, calls: 2 });
});

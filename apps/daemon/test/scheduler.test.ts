import { expect, test } from 'vitest';
import { ConfigSchema, createEventBus, memoryLogger, openStore, type SourceAdapter } from '@nlpf/core';
import { createHealth } from '../src/health.js';
import { createScheduler } from '../src/scheduler.js';

const adapter = (id: string, search: SourceAdapter['capabilities']['search'] = 'json', interval = 90): SourceAdapter => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), homepage: 'https://example.test', regions: 'nl', defaultIntervalSec: interval,
  capabilities: { search, detail: false, contact: 'form', login: 'none', terms: 'unknown' },
  buildSearches: () => [{ key: 'all', label: 'all' }],
  search: async () => [],
});

test('review focus 4: a busy source that suddenly returns nothing is flagged, a quiet one is not', () => {
  const store = openStore(':memory:');
  let clock = new Date('2026-09-17T08:00:00Z');
  const health = createHealth({ store, bus: createEventBus(store), now: () => clock });
  let busy = { sourceId: 'pararius', name: 'Pararius', enabled: true, health: 'ok' as const, consecutiveFailures: 0, consecutiveEmpty: 0 };
  let quiet = { ...busy, sourceId: 'rotsvast', name: 'Rotsvast' };
  // A week of normal polling: Pararius returns listings, Rotsvast never does.
  for (let i = 0; i < 7 * 24; i++) {
    clock = new Date(clock.getTime() + 3_600_000);
    busy = health.record(busy, { ok: true, count: [3, 2, 4][i % 3]!, latencyMs: 200 }) as typeof busy;
    quiet = health.record(quiet, { ok: true, count: 0, latencyMs: 200 }) as typeof quiet;
  }
  expect(store.tasks.list({ kind: 'source_broken' })).toHaveLength(0);
  for (let i = 0; i < 3; i++) {
    clock = new Date(clock.getTime() + 90_000);
    busy = health.record(busy, { ok: true, count: 0, latencyMs: 200 }) as typeof busy;
  }
  expect(busy.health).toBe('degraded');
  const tasks = store.tasks.list({ kind: 'source_broken' });
  expect(tasks).toHaveLength(1);
  expect(tasks[0]?.sourceId).toBe('pararius');
  expect(quiet.health).toBe('ok');
});

test('five failures degrade a source; an hour of failures opens one task; success recovers it', () => {
  const store = openStore(':memory:');
  let clock = new Date('2026-09-24T08:00:00Z');
  const health = createHealth({ store, bus: createEventBus(store), now: () => clock });
  let s = { sourceId: 'funda', name: 'Funda', enabled: true, health: 'ok' as const, consecutiveFailures: 0, consecutiveEmpty: 0 };
  for (let i = 0; i < 5; i++) s = health.record(s, { ok: false, count: 0, latencyMs: 50, error: 'HTTP 503' }) as typeof s;
  expect(s.health).toBe('degraded');
  expect(store.tasks.list({ kind: 'source_broken' })).toHaveLength(0);
  clock = new Date(clock.getTime() + 61 * 60_000);
  s = health.record(s, { ok: false, count: 0, latencyMs: 50, error: 'HTTP 503' }) as typeof s;
  s = health.record(s, { ok: false, count: 0, latencyMs: 50, error: 'HTTP 503' }) as typeof s;
  expect(store.tasks.list({ kind: 'source_broken' })).toHaveLength(1);
  s = health.record(s, { ok: true, count: 4, latencyMs: 50 }) as typeof s;
  expect(s.health).toBe('ok');
  expect(s.consecutiveFailures).toBe(0);
});

test('a logout opens one reconnect task and stops polling that source', () => {
  const store = openStore(':memory:');
  const clock = new Date('2026-09-24T08:00:00Z');
  const health = createHealth({ store, bus: createEventBus(store), now: () => clock });
  const s0 = { sourceId: 'pararius', name: 'Pararius', enabled: true, health: 'ok' as const, consecutiveFailures: 0, consecutiveEmpty: 0 };
  health.record(s0, { ok: false, count: 0, latencyMs: 10, needsLogin: true });
  health.record(s0, { ok: false, count: 0, latencyMs: 10, needsLogin: true });
  expect(store.tasks.list({ kind: 'reconnect' })).toHaveLength(1);
  const sched = createScheduler({ store, log: memoryLogger(), config: () => ConfigSchema.parse({}), adapters: () => [adapter('pararius')], now: () => clock });
  expect(sched.tick()).toBe(0);
});

test('the scheduler enqueues due sources once, respects floors, jitter and disabled sources', () => {
  const store = openStore(':memory:');
  let clock = new Date('2026-09-24T08:00:00Z');
  const cfg = ConfigSchema.parse({ sources: { marktplaats: { enabled: false }, funda: { intervalSec: 30 } } });
  const sched = createScheduler({
    store, log: memoryLogger(), config: () => cfg, now: () => clock, random: () => 0.5,
    adapters: () => [adapter('funda'), adapter('pararius', 'browser', 60), adapter('marktplaats')].filter((a) => cfg.sources[a.id]?.enabled !== false),
  });
  expect(sched.tick()).toBe(2);
  expect(sched.tick()).toBe(0);
  // funda asked for 30 s but the JSON floor is 45 s; pararius asked for 60 s but browser sources wait at least 120 s.
  expect(store.sources.get('funda')?.nextRunAt).toBe('2026-09-24T08:00:45.000Z');
  expect(store.sources.get('pararius')?.nextRunAt).toBe('2026-09-24T08:02:00.000Z');
  clock = new Date('2026-09-24T08:00:46Z');
  expect(sched.tick()).toBe(1);
  sched.backoff('funda', 600);
  clock = new Date('2026-09-24T08:05:00Z');
  expect(sched.tick()).toBe(1); // only pararius
  expect(sched.nextRunAt()).toBeDefined();
});

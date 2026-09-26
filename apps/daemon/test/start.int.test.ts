import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger, openStore, resolvePaths, saveConfig, type RawListing, type SourceAdapter } from '@nlpf/core';
import { startDaemon, type DaemonHandle } from '../src/start.js';

const handles: DaemonHandle[] = [];
afterEach(async () => {
  for (const h of handles.splice(0)) await h.stop();
});

// Seeded into each home before the daemon starts; the daemon keeps a token it finds.
const TOKEN = randomBytes(32).toString('hex');

function home(extra: Record<string, unknown> = {}) {
  const paths = resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-start-')) });
  mkdirSync(dirname(paths.tokenFile), { recursive: true });
  writeFileSync(paths.tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  saveConfig(paths, ConfigSchema.parse({
    profile: { firstName: 'Sam', lastName: 'de Vries', email: 'sam@example.test', occupation: 'student', about: 'Quiet student.' },
    searches: [{ id: 'main', name: 'Delft', priceMaxEur: 1400, regions: [{ name: 'Delft', municipalities: ['delft'] }] }],
    automation: { sendWindow: { start: '00:00', end: '23:59' } },
    rentCheck: { enabled: false },
    notify: { desktop: false },
    ...extra,
  }));
  return paths;
}

function fakeSource(listings: RawListing[]) {
  const contacted: string[] = [];
  const adapter: SourceAdapter = {
    id: 'fake', name: 'Fake', homepage: 'https://fake.test', regions: 'nl', defaultIntervalSec: 45,
    capabilities: { search: 'json', detail: false, contact: 'form', login: 'none', terms: 'allows' },
    buildSearches: () => [{ key: 'all', label: 'all' }],
    search: async () => listings,
    isAvailable: async () => true,
    contact: async (listing) => {
      contacted.push(listing.id);
      return { ok: true, channel: 'form', externalId: `sub-${contacted.length}` };
    },
  };
  return { adapter, contacted };
}

const listing = (id: string, over: Partial<RawListing> = {}): RawListing => ({
  sourceId: 'fake', externalId: id, url: `https://fake.test/${id}`, title: `Oude Delft ${id}`, priceEur: 950, sizeM2: 30, type: 'studio',
  address: { street: 'Oude Delft', houseNumber: id, postcode: '2611 BC', city: 'Delft' },
  description: 'Mooie studio in het centrum van Delft, gestoffeerd, per direct beschikbaar.', contact: 'form', ...over,
});

async function waitFor(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out');
}

test('a matching listing is found, evaluated and contacted once; a non-matching one is skipped', async () => {
  const paths = home();
  const src = fakeSource([listing('12'), listing('99', { priceEur: 2500, address: { street: 'Coolsingel', houseNumber: '99', city: 'Rotterdam' } })]);
  const h = await startDaemon({ paths, port: 0, adapters: [src.adapter], log: memoryLogger() });
  expect(h.token).toBe(TOKEN);
  handles.push(h);
  await waitFor(() => src.contacted.length === 1);
  const res = await fetch(`${h.url}/api/v1/properties`, { headers: { 'x-nlpf-token': TOKEN } });
  const { items } = (await res.json()) as { items: { property: { title: string }; application: { status: string } | null; match: { passed: boolean } | null }[] };
  const delft = items.find((i) => i.property.title.includes('12'))!;
  expect(delft.application?.status).toBe('contacted');
  await waitFor(() => !!items.length);
  const status = await (await fetch(`${h.url}/api/v1/status`, { headers: { 'x-nlpf-token': TOKEN } })).json();
  expect(status.counts.contactedToday).toBe(1);
  await new Promise((r) => setTimeout(r, 500));
  expect(src.contacted).toEqual(['fake:12']);
});

test('review focus 2: a contact job interrupted by a crash becomes a send_uncertain task and is not sent again', async () => {
  const paths = home();
  const store = openStore(paths.dbFile);
  store.properties.create({ id: 'p1', key: 'k1', address: { city: 'Delft' }, title: 'Oude Delft 12' }, '2026-09-24T08:00:00Z');
  store.jobs.enqueue('contact', 'contact:p1', { propertyId: 'p1' }, '2026-09-24T08:00:00Z');
  store.jobs.claim('2026-09-24T08:00:01Z', 1);
  store.close();
  const src = fakeSource([]);
  const h = await startDaemon({ paths, port: 0, adapters: [src.adapter], log: memoryLogger() });
  handles.push(h);
  const tasks = await (await fetch(`${h.url}/api/v1/tasks`, { headers: { 'x-nlpf-token': TOKEN } })).json();
  expect(tasks.items.map((t: { kind: string }) => t.kind)).toContain('send_uncertain');
  await new Promise((r) => setTimeout(r, 1500));
  expect(src.contacted).toEqual([]);
});

test('paused: listings keep arriving but nothing is sent until resume', async () => {
  const paths = home({ automation: { paused: true, sendWindow: { start: '00:00', end: '23:59' } } });
  const src = fakeSource([listing('7')]);
  const h = await startDaemon({ paths, port: 0, adapters: [src.adapter], log: memoryLogger() });
  handles.push(h);
  const auth = { headers: { 'x-nlpf-token': TOKEN } };
  await new Promise((r) => setTimeout(r, 2000));
  const props = await (await fetch(`${h.url}/api/v1/properties`, auth)).json();
  expect(props.items.length).toBe(1);
  expect(src.contacted).toEqual([]);
  await fetch(`${h.url}/api/v1/resume`, { method: 'POST', ...auth });
  await waitFor(() => src.contacted.length === 1, 10_000);
}, 30_000);

test('a source that blocks us backs off instead of crashing, and recovers', async () => {
  const { SourceBlockedError } = await import('@nlpf/sources');
  const paths = home();
  let calls = 0;
  const adapter: SourceAdapter = {
    id: 'grumpy', name: 'Grumpy', homepage: 'https://grumpy.test', regions: 'nl', defaultIntervalSec: 45,
    capabilities: { search: 'json', detail: false, contact: 'none', login: 'none', terms: 'unknown' },
    buildSearches: () => [{ key: 'all', label: 'all' }],
    search: async () => {
      calls++;
      throw new SourceBlockedError('rate limited', { status: 429, retryAfterSec: 600 });
    },
  };
  const h = await startDaemon({ paths, port: 0, adapters: [adapter], log: memoryLogger() });
  handles.push(h);
  await waitFor(() => calls >= 1);
  await new Promise((r) => setTimeout(r, 500));
  const sources = await (await fetch(`${h.url}/api/v1/sources`, { headers: { 'x-nlpf-token': TOKEN } })).json();
  const grumpy = sources.items.find((s: { sourceId: string }) => s.sourceId === 'grumpy');
  expect(grumpy.lastError).toContain('Blocked');
  expect(Date.parse(grumpy.nextRunAt) - Date.now()).toBeGreaterThan(500_000);
  expect(calls).toBe(1);
});

test('going live after a dry run sends each draft that still matches, once', async () => {
  const paths = home({ automation: { dryRun: true, sendWindow: { start: '00:00', end: '23:59' } } });
  const src = fakeSource([listing('21')]);
  const h = await startDaemon({ paths, port: 0, adapters: [src.adapter], log: memoryLogger() });
  handles.push(h);
  const auth = { 'x-nlpf-token': TOKEN };
  const drafted = async () => {
    const convs = await (await fetch(`${h.url}/api/v1/conversations`, { headers: auth })).json();
    return convs.items.length > 0;
  };
  const end = Date.now() + 10_000;
  while (!(await drafted()) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  expect(src.contacted).toEqual([]);

  const setDryRun = async (dryRun: boolean) => {
    const cfg = await (await fetch(`${h.url}/api/v1/config`, { headers: auth })).json();
    await fetch(`${h.url}/api/v1/config`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ section: 'automation', value: { ...cfg.automation, dryRun } }),
    });
  };
  await setDryRun(false);
  await waitFor(() => src.contacted.length === 1);

  // Switching dry run on and off again does not message the same landlord twice.
  await setDryRun(true);
  await setDryRun(false);
  await new Promise((r) => setTimeout(r, 1500));
  expect(src.contacted).toEqual(['fake:21']);
}, 30_000);

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

test('a home listed only on a source you switched off is neither contacted nor put in your inbox', async () => {
  const paths = home({ sources: { off: { enabled: false } } });
  const store = openStore(paths.dbFile);
  const now = new Date().toISOString();
  const { listing: stored } = store.listings.upsert(listing('31', { sourceId: 'off' }), 'poll', now);
  store.properties.create({ id: 'p31', key: 'k31', address: { city: 'Delft' }, title: 'Oude Delft 31' }, now);
  store.listings.setProperty(stored.id, 'p31');
  store.applications.ensure('p31', now); // queued, as a home drafted before the source was switched off
  store.jobs.enqueue('evaluate', 'evaluate:p31', { propertyId: 'p31' }, now);
  store.close();
  const src = fakeSource([]);
  const off = { ...fakeSource([]).adapter, id: 'off', name: 'Off' };
  const h = await startDaemon({ paths, port: 0, adapters: [src.adapter, off], log: memoryLogger() });
  handles.push(h);
  await new Promise((r) => setTimeout(r, 2500));
  const tasks = await (await fetch(`${h.url}/api/v1/tasks`, { headers: { 'x-nlpf-token': TOKEN } })).json();
  expect(tasks.items).toEqual([]);
  expect(src.contacted).toEqual([]);
  const { items } = await (await fetch(`${h.url}/api/v1/properties`, { headers: { 'x-nlpf-token': TOKEN } })).json();
  expect(items.find((i: { property: { id: string } }) => i.property.id === 'p31')?.application?.status).toBe('skipped');
}, 30_000);

test('a form that shows a captcha is not fought: the message goes to the agency email on the listing', async () => {
  const paths = home({ mail: { provider: 'memory', address: 'sam@example.test' } });
  const src = fakeSource([listing('41', { agent: { name: 'Verra', email: 'denhaag@agency.test' } })]);
  src.adapter.contact = async () => ({ ok: false, channel: 'form', needs: 'captcha', error: 'captcha' });
  const h = await startDaemon({ paths, port: 0, adapters: [src.adapter], log: memoryLogger() });
  handles.push(h);
  const auth = { headers: { 'x-nlpf-token': TOKEN } };
  let status = '';
  const end = Date.now() + 15_000;
  while (status !== 'contacted' && Date.now() < end) {
    const { items } = await (await fetch(`${h.url}/api/v1/properties`, auth)).json();
    status = items[0]?.application?.status ?? '';
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(status).toBe('contacted');
  const tasks = await (await fetch(`${h.url}/api/v1/tasks`, auth)).json();
  expect(tasks.items.filter((t: { kind: string }) => t.kind === 'captcha')).toEqual([]);
}, 30_000);

test('dismissing a send-yourself item closes its application; marking it sent marks it contacted', async () => {
  const paths = home();
  const src = fakeSource([listing('51'), listing('52')]);
  src.adapter.contact = async () => ({ ok: false, channel: 'form', needs: 'captcha', error: 'captcha' });
  const h = await startDaemon({ paths, port: 0, adapters: [src.adapter], log: memoryLogger() });
  handles.push(h);
  const auth = { 'x-nlpf-token': TOKEN };
  const get = async (path: string) => (await fetch(`${h.url}/api/v1${path}`, { headers: auth })).json();
  let tasks: { id: string; kind: string; propertyId: string }[] = [];
  const end = Date.now() + 15_000;
  while (tasks.length < 2 && Date.now() < end) {
    tasks = (await get('/tasks')).items.filter((t: { kind: string }) => t.kind === 'captcha');
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(tasks).toHaveLength(2);
  const resolve = (id: string, action: string) =>
    fetch(`${h.url}/api/v1/tasks/${id}/resolve`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
  await resolve(tasks[0]!.id, 'dismiss');
  await resolve(tasks[1]!.id, 'done');
  const { items } = await get('/properties');
  const statusOf = (pid: string) => items.find((i: { property: { id: string } }) => i.property.id === pid)?.application?.status;
  expect(statusOf(tasks[0]!.propertyId)).toBe('skipped');
  expect(statusOf(tasks[1]!.propertyId)).toBe('contacted');
}, 30_000);

test('a drafted home that no longer fits the search is skipped when going live, not left queued', async () => {
  const paths = home({ automation: { dryRun: true, sendWindow: { start: '00:00', end: '23:59' } } });
  const src = fakeSource([listing('61')]);
  const h = await startDaemon({ paths, port: 0, adapters: [src.adapter], log: memoryLogger() });
  handles.push(h);
  const auth = { 'x-nlpf-token': TOKEN };
  const statusNow = async () => (await (await fetch(`${h.url}/api/v1/properties`, { headers: auth })).json()).items[0]?.application?.status;
  // Wait for the dry-run draft, so no send job is still pending when dry run goes off.
  const drafted = async () => (await (await fetch(`${h.url}/api/v1/conversations`, { headers: auth })).json()).items.length > 0;
  let end = Date.now() + 10_000;
  while (!(await drafted()) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  const patch = async (section: string, value: unknown) =>
    fetch(`${h.url}/api/v1/config`, { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ section, value }) });
  const cfg = await (await fetch(`${h.url}/api/v1/config`, { headers: auth })).json();
  const r = await patch('searches', cfg.searches.map((s: Record<string, unknown>) => ({ ...s, priceMaxEur: 500 })));
  expect(r.status, await r.clone().text()).toBe(200);
  await patch('automation', { ...cfg.automation, dryRun: false });
  end = Date.now() + 10_000;
  while ((await statusNow()) === 'queued' && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  expect(await statusNow()).toBe('skipped');
  expect(src.contacted).toEqual([]);
}, 30_000);

test('when a form needs a person, the inbox item says what the site asked for', async () => {
  const paths = home();
  const src = fakeSource([listing('71')]);
  src.adapter.contact = async () => ({ ok: false, channel: 'form', needs: 'human', error: 'MVGM wants an answer the profile does not give: Vul a_spaargeld in' });
  const h = await startDaemon({ paths, port: 0, adapters: [src.adapter], log: memoryLogger() });
  handles.push(h);
  let reason = '';
  const end = Date.now() + 15_000;
  while (!reason && Date.now() < end) {
    const { items } = await (await fetch(`${h.url}/api/v1/tasks`, { headers: { 'x-nlpf-token': TOKEN } })).json();
    reason = items.find((t: { kind: string }) => t.kind === 'send_uncertain')?.reason ?? '';
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(reason).toContain('Vul a_spaargeld in');
}, 30_000);

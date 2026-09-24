import { expect, test, vi } from 'vitest';
import { ConfigSchema, memoryLogger, type BrowserSession, type FetchResult } from '@nlpf/core';
import { SourceBlockedError, SourceHttpError, createSourceContext, type BrowserMode, type PoliteFetch } from '../src/index.js';
import { fixtureContext } from '../src/testing.js';

const config = ConfigSchema.parse({
  profile: { firstName: 'Sam' },
  searches: [
    { id: 'main', name: 'Main' },
    { id: 'off', name: 'Off', enabled: false },
  ],
  sources: { funda: { intervalSec: 60 } },
});

function fakes() {
  const calls: { url: string; signal?: AbortSignal | null }[] = [];
  const fetch: PoliteFetch = async (url, init) => {
    calls.push({ url, signal: init?.signal });
    return { status: 200, url, headers: new Headers(), text: 'ok', notModified: false, json: () => ({}) } as FetchResult;
  };
  const sessions: { mode: BrowserMode | undefined; closed: boolean }[] = [];
  const pool = {
    session: vi.fn(async (_id: string, o?: { mode?: BrowserMode }): Promise<BrowserSession> => {
      const s = { mode: o?.mode, closed: false };
      sessions.push(s);
      return { page: {} as BrowserSession['page'], close: async () => void (s.closed = true) };
    }),
  };
  return { calls, fetch, pool, sessions };
}

test('exposes the profile, enabled searches, the source config and a scoped logger', () => {
  const { fetch, pool } = fakes();
  const log = memoryLogger();
  const ctx = createSourceContext({ fetch, pool, log, config, sourceId: 'funda', signal: new AbortController().signal });
  expect(ctx.profile.firstName).toBe('Sam');
  expect(ctx.searches.map((s) => s.id)).toEqual(['main']);
  expect(ctx.source.intervalSec).toBe(60);
  ctx.log.info('hello');
  expect(log.entries[0]?.data).toMatchObject({ source: 'funda' });
  expect(ctx.now()).toBeInstanceOf(Date);
});

test('a source missing from config gets the default source config', () => {
  const { fetch, pool } = fakes();
  const ctx = createSourceContext({ fetch, pool, log: memoryLogger(), config, sourceId: 'kamernet', signal: new AbortController().signal });
  expect(ctx.source).toEqual({ enabled: true, searchUrls: [], options: {} });
});

test('fetch carries the job signal, merged with a caller signal', async () => {
  const { fetch, pool, calls } = fakes();
  const job = new AbortController();
  const ctx = createSourceContext({ fetch, pool, log: memoryLogger(), config, sourceId: 'funda', signal: job.signal });
  await ctx.fetch('https://example.test/a');
  expect(calls[0]?.signal).toBe(job.signal);
  const own = new AbortController();
  await ctx.fetch('https://example.test/b', { signal: own.signal });
  const merged = calls[1]?.signal;
  expect(merged?.aborted).toBe(false);
  job.abort();
  expect(merged?.aborted).toBe(true);
});

test('browser() asks the pool for a headless session unless headed is requested', async () => {
  const { fetch, pool, sessions } = fakes();
  const ctx = createSourceContext({ fetch, pool, log: memoryLogger(), config, sourceId: 'pararius', signal: new AbortController().signal });
  await ctx.browser();
  await ctx.browser({ headed: true });
  expect(pool.session).toHaveBeenCalledWith('pararius', { mode: 'headless' });
  expect(pool.session).toHaveBeenCalledWith('pararius', { mode: 'headed' });
  expect(sessions.map((s) => s.mode)).toEqual(['headless', 'headed']);
});

test('aborting the job closes browser sessions the adapter left open', async () => {
  const { fetch, pool, sessions } = fakes();
  const job = new AbortController();
  const ctx = createSourceContext({ fetch, pool, log: memoryLogger(), config, sourceId: 'pararius', signal: job.signal });
  const a = await ctx.browser();
  await ctx.browser();
  await a.close();
  job.abort();
  await new Promise((r) => setTimeout(r, 0));
  expect(sessions.map((s) => s.closed)).toEqual([true, true]);
  await expect(ctx.browser()).rejects.toThrow();
});

test('fixtureContext serves files by URL substring and records requests', async () => {
  const ctx = fixtureContext({
    sourceId: 'agency:example',
    routes: {
      'example-makelaar.nl/aanbod/woningaanbod/huur/': 'agency-example/list.html',
    },
    config: { sources: { 'agency:example': { intervalSec: 300 } } },
  });
  const res = await ctx.fetch('https://www.example-makelaar.nl/aanbod/woningaanbod/huur/', {
    method: 'POST',
    body: JSON.stringify({ q: 1 }),
  });
  expect(res.text).toContain('object');
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(ctx.requests).toEqual([
    expect.objectContaining({ url: 'https://www.example-makelaar.nl/aanbod/woningaanbod/huur/', method: 'POST', body: '{"q":1}' }),
  ]);
  expect(ctx.source.intervalSec).toBe(300);
  await expect(ctx.fetch('https://elsewhere.test/')).rejects.toBeInstanceOf(SourceHttpError);
  await expect(ctx.browser()).rejects.toThrow(/no browser/);
});

test('fixtureContext routes can be blocks, inline JSON and method-specific', async () => {
  const ctx = fixtureContext({
    routes: [
      { match: /\/api\/search/, method: 'POST', body: { items: [1] } },
      { match: '/api/search', status: 429, headers: { 'retry-after': '60' } },
    ],
    now: new Date('2026-09-23T10:00:00Z'),
  });
  expect((await ctx.fetch('https://x.test/api/search', { method: 'POST' })).json()).toEqual({ items: [1] });
  const err = (await ctx.fetch('https://x.test/api/search').catch((e: unknown) => e)) as SourceBlockedError;
  expect(err).toBeInstanceOf(SourceBlockedError);
  expect(err.retryAfterSec).toBe(60);
  expect(ctx.now().toISOString()).toBe('2026-09-23T10:00:00.000Z');
});

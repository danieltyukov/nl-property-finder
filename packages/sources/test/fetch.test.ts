import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { memoryLogger } from '@nlpf/core';
import {
  ACCEPT_LANGUAGE,
  SourceBlockedError,
  SourceHttpError,
  createPoliteFetch,
  detectChallenge,
} from '../src/index.js';
import { startFixtureServer, type FixtureServer } from '../src/testing.js';

let server: FixtureServer;
let etagHits = 0;

beforeAll(async () => {
  server = await startFixtureServer({
    '/a': { body: 'a' },
    '/b': { body: 'b' },
    '/limited': { status: 429, headers: { 'retry-after': '30' }, body: 'slow down' },
    '/forbidden': { status: 403, body: 'no' },
    '/challenge': {
      headers: { 'content-type': 'text/html' },
      body: '<html><head><title>Even geduld...</title></head><body><script>window._cf_chl_opt={};</script><div id="cf-chl-widget"></div></body></html>',
    },
    '/recaptcha-form': {
      headers: { 'content-type': 'text/html' },
      body: '<html><title>Contact</title><script src="https://www.google.com/recaptcha/api.js"></script><form></form></html>',
    },
    '/json-with-captcha-word': { headers: { 'content-type': 'application/json' }, body: '{"note":"captcha"}' },
    '/missing': { status: 404, body: 'not here' },
    '/etag': (req) => {
      etagHits++;
      if (req.headers['if-none-match'] === '"v1"') return { status: 304 };
      return { headers: { etag: '"v1"', 'content-type': 'application/json' }, body: '{"items":[1,2,3]}' };
    },
    '/echo-headers': (req) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.headers) }),
    '/latin1': () => ({
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      body: Buffer.from('<p>Caf\xe9 op de ge\xefnteresseerde</p>', 'latin1'),
    }),
    '/slow': async () => {
      await new Promise((r) => setTimeout(r, 500));
      return { body: 'late' };
    },
  });
});

afterAll(() => server.close());
afterEach(() => vi.useRealTimers());

test('two requests to one host start at least minGapMs apart', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const starts: number[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    starts.push(Date.now());
    return fetch(input, init);
  };
  const pf = createPoliteFetch({ minGapMs: 200, log: memoryLogger(), fetchImpl });
  const first = pf(`${server.url}/a`);
  await vi.advanceTimersByTimeAsync(50);
  const second = pf(`${server.url}/b`);
  await vi.advanceTimersByTimeAsync(149);
  expect(starts).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(starts).toHaveLength(2);
  const [a, b] = await Promise.all([first, second]);
  expect(a.text).toBe('a');
  expect(b.text).toBe('b');
  expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(200);
});

test('different hosts do not wait for each other', async () => {
  const pf = createPoliteFetch({ minGapMs: 10_000, log: memoryLogger() });
  const other = server.url.replace('127.0.0.1', 'localhost');
  const t0 = Date.now();
  await Promise.all([pf(`${server.url}/a`), pf(`${other}/b`)]);
  expect(Date.now() - t0).toBeLessThan(5_000);
});

test('a 429 with Retry-After throws SourceBlockedError with retryAfterSec', async () => {
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger() });
  const err = await pf(`${server.url}/limited`).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SourceBlockedError);
  expect((err as SourceBlockedError).status).toBe(429);
  expect((err as SourceBlockedError).retryAfterSec).toBe(30);
});

test('after a Retry-After the host is not contacted again until it passes', async () => {
  let t = 1_000_000;
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger(), now: () => t });
  await expect(pf(`${server.url}/limited`)).rejects.toBeInstanceOf(SourceBlockedError);
  const before = server.requests.length;
  const err = (await pf(`${server.url}/a`).catch((e: unknown) => e)) as SourceBlockedError;
  expect(err).toBeInstanceOf(SourceBlockedError);
  expect(err.retryAfterSec).toBe(30);
  expect(server.requests.length).toBe(before);
  t += 31_000;
  expect((await pf(`${server.url}/a`)).text).toBe('a');
});

test('a 403 is a block', async () => {
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger() });
  const err = await pf(`${server.url}/forbidden`).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SourceBlockedError);
  expect((err as SourceBlockedError).status).toBe(403);
});

test('a 200 challenge page throws SourceBlockedError', async () => {
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger() });
  const err = await pf(`${server.url}/challenge`).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SourceBlockedError);
  expect((err as SourceBlockedError).status).toBe(200);
  expect((err as SourceBlockedError).marker).toBe('cf-chl');
});

test('a normal form page with reCAPTCHA and a JSON body mentioning captcha are not blocks', async () => {
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger() });
  expect((await pf(`${server.url}/recaptcha-form`)).status).toBe(200);
  expect((await pf(`${server.url}/json-with-captcha-word`)).json()).toEqual({ note: 'captcha' });
});

test('other non-2xx responses throw SourceHttpError', async () => {
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger() });
  const err = await pf(`${server.url}/missing`).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SourceHttpError);
  expect((err as SourceHttpError).status).toBe(404);
});

test('a second request is conditional and a 304 returns the cached text', async () => {
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger() });
  etagHits = 0;
  const first = await pf(`${server.url}/etag`);
  expect(first.notModified).toBe(false);
  expect(first.json()).toEqual({ items: [1, 2, 3] });
  const second = await pf(`${server.url}/etag`);
  expect(etagHits).toBe(2);
  expect(second.notModified).toBe(true);
  expect(second.status).toBe(304);
  expect(second.text).toBe(first.text);
  expect(second.json()).toEqual({ items: [1, 2, 3] });
});

test('sends Dutch Accept-Language and a desktop Chrome user agent; caller headers win', async () => {
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger() });
  const sent = (await pf(`${server.url}/echo-headers`)).json<Record<string, string>>();
  expect(sent['accept-language']).toBe(ACCEPT_LANGUAGE);
  expect(sent['user-agent']).toMatch(/Mozilla\/5\.0 .* Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
  const custom = (await pf(`${server.url}/echo-headers`, { headers: { 'Accept-Language': 'en' } })).json<Record<string, string>>();
  expect(custom['accept-language']).toBe('en');
});

test('decodes the declared charset', async () => {
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger() });
  expect((await pf(`${server.url}/latin1`)).text).toContain('Café op de geïnteresseerde');
});

test('a timeout becomes SourceHttpError with status 0; a caller abort stays an abort', async () => {
  const pf = createPoliteFetch({ minGapMs: 0, log: memoryLogger() });
  const err = await pf(`${server.url}/slow`, { timeoutMs: 50 }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(SourceHttpError);
  expect((err as SourceHttpError).status).toBe(0);
  const ac = new AbortController();
  const pending = pf(`${server.url}/slow`, { signal: ac.signal });
  ac.abort(new Error('job cancelled'));
  await expect(pending).rejects.toThrow('job cancelled');
});

test('detectChallenge knows the common markers and ignores ordinary pages', () => {
  expect(detectChallenge('<div class="cf-chl-widget"></div>')).toBe('cf-chl');
  expect(detectChallenge('<div id="px-captcha"></div>' + 'x'.repeat(100_000))).toBe('px-captcha');
  expect(detectChallenge('<iframe src="https://geo.captcha-delivery.com/captcha/"></iframe>')).toBe('datadome');
  expect(detectChallenge('<html><title>Just a moment...</title></html>')).toBe('challenge');
  expect(detectChallenge('<p>Please solve the captcha to continue</p>')).toBe('captcha');
  expect(detectChallenge('<script src="https://www.google.com/recaptcha/api.js"></script>')).toBeUndefined();
  expect(detectChallenge('{"captcha":true}', 'application/json')).toBeUndefined();
  expect(detectChallenge('<p>' + 'woning '.repeat(10_000) + ' captcha</p>')).toBeUndefined();
});

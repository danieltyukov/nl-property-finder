import { afterEach, expect, test, vi } from 'vitest';
import { memoryLogger, type BrowserSession, type SourceAdapter, type SourceContext } from '@nlpf/core';
import { connectSource, type BrowserMode, type PoliteFetch } from '../src/index.js';

afterEach(() => vi.useRealTimers());

function fakePool() {
  const opened: { mode?: BrowserMode; closed: boolean; page: { goto: ReturnType<typeof vi.fn>; closedByUser: boolean } }[] = [];
  const pool = {
    session: vi.fn(async (_id: string, o?: { mode?: BrowserMode }): Promise<BrowserSession> => {
      const page = { goto: vi.fn(async () => null), closedByUser: false, isClosed: () => page.closedByUser };
      const rec = { mode: o?.mode, closed: false, page };
      opened.push(rec);
      return { page: page as unknown as BrowserSession['page'], close: async () => void (rec.closed = true) };
    }),
  };
  return { pool, opened };
}

const noFetch: PoliteFetch = async () => {
  throw new Error('no network in this test');
};

function adapter(check: (ctx: SourceContext) => Promise<'ok' | 'expired' | 'none'>): SourceAdapter {
  return {
    id: 'pararius',
    name: 'Pararius',
    homepage: 'https://www.pararius.nl',
    loginUrl: 'https://www.pararius.nl/inloggen',
    regions: 'nl',
    defaultIntervalSec: 150,
    capabilities: { search: 'browser', detail: true, contact: 'form', login: 'required', terms: 'forbids', browser: 'headed' },
    buildSearches: () => [],
    search: async () => [],
    checkSession: check,
  };
}

test('opens a visible window on the login page, checks every 3 s, and closes it once logged in', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const { pool, opened } = fakePool();
  const checks: number[] = [];
  const a = adapter(async (ctx) => {
    checks.push(Date.now());
    const s = await ctx.browser();
    await s.close();
    return checks.length >= 3 ? 'ok' : 'expired';
  });
  const result = connectSource(a, pool, memoryLogger(), 600_000, { fetch: noFetch });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await result).toBe('ok');
  expect(opened[0]?.mode).toBe('visible');
  expect(opened[0]?.page.goto).toHaveBeenCalledWith('https://www.pararius.nl/inloggen', expect.anything());
  expect(checks[1]! - checks[0]!).toBe(3000);
  expect(checks[2]! - checks[1]!).toBe(3000);
  // Checks ask for ordinary sessions; the pool turns them into background tabs of the visible window.
  expect(opened.slice(1).every((o) => o.mode === 'headless')).toBe(true);
  expect(opened.every((o) => o.closed)).toBe(true);
});

test('returns timeout when no login shows up in time, and still closes the window', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const { pool, opened } = fakePool();
  const check = vi.fn(async () => 'none' as const);
  const result = connectSource(adapter(check), pool, memoryLogger(), 10_000, { fetch: noFetch });
  await vi.advanceTimersByTimeAsync(11_000);
  expect(await result).toBe('timeout');
  expect(check).toHaveBeenCalledTimes(5); // at 0, 3, 6, 9 and 10 s
  expect(opened[0]?.closed).toBe(true);
});

test('a failing check counts as not logged in yet', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const { pool } = fakePool();
  let n = 0;
  const result = connectSource(
    adapter(async () => {
      n++;
      if (n === 1) throw new Error('page navigated during the check');
      return 'ok';
    }),
    pool,
    memoryLogger(),
    600_000,
    { fetch: noFetch },
  );
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await result).toBe('ok');
});

test('when the person closes the window, the browser is closed first and one last check decides', async () => {
  const { pool, opened } = fakePool();
  const seenWindowClosed: boolean[] = [];
  const result = connectSource(
    adapter(async () => {
      seenWindowClosed.push(opened[0]?.closed ?? false);
      return opened[0]?.page.closedByUser ? 'ok' : 'none';
    }),
    pool,
    memoryLogger(),
    600_000,
    { fetch: noFetch, intervalMs: 20 },
  );
  await new Promise((r) => setTimeout(r, 30));
  opened[0]!.page.closedByUser = true;
  expect(await result).toBe('ok');
  expect(seenWindowClosed.at(-1)).toBe(true);
});

test('a source without a session check cannot be connected', async () => {
  const { pool } = fakePool();
  const a = adapter(async () => 'ok');
  delete a.checkSession;
  await expect(connectSource(a, pool, memoryLogger())).rejects.toThrow(/Pararius/);
  expect(pool.session).not.toHaveBeenCalled();
});

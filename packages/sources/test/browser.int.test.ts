import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { memoryLogger } from '@nlpf/core';
import { createBrowserPool, findExecutable, resolveChromium } from '../src/index.js';
import { startFixtureServer, type FixtureServer } from '../src/testing.js';

const chromiumPath = resolveChromium();
const linux = process.platform === 'linux';
const haveXvfb = linux && Boolean(findExecutable('Xvfb'));
const haveXwininfo = linux && Boolean(findExecutable('xwininfo'));

/** Browser processes (any Chromium process type) started with this profile folder. Linux only. */
function browserPids(profileDir: string): number[] {
  if (!linux) return [];
  const pids: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      // Chromium rewrites its argv, so match on the whole string rather than NUL-separated args.
      if (readFileSync(`/proc/${entry}/cmdline`, 'utf8').includes(`--user-data-dir=${profileDir}`)) pids.push(Number(entry));
    } catch {
      // the process ended while we looked
    }
  }
  return pids;
}

async function eventually(check: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

/**
 * Top-level windows on an X display whose WM_CLASS names this profile folder
 * (Chromium puts the user-data-dir in it), or null when the display cannot
 * be queried.
 */
function windowsOf(display: string, profileDir: string, xauthority?: string): string[] | null {
  try {
    const out = execFileSync('xwininfo', ['-root', '-tree', '-display', display], {
      env: { ...process.env, ...(xauthority ? { XAUTHORITY: xauthority } : {}) },
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).toString();
    return out.split('\n').filter((l) => l.includes(`(${profileDir})`));
  } catch {
    return null;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(!chromiumPath)('browser pool with a real Chromium', () => {
  let server: FixtureServer;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-pool-'));
    server = await startFixtureServer({
      '/': { body: '<!doctype html><title>Pool test page</title><h1>ok</h1>' },
      '/login': {
        headers: { 'set-cookie': 'session=abc123; Path=/; Max-Age=3600' },
        body: '<!doctype html><title>Logged in</title>',
      },
    });
  });

  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('a headless session loads a local page and reads its title', async () => {
    const pool = createBrowserPool({ dir, log: memoryLogger() });
    const profile = join(dir, 'local');
    try {
      const s = await pool.session('local', { mode: 'headless' });
      expect(s.mode).toBe('headless');
      await s.page.goto(`${server.url}/`);
      expect(await s.page.title()).toBe('Pool test page');
      expect(await s.page.evaluate(() => navigator.userAgent)).not.toMatch(/headless/i);
      expect(await s.page.evaluate(() => navigator.webdriver)).toBe(false);
      await s.close();
      expect(pool.info().contexts).toEqual([{ sourceId: 'local', mode: 'headless', pages: 0 }]);
    } finally {
      await pool.closeAll();
    }
    expect(pool.info().contexts).toEqual([]);
    expect(await eventually(() => browserPids(profile).length === 0)).toBe(true);
  });

  test('the profile keeps cookies across browser restarts', async () => {
    const first = createBrowserPool({ dir, log: memoryLogger() });
    try {
      const s = await first.session('persist');
      await s.page.goto(`${server.url}/login`);
      await s.close();
    } finally {
      await first.closeAll();
    }
    const second = createBrowserPool({ dir, log: memoryLogger() });
    try {
      const s = await second.session('persist');
      const cookies = await s.page.context().cookies(server.url);
      expect(cookies.find((c) => c.name === 'session')?.value).toBe('abc123');
    } finally {
      await second.closeAll();
    }
  });

  test.skipIf(!haveXvfb)('a headed session draws on a private Xvfb display and never on the user display', async () => {
    const userDisplay = process.env.DISPLAY;
    const userWayland = process.env.WAYLAND_DISPLAY;
    const pool = createBrowserPool({ dir, log: memoryLogger() });
    const profile = join(dir, 'headed');
    let display = '';
    let xvfbPid = 0;
    try {
      const s = await pool.session('headed', { mode: 'headed' });
      expect(s.mode).toBe('headed');
      display = s.display ?? '';
      expect(display).toMatch(/^:\d+$/);
      expect(display).not.toBe(userDisplay);
      expect(pool.info().display).toBe(display);
      // Our own environment is untouched: only the browser got the private DISPLAY.
      expect(process.env.DISPLAY).toBe(userDisplay);
      expect(process.env.WAYLAND_DISPLAY).toBe(userWayland);

      await s.page.goto(`${server.url}/`);
      expect(await s.page.title()).toBe('Pool test page');

      // The browser runs on the X11 backend, so WAYLAND_DISPLAY could not route it to the desktop.
      const version = await s.page.context().newPage();
      await version.goto('chrome://version');
      expect(await version.locator('body').innerText()).toContain('--ozone-platform=x11');
      await version.close();

      xvfbPid = Number(readFileSync(`/tmp/.X${display.slice(1)}-lock`, 'utf8').trim());
      expect(alive(xvfbPid)).toBe(true);

      if (haveXwininfo) {
        const onPrivate = windowsOf(display, profile, pool.info().xauthority);
        expect(onPrivate?.length ?? 0).toBeGreaterThan(0);
        if (userDisplay) {
          const onUser = windowsOf(userDisplay, profile);
          if (onUser !== null) expect(onUser).toEqual([]);
        }
      }
      await s.close();
    } finally {
      await pool.closeAll();
    }
    expect(await eventually(() => !alive(xvfbPid))).toBe(true);
    expect(existsSync(`/tmp/.X11-unix/X${display.slice(1)}`)).toBe(false);
    expect(await eventually(() => browserPids(profile).length === 0)).toBe(true);
    expect(pool.info().display).toBeUndefined();
  });

  test.skipIf(!haveXvfb)('asking for headed restarts a headless browser on the same profile; headless then reuses it', async () => {
    const pool = createBrowserPool({ dir, log: memoryLogger() });
    try {
      const a = await pool.session('upgrade', { mode: 'headless' });
      await a.page.goto(`${server.url}/login`);
      await a.close();
      const b = await pool.session('upgrade', { mode: 'headed' });
      expect(b.mode).toBe('headed');
      expect((await b.page.context().cookies(server.url)).map((c) => c.name)).toContain('session');
      const c = await pool.session('upgrade', { mode: 'headless' });
      expect(c.mode).toBe('headed');
      expect(c.page.context()).toBe(b.page.context());
      await Promise.all([b.close(), c.close()]);
      expect(pool.info().contexts).toEqual([{ sourceId: 'upgrade', mode: 'headed', pages: 0 }]);
    } finally {
      await pool.closeAll();
    }
  });
});

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { BrowserSession, Logger } from '@nlpf/core';
import { chromeMajorVersion, resolveChromium } from './chromium.js';
import { BrowserUnavailableError } from './errors.js';
import { CHROME_MAJOR, desktopUserAgent } from './fetch.js';
import { findExecutable, startXvfb, type XvfbDisplay } from './xvfb.js';

/**
 * - `headless`: no window at all.
 * - `headed`: a real window that nobody sees. On Linux it is drawn on a
 *   private Xvfb display; on macOS and Windows it is placed off-screen. Sites
 *   behind a Cloudflare managed challenge only let this mode through.
 * - `visible`: a window on the user's own screen, only for `nlpf connect`.
 */
export type BrowserMode = 'headless' | 'headed' | 'visible';

/**
 * Where `headed` windows go: `auto` uses Xvfb on Linux when it is installed
 * and an off-screen window otherwise; `xvfb` insists on Xvfb; `native` uses
 * the desktop with an off-screen window position (fine on macOS and
 * Windows; on Linux under Wayland the compositor may ignore the position).
 */
export type DisplayMode = 'auto' | 'xvfb' | 'native';

export interface PoolSession extends BrowserSession {
  /** The mode the browser behind this page actually runs in. */
  readonly mode: BrowserMode;
  /** DISPLAY the browser draws on, for headed and visible sessions on Linux. */
  readonly display?: string;
}

export interface BrowserPoolOptions {
  /** Profiles live under `<dir>/<sourceId>`. The daemon passes `paths.browserDir`. */
  dir: string;
  executablePath?: string;
  display?: DisplayMode;
  log: Logger;
  /** Close a source's browser after this long without an open page. Default 15 minutes. */
  idleMs?: number;
  /** How long a mode change waits for open pages to finish. Default 30 s. */
  drainMs?: number;
  /** Environment the browsers start from. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface BrowserPoolInfo {
  executablePath?: string;
  /** The private Xvfb display, once one was started. */
  display?: string;
  xauthority?: string;
  contexts: { sourceId: string; mode: BrowserMode; pages: number }[];
}

export interface BrowserPool {
  session(sourceId: string, opts?: { mode?: BrowserMode }): Promise<PoolSession>;
  closeAll(): Promise<void>;
  info(): BrowserPoolInfo;
}

interface Entry {
  sourceId: string;
  mode: BrowserMode;
  display?: string;
  ready: Promise<BrowserContext>;
  sessions: Set<PoolSession>;
  initialPageFree: boolean;
  idle?: NodeJS.Timeout;
  closed: boolean;
}

const RANK: Record<BrowserMode, number> = { headless: 1, headed: 2, visible: 3 };

/** Folder name for a source's profile ("agency:de-gracht" becomes "agency_de-gracht"). */
export function profileDirName(sourceId: string): string {
  return sourceId.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

const BASE_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-search-engine-choice-screen',
];

/**
 * One persistent Chromium profile per source, kept warm between polls so a
 * contact form submits in seconds and challenge cookies (`cf_clearance`)
 * survive. A source's browser runs in one mode at a time: asking for a
 * higher mode (headless, then headed, then visible) waits for open pages and
 * restarts the browser on the same profile; asking for a lower mode reuses
 * the running one. While a `visible` window is open, other sessions for that
 * source get background tabs in it, so they never take focus from the person
 * logging in. Closing the visible session closes that browser, and later
 * sessions reopen the profile with the new cookies.
 */
export function createBrowserPool(opts: BrowserPoolOptions): BrowserPool {
  const { log } = opts;
  const platform = opts.platform ?? process.platform;
  const baseEnv = opts.env ?? process.env;
  const displayMode = opts.display ?? 'auto';
  const idleMs = opts.idleMs ?? 15 * 60_000;
  const drainMs = opts.drainMs ?? 30_000;
  const entries = new Map<string, Entry>();
  const locks = new Map<string, Promise<unknown>>();
  let executable: string | undefined;
  let xvfb: Promise<XvfbDisplay> | undefined;
  let xvfbHandle: XvfbDisplay | undefined;
  const warned = new Set<string>();

  const warnOnce = (key: string, msg: string, data?: Record<string, unknown>) => {
    if (warned.has(key)) return;
    warned.add(key);
    log.warn(msg, data);
  };

  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }

  const hasDesktop = () => Boolean(baseEnv.DISPLAY || baseEnv.WAYLAND_DISPLAY);

  function effectiveMode(requested: BrowserMode): BrowserMode {
    if (platform !== 'linux') return requested;
    if (requested === 'visible') {
      if (!hasDesktop()) throw new Error('a visible window needs a desktop session, and neither DISPLAY nor WAYLAND_DISPLAY is set');
      return requested;
    }
    if (requested !== 'headed') return requested;
    const haveXvfb = Boolean(findExecutable('Xvfb', baseEnv));
    if (displayMode === 'xvfb' && !haveXvfb) throw new Error('display "xvfb" was requested but Xvfb is not installed');
    if (displayMode !== 'native' && haveXvfb) return 'headed';
    if (baseEnv.DISPLAY) {
      warnOnce('offscreen', 'Xvfb is not installed; headed browsers open off-screen on your own display. Install Xvfb to keep them out of sight.');
      return 'headed';
    }
    warnOnce('headless', 'no Xvfb and no X display: headed sessions run headless, so sites behind a Cloudflare challenge may refuse them');
    return 'headless';
  }

  function ensureXvfb(): Promise<XvfbDisplay> {
    if (xvfbHandle && !xvfbHandle.running()) {
      xvfb = undefined;
      xvfbHandle = undefined;
    }
    xvfb ??= startXvfb({ log }).then(
      (h) => (xvfbHandle = h),
      (e: unknown) => {
        xvfb = undefined;
        throw e;
      },
    );
    return xvfb;
  }

  async function launch(entry: Entry): Promise<BrowserContext> {
    executable ??= resolveChromium({ executablePath: opts.executablePath, env: baseEnv, platform });
    if (!executable) {
      throw new BrowserUnavailableError(
        'No Chromium found. Install one with `npx playwright-core install chromium`, or set PLAYWRIGHT_CHROMIUM_EXECUTABLE.',
      );
    }
    const userDataDir = join(opts.dir, profileDirName(entry.sourceId));
    mkdirSync(userDataDir, { recursive: true });
    const env: Record<string, string | undefined> = { ...baseEnv };
    const args = [...BASE_ARGS];
    const { mode } = entry;

    if (mode === 'headed') {
      args.push('--window-size=1440,900');
      const useXvfb = platform === 'linux' && displayMode !== 'native' && Boolean(findExecutable('Xvfb', baseEnv));
      if (useXvfb) {
        const x = await ensureXvfb();
        env.DISPLAY = x.display;
        delete env.WAYLAND_DISPLAY;
        if (x.xauthority) env.XAUTHORITY = x.xauthority;
        args.push('--ozone-platform=x11');
        entry.display = x.display;
      } else {
        args.push('--window-position=-32000,-32000');
        if (platform === 'linux') {
          // X11 honours window positions; a Wayland compositor would not.
          delete env.WAYLAND_DISPLAY;
          args.push('--ozone-platform=x11');
          entry.display = env.DISPLAY;
        }
      }
    } else if (mode === 'visible') {
      args.push('--window-size=1280,900');
      entry.display = env.DISPLAY ?? env.WAYLAND_DISPLAY;
    }

    const major = mode === 'headless' ? await chromeMajorVersion(executable, platform) : undefined;
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: executable,
      headless: mode === 'headless',
      args,
      ignoreDefaultArgs: ['--enable-automation'],
      env,
      viewport: mode === 'headless' ? { width: 1440, height: 900 } : null,
      locale: 'nl-NL',
      timezoneId: 'Europe/Amsterdam',
      // Headless Chrome announces itself as "HeadlessChrome"; present the same browser as a desktop one.
      ...(mode === 'headless' ? { userAgent: desktopUserAgent(platform, major ?? CHROME_MAJOR) } : {}),
    });
    context.on('close', () => {
      entry.closed = true;
      clearIdle(entry);
      if (entries.get(entry.sourceId) === entry) entries.delete(entry.sourceId);
    });
    log.debug('browser started', { source: entry.sourceId, mode, display: entry.display });
    return context;
  }

  function clearIdle(entry: Entry) {
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = undefined;
  }

  function scheduleIdle(entry: Entry) {
    clearIdle(entry);
    entry.idle = setTimeout(() => {
      void withLock(entry.sourceId, async () => {
        if (!entry.closed && entry.sessions.size === 0) {
          log.debug('closing an idle browser', { source: entry.sourceId });
          await closeEntry(entry);
        }
      });
    }, idleMs);
    entry.idle.unref();
  }

  async function closeEntry(entry: Entry): Promise<void> {
    entry.closed = true;
    clearIdle(entry);
    if (entries.get(entry.sourceId) === entry) entries.delete(entry.sourceId);
    try {
      const context = await entry.ready;
      await context.close();
    } catch {
      // A browser that failed to start or already exited has nothing to close.
    }
  }

  async function drain(entry: Entry): Promise<void> {
    const deadline = Date.now() + drainMs;
    while (entry.sessions.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    if (entry.sessions.size > 0) {
      log.warn('restarting a browser in another mode while pages are still open', { source: entry.sourceId, pages: entry.sessions.size });
    }
  }

  async function backgroundPage(context: BrowserContext): Promise<Page> {
    const browser = context.browser();
    if (!browser) return context.newPage();
    const cdp = await browser.newBrowserCDPSession();
    try {
      const before = new Set(context.pages());
      const next = context.waitForEvent('page', { predicate: (p) => !before.has(p), timeout: 10_000 });
      next.catch(() => undefined);
      await cdp.send('Target.createTarget', { url: 'about:blank', background: true });
      return await next;
    } catch {
      return context.newPage();
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  }

  async function openPage(entry: Entry, context: BrowserContext, requested: BrowserMode): Promise<Page> {
    if (entry.mode === 'visible' && requested !== 'visible') return backgroundPage(context);
    if (entry.mode === 'visible' && entry.initialPageFree) {
      const first = context.pages()[0];
      entry.initialPageFree = false;
      if (first) {
        await first.bringToFront().catch(() => undefined);
        return first;
      }
    }
    // Headless and headed browsers keep their first tab as a placeholder, so
    // closing a session's page never closes the last window (which would end
    // the browser and throw away the warm profile).
    return context.newPage();
  }

  function startEntry(sourceId: string, mode: BrowserMode): Entry {
    const entry: Entry = {
      sourceId,
      mode,
      ready: undefined as unknown as Promise<BrowserContext>,
      sessions: new Set(),
      initialPageFree: true,
      closed: false,
    };
    entry.ready = launch(entry);
    entry.ready.catch(() => {
      entry.closed = true;
      if (entries.get(sourceId) === entry) entries.delete(sourceId);
    });
    entries.set(sourceId, entry);
    return entry;
  }

  return {
    session(sourceId, o = {}) {
      const requested = o.mode ?? 'headless';
      return withLock(sourceId, async () => {
        const want = effectiveMode(requested);
        let entry = entries.get(sourceId);
        if (entry?.closed) entry = undefined;
        if (entry && RANK[entry.mode] < RANK[want]) {
          await drain(entry);
          await closeEntry(entry);
          entry = undefined;
        }
        entry ??= startEntry(sourceId, want);
        const context = await entry.ready;
        clearIdle(entry);
        const page = await openPage(entry, context, want);
        const owner = entry;
        const ownsBrowser = owner.mode === 'visible' && want === 'visible';
        let done = false;
        const session: PoolSession = {
          page,
          mode: owner.mode,
          ...(owner.display ? { display: owner.display } : {}),
          close: async () => {
            if (done) return;
            done = true;
            owner.sessions.delete(session);
            if (ownsBrowser) {
              await withLock(sourceId, () => closeEntry(owner));
              return;
            }
            await page.close().catch(() => undefined);
            if (owner.sessions.size === 0 && !owner.closed) scheduleIdle(owner);
          },
        };
        owner.sessions.add(session);
        return session;
      });
    },

    async closeAll() {
      const all = [...entries.values()];
      entries.clear();
      await Promise.all(all.map((e) => closeEntry(e)));
      const pending = xvfb;
      xvfb = undefined;
      xvfbHandle = undefined;
      const x = await pending?.catch(() => undefined);
      await x?.stop();
    },

    info() {
      return {
        ...(executable ? { executablePath: executable } : {}),
        ...(xvfbHandle ? { display: xvfbHandle.display } : {}),
        ...(xvfbHandle?.xauthority ? { xauthority: xvfbHandle.xauthority } : {}),
        contexts: [...entries.values()].map((e) => ({ sourceId: e.sourceId, mode: e.mode, pages: e.sessions.size })),
      };
    },
  };
}

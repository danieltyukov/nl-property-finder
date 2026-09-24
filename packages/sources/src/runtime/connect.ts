import { ConfigSchema, type Config, type Logger, type SourceAdapter } from '@nlpf/core';
import { createSourceContext, type SessionProvider } from './context.js';
import { createPoliteFetch, sleep, type PoliteFetch } from './fetch.js';

export interface ConnectOptions {
  /** Fetch for `checkSession`; the daemon passes its shared polite fetch. */
  fetch?: PoliteFetch;
  /** Config for the context `checkSession` runs in. Default: the default config. */
  config?: Config;
  /** Time between session checks. Default 3000 ms. */
  intervalMs?: number;
  /** Aborts the wait (for example when the daemon stops); the window is closed either way. */
  signal?: AbortSignal;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Lets the person log in to a source once. Opens a visible window on the
 * adapter's login page in that source's persistent profile, runs
 * `checkSession` every 3 s until it says 'ok', then closes the window so
 * later headed or headless sessions reopen the profile with its cookies.
 *
 * `checkSession` gets an ordinary context. Pages it opens with
 * `ctx.browser()` become background tabs of the login window, so a check
 * never takes the keyboard away from someone typing a password; it must not
 * navigate the login page itself. If the person closes the window, the
 * browser is shut and one last check (in a fresh browser on the same
 * profile) decides. Returns 'timeout' when no login was detected.
 */
export async function connectSource(
  adapter: SourceAdapter,
  pool: SessionProvider,
  log: Logger,
  timeoutMs = 600_000,
  opts: ConnectOptions = {},
): Promise<'ok' | 'timeout'> {
  const checkSession = adapter.checkSession?.bind(adapter);
  if (!checkSession) throw new Error(`${adapter.name} has no login to connect to`);
  const l = log.child({ source: adapter.id, op: 'connect' });
  const interval = opts.intervalMs ?? 3000;
  const checks = new AbortController();
  const ctx = createSourceContext({
    fetch: opts.fetch ?? createPoliteFetch({ log: l }),
    pool,
    log: l,
    config: opts.config ?? ConfigSchema.parse({}),
    sourceId: adapter.id,
    signal: opts.signal ? AbortSignal.any([opts.signal, checks.signal]) : checks.signal,
  });

  const loggedIn = async (): Promise<boolean> => {
    try {
      return (await checkSession(ctx)) === 'ok';
    } catch (e) {
      opts.signal?.throwIfAborted();
      l.debug('session check failed, trying again', { error: message(e) });
      return false;
    }
  };

  const url = adapter.loginUrl ?? adapter.homepage;
  const window = await pool.session(adapter.id, { mode: 'visible' });
  let windowOpen = true;
  const closeWindow = async () => {
    if (!windowOpen) return;
    windowOpen = false;
    await window.close().catch(() => undefined);
  };

  try {
    l.info('opened a window to log in', { url });
    await window.page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e: unknown) => {
      l.warn('the login page did not load; the window stays open', { url, error: message(e) });
    });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (window.page.isClosed()) {
        await closeWindow();
        const ok = await loggedIn();
        l.info(ok ? 'connected' : 'the window was closed before a login was detected');
        return ok ? 'ok' : 'timeout';
      }
      if (await loggedIn()) {
        l.info('connected');
        return 'ok';
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        l.warn('gave up waiting for a login', { timeoutMs });
        return 'timeout';
      }
      await sleep(Math.min(interval, left), opts.signal);
    }
  } finally {
    checks.abort();
    await closeWindow();
  }
}

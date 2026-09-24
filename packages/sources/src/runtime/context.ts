import { SourceConfigSchema, type BrowserSession, type Config, type Logger, type SourceContext, searchesForAdapters } from '@nlpf/core';
import type { BrowserMode } from './browser.js';
import type { PoliteFetch } from './fetch.js';

/** What a context needs from the browser pool; `BrowserPool` satisfies it, and tests can pass a fake. */
export interface SessionProvider {
  session(sourceId: string, opts?: { mode?: BrowserMode }): Promise<BrowserSession>;
}

export interface SourceContextDeps {
  fetch: PoliteFetch;
  pool: SessionProvider;
  log: Logger;
  config: Config;
  sourceId: string;
  /** Aborts when the job is cancelled or the daemon stops. */
  signal: AbortSignal;
  now?: () => Date;
}

/**
 * The context one adapter call runs in. Requests carry the job's abort
 * signal; `browser()` hands out a page from the source's persistent profile
 * (`headed: true` for sites that only let a real window through), and any
 * page the adapter leaves open is closed when the job is aborted.
 */
export function createSourceContext(deps: SourceContextDeps): SourceContext {
  const { signal } = deps;
  const open = new Set<BrowserSession>();
  const closeOpen = () => {
    for (const s of open) void s.close().catch(() => undefined);
    open.clear();
  };

  return {
    fetch: (url, init) =>
      deps.fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }),

    async browser(opts) {
      signal.throwIfAborted();
      const session = await deps.pool.session(deps.sourceId, { mode: opts?.headed ? 'headed' : 'headless' });
      if (signal.aborted) {
        await session.close().catch(() => undefined);
        signal.throwIfAborted();
      }
      // Listen for the abort only while a page is open, so a long-lived
      // daemon signal does not collect one listener per poll.
      if (open.size === 0) signal.addEventListener('abort', closeOpen, { once: true });
      const tracked: BrowserSession = {
        ...session,
        page: session.page,
        close: async () => {
          if (!open.delete(tracked)) return;
          if (open.size === 0) signal.removeEventListener('abort', closeOpen);
          await session.close();
        },
      };
      open.add(tracked);
      return tracked;
    },

    log: deps.log.child({ source: deps.sourceId }),
    profile: deps.config.profile,
    searches: searchesForAdapters(deps.config.searches),
    source: deps.config.sources[deps.sourceId] ?? SourceConfigSchema.parse({}),
    now: deps.now ?? (() => new Date()),
    signal,
  };
}

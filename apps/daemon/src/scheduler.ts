import type { Config, Logger, SourceAdapter, SourceState, Store } from '@nlpf/core';

export interface SchedulerDeps {
  store: Store;
  log: Logger;
  config: () => Config;
  adapters: () => SourceAdapter[];          // enabled adapters, in priority order
  now: () => Date;
  random?: () => number;
  /** Seconds until the next check, given the adapter's base interval. Adaptive polling plugs in here. */
  intervalFor?: (adapter: SourceAdapter, baseSec: number, at: Date) => number;
  /** Overrides the minimum intervals, for demo mode against the local sandbox. */
  floors?: Partial<Record<keyof typeof FLOOR_SEC, number>>;
}

/** Minimum seconds between checks by transport, so nobody accidentally hammers a site. */
export const FLOOR_SEC = { json: 45, html: 60, browser: 120, 'email-alert': 300 } as const;

export function baseInterval(adapter: SourceAdapter, cfg: Config, floors: Partial<Record<keyof typeof FLOOR_SEC, number>> = {}): number {
  const configured = cfg.sources[adapter.id]?.intervalSec;
  const floor = floors[adapter.capabilities.search] ?? FLOOR_SEC[adapter.capabilities.search];
  return Math.max(floor, configured ?? adapter.defaultIntervalSec);
}

export function initialState(adapter: SourceAdapter, cfg: Config): SourceState {
  const src = cfg.sources[adapter.id];
  return {
    sourceId: adapter.id,
    name: adapter.name,
    enabled: src?.enabled ?? true,
    health: 'ok',
    consecutiveFailures: 0,
    consecutiveEmpty: 0,
  };
}

/**
 * Decides when each source is checked. Every tick it enqueues one `poll` job
 * for each enabled source that is due, keyed by source and time slot so a
 * restart never doubles a check, then moves that source's `nextRunAt` forward
 * by its interval with plus or minus 20 percent jitter. Backoff after a block
 * is written to `nextRunAt` by the poll pipeline, and the scheduler respects it.
 */
export function createScheduler(deps: SchedulerDeps) {
  const random = deps.random ?? Math.random;
  const floorOf = (a: SourceAdapter) => deps.floors?.[a.capabilities.search] ?? FLOOR_SEC[a.capabilities.search];
  const interval = (a: SourceAdapter, at: Date) => {
    const base = baseInterval(a, deps.config(), deps.floors);
    const sec = deps.intervalFor ? deps.intervalFor(a, base, at) : base;
    const jittered = sec * (0.8 + random() * 0.4);
    return Math.max(floorOf(a), jittered);
  };

  return {
    tick(): number {
      const now = deps.now();
      const cfg = deps.config();
      let queued = 0;
      for (const adapter of deps.adapters()) {
        const state = deps.store.sources.get(adapter.id) ?? initialState(adapter, cfg);
        if (!state.enabled || state.health === 'disabled' || state.health === 'needs_login') continue;
        if (state.nextRunAt && Date.parse(state.nextRunAt) > now.getTime()) continue;
        const slot = now.toISOString();
        const job = deps.store.jobs.enqueue('poll', `poll:${adapter.id}:${slot}`, { sourceId: adapter.id }, slot);
        if (job) queued++;
        const next = new Date(now.getTime() + interval(adapter, now) * 1000);
        deps.store.sources.put({ ...state, name: adapter.name, nextRunAt: next.toISOString() });
      }
      return queued;
    },

    /** Push a source's next check out, for backoff after a block or rate limit. */
    backoff(sourceId: string, seconds: number) {
      const state = deps.store.sources.get(sourceId);
      if (!state) return;
      const next = new Date(deps.now().getTime() + seconds * 1000).toISOString();
      deps.store.sources.put({ ...state, nextRunAt: next });
      deps.log.info('backing off', { sourceId, seconds });
    },

    /** Check a source as soon as possible. */
    pollNow(sourceId: string) {
      const state = deps.store.sources.get(sourceId);
      if (state) deps.store.sources.put({ ...state, nextRunAt: deps.now().toISOString() });
    },

    nextRunAt(): string | undefined {
      return deps.store.sources
        .list()
        .filter((s) => s.enabled && s.nextRunAt)
        .map((s) => s.nextRunAt!)
        .sort()[0];
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;

import type { Job, JobKind, Logger, Store } from '@nlpf/core';

/** Throw from a handler to retry at a specific time without counting it as a failure of the job's logic. */
export class RetryLater extends Error {
  constructor(readonly at: Date, reason: string) {
    super(reason);
  }
}

export type JobHandler = (job: Job) => Promise<void>;

export interface RunnerDeps {
  store: Store;
  log: Logger;
  handlers: Partial<Record<JobKind, JobHandler>>;
  now: () => Date;
  concurrency?: number;
  intervalMs?: number;
  maxAttempts?: number;
}

/**
 * Runs due jobs. At most `concurrency` at once and at most one per source, so
 * a slow browser-driven site never delays a fast JSON one and never gets two
 * sessions at the same time. Unknown errors retry with exponential backoff up
 * to `maxAttempts`, then the job is marked failed and logged.
 */
export function createRunner(deps: RunnerDeps) {
  const concurrency = deps.concurrency ?? 4;
  const maxAttempts = deps.maxAttempts ?? 4;
  const running = new Set<number>();
  const busySources = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let stopped = true;
  const idleWaiters: (() => void)[] = [];

  const sourceOf = (j: Job) => (typeof j.payload.sourceId === 'string' ? j.payload.sourceId : undefined);

  async function execute(job: Job) {
    const handler = deps.handlers[job.kind];
    const src = sourceOf(job);
    try {
      if (!handler) throw new Error(`no handler for ${job.kind}`);
      await handler(job);
      deps.store.jobs.complete(job.id, deps.now().toISOString());
    } catch (err) {
      const nowIso = deps.now().toISOString();
      if (err instanceof RetryLater) {
        deps.store.jobs.fail(job.id, err.message, nowIso, err.at.toISOString());
      } else if (job.attempts < maxAttempts && job.kind !== 'contact') {
        const delay = Math.min(15 * 60_000, 2 ** job.attempts * 5_000);
        deps.store.jobs.fail(job.id, (err as Error).message, nowIso, new Date(deps.now().getTime() + delay).toISOString());
      } else {
        deps.store.jobs.fail(job.id, (err as Error).message, nowIso);
        deps.log.error('job failed', { kind: job.kind, key: job.key, error: (err as Error).message });
      }
    } finally {
      running.delete(job.id);
      if (src) busySources.delete(src);
      if (running.size === 0) idleWaiters.splice(0).forEach((w) => w());
    }
  }

  function pump() {
    const free = concurrency - running.size;
    if (free <= 0) return;
    const nowIso = deps.now().toISOString();
    const jobs = deps.store.jobs.claim(nowIso, free);
    for (const job of jobs) {
      const src = sourceOf(job);
      if (src && busySources.has(src)) {
        // Put it back for half a second; the source is busy with another job.
        deps.store.raw.prepare("UPDATE jobs SET state = 'pending', attempts = attempts - 1, run_at = ? WHERE id = ?").run(
          new Date(deps.now().getTime() + 500).toISOString(),
          job.id,
        );
        continue;
      }
      running.add(job.id);
      if (src) busySources.add(src);
      void execute(job);
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      const loop = () => {
        if (stopped) return;
        try {
          pump();
        } catch (e) {
          deps.log.error('runner loop', { error: e });
        }
        timer = setTimeout(loop, deps.intervalMs ?? 250);
      };
      loop();
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      if (running.size) await new Promise<void>((r) => idleWaiters.push(r));
    },
    /** Runs everything due right now and waits for it, for tests. */
    async drain() {
      for (let i = 0; i < 50; i++) {
        pump();
        if (running.size === 0) return;
        await new Promise<void>((r) => idleWaiters.push(r));
      }
    },
    get busy() {
      return running.size;
    },
  };
}

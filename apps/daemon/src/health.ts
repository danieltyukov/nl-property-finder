import type { EventBus, SourceHealth, SourceState, Store } from '@nlpf/core';

export interface PollOutcome {
  ok: boolean;
  count: number;              // listings returned by the source this poll
  latencyMs: number;
  error?: string;
  blocked?: { retryAfterSec?: number };
  needsLogin?: boolean;
}

interface DayBucket { day: string; polls: number; listings: number }

const FAILURES_FOR_DEGRADED = 5;
const EMPTY_POLLS_FOR_BROKEN = 3;
const BROKEN_AFTER_MS = 60 * 60_000;

/**
 * Keeps each source's health honest. Two ways a source breaks:
 *
 * It errors. Five failures in a row mark it degraded, and if it is still
 * degraded an hour later a `source_broken` task tells the person.
 *
 * It quietly returns nothing. A redesign usually does not error; the parser
 * just stops finding cards. Three empty polls in a row from a source that
 * normally returns more than one listing per poll (over the last seven days)
 * is treated as broken straight away, because silence from a busy source is
 * the failure that nobody would otherwise notice.
 */
export function createHealth(deps: { store: Store; bus: EventBus; now: () => Date }) {
  const { store, bus } = deps;

  const bucketsKey = (id: string) => `poll-stats:${id}`;
  const readBuckets = (id: string): DayBucket[] => JSON.parse(store.kv.get(bucketsKey(id)) ?? '[]') as DayBucket[];
  const averagePerPoll = (id: string): number => {
    const b = readBuckets(id);
    const polls = b.reduce((s, x) => s + x.polls, 0);
    return polls ? b.reduce((s, x) => s + x.listings, 0) / polls : 0;
  };
  const addToBuckets = (id: string, count: number, now: Date) => {
    const day = now.toISOString().slice(0, 10);
    const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const b = readBuckets(id).filter((x) => x.day > cutoff);
    const today = b.find((x) => x.day === day);
    if (today) {
      today.polls += 1;
      today.listings += count;
    } else b.push({ day, polls: 1, listings: count });
    store.kv.set(bucketsKey(id), JSON.stringify(b));
  };

  const setHealth = (s: SourceState, health: SourceHealth, reason?: string) => {
    if (s.health === health) return;
    s.health = health;
    bus.emit('source.health', `${s.name} is ${health.replace('_', ' ')}${reason ? `: ${reason}` : ''}`, { sourceId: s.sourceId, health, reason });
  };

  const openBroken = (s: SourceState, reason: string) => {
    const nowIso = deps.now().toISOString();
    const { task, created } = store.tasks.open(
      {
        kind: 'source_broken',
        title: `${s.name} needs a look`,
        reason,
        priority: 2,
        sourceId: s.sourceId,
        payload: { lastError: s.lastError },
      },
      nowIso,
      `source_broken:${s.sourceId}:${nowIso.slice(0, 10)}`,
    );
    if (created) bus.emit('task.created', task.title, { taskId: task.id, kind: task.kind, priority: task.priority });
  };

  return {
    averagePerPoll,

    record(state: SourceState, outcome: PollOutcome): SourceState {
      const now = deps.now();
      const s: SourceState = { ...state, lastRunAt: now.toISOString(), lastLatencyMs: outcome.latencyMs };

      if (outcome.needsLogin) {
        s.lastError = outcome.error ?? 'Login needed';
        setHealth(s, 'needs_login', 'log in again with nlpf connect');
        const nowIso = now.toISOString();
        const { task, created } = store.tasks.open(
          { kind: 'reconnect', title: `Log in to ${s.name} again`, reason: `${s.name} logged the agent out, so it cannot read or send there until you log in.`, priority: 2, sourceId: s.sourceId },
          nowIso,
          `reconnect:${s.sourceId}`,
        );
        if (created) bus.emit('task.created', task.title, { taskId: task.id, kind: task.kind, priority: task.priority });
        store.sources.put(s);
        return s;
      }

      if (!outcome.ok) {
        s.consecutiveFailures += 1;
        s.lastError = outcome.error ?? 'Unknown error';
        if (s.consecutiveFailures === 1) store.kv.set(`degraded-since:${s.sourceId}`, now.toISOString());
        if (s.consecutiveFailures >= FAILURES_FOR_DEGRADED) {
          setHealth(s, 'degraded', s.lastError);
          const since = Date.parse(store.kv.get(`degraded-since:${s.sourceId}`) ?? now.toISOString());
          if (now.getTime() - since >= BROKEN_AFTER_MS) {
            openBroken(s, `${s.name} has failed every check for over an hour. Last error: ${s.lastError}`);
          }
        }
        store.sources.put(s);
        return s;
      }

      // A successful poll.
      const avg = averagePerPoll(s.sourceId);
      addToBuckets(s.sourceId, outcome.count, now);
      s.consecutiveFailures = 0;
      s.lastOkAt = now.toISOString();
      s.lastCount = outcome.count;
      s.lastError = undefined;
      if (outcome.count === 0) {
        s.consecutiveEmpty += 1;
        if (s.consecutiveEmpty >= EMPTY_POLLS_FOR_BROKEN && avg > 1) {
          s.lastError = `No listings in ${s.consecutiveEmpty} checks in a row, where it usually returns about ${avg.toFixed(1)}.`;
          setHealth(s, 'degraded', 'returns nothing');
          openBroken(s, `${s.name} suddenly returns no listings. The site may have changed its layout. ${s.lastError}`);
          store.sources.put(s);
          return s;
        }
      } else {
        s.consecutiveEmpty = 0;
      }
      if (s.health !== 'watch_only') setHealth(s, 'ok');
      store.sources.put(s);
      return s;
    },
  };
}

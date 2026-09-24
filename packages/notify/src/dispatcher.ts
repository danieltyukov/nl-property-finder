import { amsterdam, amsterdamDate, isWithinWindow } from '@nlpf/core';
import type { Config, Logger, Notification, Notifier } from '@nlpf/core';
import type { DigestNotifier } from './types.js';

export type { DigestNotifier } from './types.js';

/** What leaves the machine instead of the body when `includeDetails` is false. */
export const NEUTRAL_BODY = 'Open the dashboard for details.';

export interface DispatchResult {
  outcome: 'sent' | 'held' | 'dropped' | 'deduped' | 'failed';
  /** Channels that delivered it. */
  sent: string[];
  /** Digest channels that queued it for the next summary. */
  queued: string[];
  failed: { id: string; error: string }[];
}

export interface NotifyDispatcher {
  notify(n: Notification): Promise<DispatchResult>;
  /** Call every minute or so: releases what quiet hours held and sends the daily digest when due. */
  tick(): Promise<void>;
  /** Sends every queued digest item now. Resolves true when all digests went out. */
  flushDigests(): Promise<boolean>;
  /** Number of notifications waiting for quiet hours to end. */
  held(): number;
}

export interface DispatcherOptions {
  log?: Logger;
  /** Window in which a repeated `key` is dropped. Default 10 minutes. */
  dedupeMs?: number;
  /** Amsterdam hour from which the daily digest goes out. Default 8. */
  digestHour?: number;
}

type NotifyConfig = Config['notify'];

const PRIVATE_HOST = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

/** A link to the dashboard on this machine or the LAN says nothing about the home, so it may stay. */
function isLocalUrl(url: string): boolean {
  try {
    return PRIVATE_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Titles leave the machine; bodies and outside links do not. The call number stays so the call button works. */
function withoutDetails(n: Notification): Notification {
  const out: Notification = { ...n, body: NEUTRAL_BODY };
  if (out.url && !isLocalUrl(out.url)) delete out.url;
  return out;
}

const isDailyDigest = (x: Notifier): x is DigestNotifier =>
  typeof (x as Partial<DigestNotifier>).sendDigest === 'function' && (x as Partial<DigestNotifier>).digest === 'daily';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * One place that decides whether and how a notification goes out:
 * `minPriority` drops, a repeated `key` within 10 minutes is dropped, quiet
 * hours hold everything below priority 5 until they end, `includeDetails:
 * false` replaces the body with a neutral line, and daily-digest channels
 * queue until the morning. Each channel fails on its own; one broken
 * channel never stops the others.
 */
export function createNotifyDispatcher(
  notifiers: Notifier[],
  cfg: NotifyConfig | (() => NotifyConfig),
  now: () => Date = () => new Date(),
  opts: DispatcherOptions = {},
): NotifyDispatcher {
  const config = typeof cfg === 'function' ? cfg : () => cfg;
  const dedupeMs = opts.dedupeMs ?? 10 * 60_000;
  const digestHour = opts.digestHour ?? 8;
  const lastByKey = new Map<string, number>();
  const heldQueue: Notification[] = [];
  const digestQueue = new Map<string, Notification[]>();
  let lastDigestDay = amsterdamDate(now());

  const quiet = (c: NotifyConfig, at: Date): boolean => !!c.quietHours && isWithinWindow(at, c.quietHours.start, c.quietHours.end);

  async function deliver(n: Notification): Promise<Omit<DispatchResult, 'outcome'>> {
    const results = await Promise.all(
      notifiers.map(async (x): Promise<{ id: string; state: 'sent' | 'queued' | 'failed'; error?: string }> => {
        if (isDailyDigest(x) && n.priority < 5) {
          digestQueue.set(x.id, [...(digestQueue.get(x.id) ?? []), n]);
          return { id: x.id, state: 'queued' };
        }
        try {
          await x.send(n);
          return { id: x.id, state: 'sent' };
        } catch (err) {
          opts.log?.warn('notification failed', { notifier: x.id, error: errorText(err) });
          return { id: x.id, state: 'failed', error: errorText(err) };
        }
      }),
    );
    return {
      sent: results.filter((r) => r.state === 'sent').map((r) => r.id),
      queued: results.filter((r) => r.state === 'queued').map((r) => r.id),
      failed: results.filter((r) => r.state === 'failed').map((r) => ({ id: r.id, error: r.error ?? '' })),
    };
  }

  async function releaseHeld(): Promise<void> {
    while (heldQueue.length) {
      const n = heldQueue.shift();
      if (n) await deliver(n);
    }
  }

  async function flushDigests(): Promise<boolean> {
    let ok = true;
    for (const x of notifiers) {
      if (!isDailyDigest(x)) continue;
      const items = digestQueue.get(x.id) ?? [];
      if (!items.length) continue;
      digestQueue.set(x.id, []);
      try {
        await x.sendDigest(items);
      } catch (err) {
        ok = false;
        digestQueue.set(x.id, [...items, ...(digestQueue.get(x.id) ?? [])]);
        opts.log?.warn('digest failed, will retry', { notifier: x.id, error: errorText(err) });
      }
    }
    return ok;
  }

  return {
    async notify(n) {
      const c = config();
      const at = now();
      const t = at.getTime();
      if (n.priority < c.minPriority) return { outcome: 'dropped', sent: [], queued: [], failed: [] };

      for (const [key, when] of lastByKey) if (t - when >= dedupeMs) lastByKey.delete(key);
      if (n.key) {
        const last = lastByKey.get(n.key);
        if (last !== undefined && t - last < dedupeMs) return { outcome: 'deduped', sent: [], queued: [], failed: [] };
        lastByKey.set(n.key, t);
      }

      const out = c.includeDetails ? n : withoutDetails(n);
      if (quiet(c, at)) {
        if (n.priority < 5) {
          heldQueue.push(out);
          return { outcome: 'held', sent: [], queued: [], failed: [] };
        }
      } else {
        await releaseHeld();
      }
      const r = await deliver(out);
      const outcome = r.failed.length && !r.sent.length && !r.queued.length ? 'failed' : 'sent';
      return { outcome, ...r };
    },

    async tick() {
      const c = config();
      const at = now();
      if (!quiet(c, at)) await releaseHeld();
      const day = amsterdamDate(at);
      if (day !== lastDigestDay && amsterdam(at).hh >= digestHour) {
        if (await flushDigests()) lastDigestDay = day;
      }
    },

    flushDigests,

    held: () => heldQueue.length,
  };
}

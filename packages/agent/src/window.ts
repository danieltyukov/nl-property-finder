import { amsterdam, fromAmsterdam, isWithinWindow } from '@nlpf/core';

export interface TimeWindow {
  start: string;
  end: string;
}

/** Amsterdam calendar date `days` after the local date of `at`. */
export function localDatePlus(at: Date, days: number): { y: number; m: number; d: number } {
  const p = amsterdam(at);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** True when the Amsterdam wall clock at `now` is inside the send window. */
export function inSendWindow(now: Date, window: TimeWindow): boolean {
  return isWithinWindow(now, window.start, window.end);
}

/**
 * The instant the send window next opens, on the Amsterdam wall clock, so it
 * stays 07:00 local across daylight saving changes. Inside the window it is
 * `now` itself.
 */
export function nextWindowStart(now: Date, window: TimeWindow): Date {
  if (inSendWindow(now, window)) return now;
  const [h = 0, m = 0] = window.start.split(':').map(Number);
  for (let add = 0; add <= 2; add += 1) {
    const day = localDatePlus(now, add);
    const start = fromAmsterdam(day.y, day.m, day.d, h, m);
    if (start > now) return start;
  }
  throw new Error(`no window start found after ${now.toISOString()}`);
}

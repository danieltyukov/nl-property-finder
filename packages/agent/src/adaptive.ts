import { amsterdam } from '@nlpf/core';

const DAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 } as const;

/** 0 for Monday 00:00 to 167 for Sunday 23:00, on the Amsterdam clock. */
export function hourOfWeek(at: Date): number {
  const p = amsterdam(at);
  return DAY_INDEX[p.weekday] * 24 + p.hh;
}

/**
 * Poll interval for a source at a given time, learned from when it actually
 * publishes: `histogram` holds new listings per hour-of-week bin (168 bins,
 * Monday 00:00 first). The bin and its neighbours are compared with the
 * weekly mean; busy hours poll up to twice as often, quiet hours up to three
 * times less often. The result never drops below `floorSec` (60 s for JSON
 * sources; the daemon passes 120 s for browser sources). Without data the
 * base interval is kept.
 */
export function adaptiveInterval(
  baseSec: number,
  histogram: number[],
  at: Date,
  opts: { floorSec?: number } = {},
): number {
  const floor = opts.floorSec ?? 60;
  if (histogram.length !== 168) return Math.max(floor, baseSec);
  const mean = histogram.reduce((a, b) => a + b, 0) / 168;
  if (mean <= 0) return Math.max(floor, baseSec);
  const i = hourOfWeek(at);
  const bin = (k: number) => histogram[(k + 168) % 168] ?? 0;
  const smoothed = 0.25 * bin(i - 1) + 0.5 * bin(i) + 0.25 * bin(i + 1);
  const ratio = smoothed / mean;
  const factor = ratio >= 1 ? Math.max(0.5, 1 / ratio) : Math.min(3, 1 / Math.max(ratio, 1 / 3));
  return Math.max(floor, Math.round(baseSec * factor));
}

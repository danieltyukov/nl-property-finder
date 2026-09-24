export const TZ = 'Europe/Amsterdam';

export const nowIso = (): string => new Date().toISOString();

export interface LocalParts {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
  weekday: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
}

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

const WEEKDAYS: Record<string, LocalParts['weekday']> = {
  Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun',
};

/** Wall-clock parts of an instant in Amsterdam. */
export function amsterdam(date: Date): LocalParts {
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: Number(parts.hour),
    mm: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? 'Mon'] ?? 'mon',
  };
}

/** Offset of Amsterdam from UTC in minutes at a given instant (60 or 120). */
export function amsterdamOffsetMinutes(date: Date): number {
  const p = amsterdam(date);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  const truncated = Math.floor(date.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/**
 * The instant at which Amsterdam's wall clock shows the given time.
 * The repeated hour in October resolves to its first occurrence (summer time).
 * A time that does not exist in March (02:00-02:59) moves forward one hour.
 */
export function fromAmsterdam(y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const candidates = [120, 60].map((off) => new Date(guess - off * 60_000));
  for (const c of candidates) {
    const p = amsterdam(c);
    if (p.y === y && p.m === m && p.d === d && p.hh === hh && p.mm === mm) return c;
  }
  // Non-existent local time (spring forward): shift by an hour.
  if (hh >= 23) return new Date(guess - 60 * 60_000);
  return fromAmsterdam(y, m, d, hh + 1, mm);
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** True when the Amsterdam wall clock at `date` is inside [start, end). Handles windows that cross midnight. */
export function isWithinWindow(date: Date, start: string, end: string): boolean {
  const p = amsterdam(date);
  const t = p.hh * 60 + p.mm;
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s <= e ? t >= s && t < e : t >= s || t < e;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** YYYY-MM-DD in Amsterdam. */
export function amsterdamDate(date: Date): string {
  const p = amsterdam(date);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

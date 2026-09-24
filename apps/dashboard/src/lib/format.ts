/*
 * Formatting for everything a person reads. Times are always shown in
 * Europe/Amsterdam, whatever the browser's zone, because that is where the
 * viewings happen. Numbers use the en-GB pattern (1,150) to match the English
 * interface; prices are whole euros.
 */
import type { Address } from '@nlpf/core';

export const TZ = 'Europe/Amsterdam';

const euro = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const whole = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

const parts = (date: Date, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    // en-US parts give "Sep" rather than en-GB's "Sept"; the order is assembled by hand below.
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', ...options })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

export function eur(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '' : euro.format(value);
}

export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : whole.format(value);
}

export function m2(value: number | null | undefined): string {
  return value ? `${whole.format(value)} m²` : '';
}

export function street(address: Address | null | undefined, fallback = ''): string {
  if (!address?.street) return fallback;
  const number = [address.houseNumber, address.addition].filter(Boolean).join('');
  return number ? `${address.street} ${number}` : address.street;
}

export function place(address: Address | null | undefined): string {
  return address?.city ?? address?.municipality ?? '';
}

/** "Oude Delft 12A, Delft" */
export function fullAddress(address: Address | null | undefined, fallback = ''): string {
  return [street(address, fallback), place(address)].filter(Boolean).join(', ');
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "21:04:12" */
export function clock(value: string | number | Date): string {
  const p = parts(toDate(value), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** "21:04" */
export function hm(value: string | number | Date): string {
  const p = parts(toDate(value), { hour: '2-digit', minute: '2-digit' });
  return `${p.hour}:${p.minute}`;
}

/** "Thu 26 Sep" */
export function day(value: string | number | Date): string {
  const p = parts(toDate(value), { weekday: 'short', day: 'numeric', month: 'short' });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "Thu 26 Sep 18:30" */
export function dayTime(value: string | number | Date): string {
  return `${day(value)} ${hm(value)}`;
}

/** Calendar key in Amsterdam, "2026-09-26", for grouping by day. */
export function dayKey(value: string | number | Date): string {
  const p = parts(toDate(value), { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "Today", "Yesterday" or "Mon 22 Sep". */
export function dayLabel(value: string | number | Date, now: number = Date.now()): string {
  const key = dayKey(value);
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(now - 86_400_000)) return 'Yesterday';
  if (key === dayKey(now + 86_400_000)) return 'Tomorrow';
  return day(value);
}

/** A YYYY-MM-DD date as "1 Nov 2026". */
export function ymd(value: string | null | undefined): string {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${d} ${month} ${y}`;
}

/** "38 s", "4 min", "2 h 5 min", "3 days". */
export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '';
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day' : `${d} days`;
}

/** "40 s ago", "3 min ago", "yesterday 14:05", "Mon 22 Sep". Future instants read "in 3 min". */
export function ago(value: string | number | Date | null | undefined, now: number = Date.now()): string {
  if (!value) return '';
  const t = toDate(value).getTime();
  const diff = now - t;
  // A few seconds in the future is clock skew between the daemon and this page.
  if (diff < 5_000 && diff > -30_000) return 'just now';
  if (diff < 0) return `in ${duration(-diff)}`;
  if (diff < 60 * 60_000 * 12) return `${duration(diff)} ago`;
  const label = dayLabel(t, now);
  if (label === 'Today') return `today ${hm(t)}`;
  if (label === 'Yesterday') return `yesterday ${hm(t)}`;
  return day(t);
}

/** Countdown "0:42" or "12:05". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function bytes(size: number | undefined): string {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : `${Math.round(value)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

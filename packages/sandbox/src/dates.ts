import { amsterdam, fromAmsterdam, type Lang } from '@nlpf/core';
import type { Rng } from './rng.js';
import type { ViewingSlot } from './types.js';

/*
 * Dates the way Dutch landlords write them, always relative to "now" in
 * Amsterdam: "donderdag 1 oktober om 18:30", "zaterdag tussen 10:00 en 12:00".
 */

const WEEKDAYS: Record<Lang, string[]> = {
  nl: ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const MONTHS: Record<Lang, string[]> = {
  nl: [
    'januari',
    'februari',
    'maart',
    'april',
    'mei',
    'juni',
    'juli',
    'augustus',
    'september',
    'oktober',
    'november',
    'december',
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};

export interface LocalDay {
  y: number;
  m: number;
  d: number;
  /** 0 = Sunday. */
  weekday: number;
}

/** The Amsterdam calendar day `offset` days after the day of `now`. */
export function localDay(now: Date, offset: number): LocalDay {
  const p = amsterdam(now);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + offset));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() };
}

const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (day: LocalDay) => `${day.y}-${pad(day.m)}-${pad(day.d)}`;

/** "2026-11-01" as "1 november 2026" or "1 November 2026". */
export function longDate(isoDay: string, lang: Lang): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return `${d} ${MONTHS[lang][(m ?? 1) - 1]} ${y}`;
}

/** "donderdag 1 oktober" or "Thursday 1 October". */
export function dayName(day: LocalDay, lang: Lang): string {
  return `${WEEKDAYS[lang][day.weekday]} ${day.d} ${MONTHS[lang][day.m - 1]}`;
}

export function weekdayName(day: LocalDay, lang: Lang): string {
  return WEEKDAYS[lang][day.weekday] ?? '';
}

const at = (day: LocalDay, hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number);
  return fromAmsterdam(day.y, day.m, day.d, hh ?? 0, mm ?? 0).toISOString();
};

export interface SlotSet {
  /** Two weekday evening times and a Saturday morning window. */
  slots: ViewingSlot[];
  /** Words for the message templates: `{slot1}`, `{slot2}`, `{slot3}` and `{slot3short}` (the Saturday without its date when that is unambiguous). */
  words: Record<Lang, { slot1: string; slot2: string; slot3: string; slot3short: string }>;
}

const EVENING = ['17:30', '18:00', '18:30', '19:00'];
const LATE_AFTERNOON = ['16:45', '17:15', '17:45', '18:15'];
const SATURDAY: [string, string][] = [
  ['10:00', '12:00'],
  ['10:30', '12:30'],
  ['11:00', '13:00'],
];

/**
 * Three viewing times a landlord might offer: a weekday evening at least two
 * days out, the next weekday, and a Saturday morning window. All of them fall
 * inside the default availability (weekdays 09:00 to 20:00, weekends 10:00 to
 * 18:00), so the agent can book one without asking.
 */
export function viewingSlots(now: Date, rng: Rng): SlotSet {
  let offset = 2 + rng.int(0, 2);
  const isWeekday = (day: LocalDay) => day.weekday >= 1 && day.weekday <= 5;
  let first = localDay(now, offset);
  while (!isWeekday(first)) first = localDay(now, ++offset);
  let second = localDay(now, ++offset);
  while (!isWeekday(second)) second = localDay(now, ++offset);
  let satOffset = 2;
  while (localDay(now, satOffset).weekday !== 6) satOffset++;
  const saturday = localDay(now, satOffset);

  const t1 = rng.pick(EVENING);
  const t2 = rng.pick(LATE_AFTERNOON);
  const [s3, e3] = rng.pick(SATURDAY);

  const words = (lang: Lang) => {
    const on = lang === 'nl' ? 'om' : 'at';
    const between = lang === 'nl' ? ['tussen', 'en'] : ['between', 'and'];
    const window = `${between[0]} ${s3} ${between[1]} ${e3}`;
    const slot3 = `${dayName(saturday, lang)} ${window}`;
    return {
      slot1: `${dayName(first, lang)} ${on} ${t1}`,
      slot2: `${dayName(second, lang)} ${on} ${t2}`,
      slot3,
      // "zaterdag" alone is only clear when it is the coming Saturday and not tomorrow.
      slot3short: satOffset <= 6 ? `${weekdayName(saturday, lang)} ${window}` : slot3,
    };
  };
  const nl = words('nl');
  return {
    slots: [
      { start: at(first, t1), text: nl.slot1 },
      { start: at(second, t2), text: nl.slot2 },
      { start: at(saturday, s3), end: at(saturday, e3), text: nl.slot3 },
    ],
    words: { nl, en: words('en') },
  };
}

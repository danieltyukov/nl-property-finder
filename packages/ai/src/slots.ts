import { amsterdam, fromAmsterdam, type ProposedSlot } from '@nlpf/core';

/**
 * A compact parser for viewing times in Dutch and English free text, used by
 * the rules and demo providers. The agent package has the complete parser
 * (`parseSlots`); this one covers the common forms landlords write:
 * "donderdag 1 oktober 18:30", "morgen 14u", "za 10:00-10:15",
 * "tussen 17 en 19 uur", "half zeven", "Friday 2 October at 6 pm", "26-09".
 * Times are Europe/Amsterdam wall-clock times.
 */

interface DateTok {
  start: number;
  end: number;
  weekday?: number;            // 0 = Sunday, as Date#getUTCDay
  y?: number;
  m?: number;
  d?: number;
  rel?: number;                // days from today
  nextWeek?: boolean;
  deadline?: boolean;
}

interface TimeTok {
  start: number;
  end: number;
  h: number;
  mi: number;
  eh?: number;
  emi?: number;
}

const WEEKDAY_FULL: Record<string, number> = {
  zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const WEEKDAY_ABBR: Record<string, number> = {
  zo: 0, ma: 1, di: 2, wo: 3, do: 4, vr: 5, vrij: 5, za: 6, zat: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const MONTHS: Record<string, number> = {
  januari: 1, january: 1, jan: 1, februari: 2, february: 2, feb: 2, maart: 3, march: 3, mrt: 3, mar: 3,
  april: 4, apr: 4, mei: 5, may: 5, juni: 6, june: 6, jun: 6, juli: 7, july: 7, jul: 7,
  augustus: 8, august: 8, aug: 8, september: 9, sept: 9, sep: 9, oktober: 10, october: 10, okt: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};
const NUMBER_WORDS: Record<string, number> = {
  een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12,
};

const alt = (words: string[]) => words.sort((a, b) => b.length - a.length).join('|');
const MONTH_RE = alt(Object.keys(MONTHS));
const WEEKDAY_FULL_RE = alt(Object.keys(WEEKDAY_FULL));
const WEEKDAY_ABBR_RE = alt(Object.keys(WEEKDAY_ABBR));
const NUMBER_WORD_RE = alt(Object.keys(NUMBER_WORDS));

// Plain "voor" is left out: "uitnodigen voor donderdag" is a viewing, not a deadline.
const DEADLINE_BEFORE =
  /(?:vóór|\buiterlijk|\bbefore|\bno later than|\bdeadline|\b(?:reageer|reageren|reactie|antwoord|antwoorden|laat(?:\s+(?:het|u|je))?\s+weten|sturen|opsturen|toesturen|aanleveren|respond|reply|let (?:us|me) know)\s+(?:graag\s+|dan\s+)?(?:voor|vóór|by|before))[\s:]*(?:op\s+|on\s+)?$/;

export function parseSimpleSlots(text: string, now: Date): ProposedSlot[] {
  if (Number.isNaN(now.getTime())) return [];
  const lower = text.toLowerCase();
  const src = lower.length === text.length ? text : lower;
  const dates = findDates(lower);
  const times = findTimes(lower, src);

  const today = amsterdam(now);
  const todayUtc = Date.UTC(today.y, today.m - 1, today.d);
  const slots: ProposedSlot[] = [];
  const used = new Set<DateTok>();

  for (const t of times) {
    // A day and a time belong together only within one sentence.
    const sameSentence = (from: number, to: number) => !/[.!?](?:\s|$)|\n\s*\n/.test(lower.slice(from, to));
    const before = [...dates].reverse().find((a) => a.end <= t.start && t.start - a.end <= 60 && sameSentence(a.end, t.start));
    const after = before ? undefined : dates.find((a) => a.start >= t.end && a.start - t.end <= 30 && sameSentence(t.end, a.start));
    const anchor = before ?? after;
    if (anchor?.deadline) continue;           // "reageer voor vrijdag 12:00" is a deadline, not a viewing
    if (anchor) used.add(anchor);
    slots.push(makeSlot(anchor, t, src, now, todayUtc));
  }
  if (slots.length === 0) {
    for (const a of dates) {
      if (a.deadline || used.has(a)) continue;
      slots.push(makeSlot(a, undefined, src, now, todayUtc));
    }
  }

  const seen = new Set<string>();
  return slots.filter((s) => {
    const key = `${s.start}|${s.end ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeSlot(anchor: DateTok | undefined, t: TimeTok | undefined, src: string, now: Date, todayUtc: number): ProposedSlot {
  let certain = true;
  let day: number;                          // UTC midnight of the Amsterdam calendar day
  const minutes = t ? t.h * 60 + t.mi : 12 * 60;

  if (!anchor) {
    // A time with no day: the next time the clock shows it.
    day = todayUtc;
    if (instant(day, t?.h ?? 12, t?.mi ?? 0) <= now.getTime()) day += 86_400_000;
    certain = false;
  } else if (anchor.m !== undefined && anchor.d !== undefined) {
    const nowYear = new Date(todayUtc).getUTCFullYear();
    let year = anchor.y ?? nowYear;
    day = Date.UTC(year, anchor.m - 1, anchor.d);
    if (anchor.y === undefined && day < todayUtc - 60 * 86_400_000) {
      year += 1;
      day = Date.UTC(year, anchor.m - 1, anchor.d);
    }
    const valid = new Date(day).getUTCDate() === anchor.d;
    if (!valid) certain = false;
    if (anchor.weekday !== undefined && new Date(day).getUTCDay() !== anchor.weekday) certain = false;
  } else if (anchor.rel !== undefined) {
    day = todayUtc + anchor.rel * 86_400_000;
  } else {
    const target = anchor.weekday ?? 0;
    const diff = (target - new Date(todayUtc).getUTCDay() + 7) % 7;
    day = todayUtc + diff * 86_400_000;
    if (diff === 0 && (!t || instant(day, t.h, t.mi) <= now.getTime())) day += 7 * 86_400_000;
    if (anchor.nextWeek) {
      const nextMonday = todayUtc + ((8 - new Date(todayUtc).getUTCDay()) % 7 || 7) * 86_400_000;
      while (day < nextMonday) day += 7 * 86_400_000;
    }
  }
  if (!t) certain = false;

  const date = new Date(day);
  const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  const start = fromAmsterdam(y, m, d, Math.floor(minutes / 60), minutes % 60);
  if (start.getTime() < now.getTime()) certain = false;
  const slot: ProposedSlot = { start: start.toISOString(), text: '', certain };
  if (t?.eh !== undefined) {
    let endDay = day;
    if (t.eh * 60 + (t.emi ?? 0) <= minutes) endDay += 86_400_000;
    const e = new Date(endDay);
    slot.end = fromAmsterdam(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate(), t.eh, t.emi ?? 0).toISOString();
  }
  const from = Math.min(anchor?.start ?? Infinity, t?.start ?? Infinity);
  const to = Math.max(anchor?.end ?? -Infinity, t?.end ?? -Infinity);
  slot.text = src.slice(from, to).replace(/\s+/g, ' ').trim().slice(0, 100);
  return slot;
}

function instant(dayUtc: number, h: number, mi: number): number {
  const d = new Date(dayUtc);
  return fromAmsterdam(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, mi).getTime();
}

/* ---------- dates ---------- */

function findDates(s: string): DateTok[] {
  const toks: DateTok[] = [];
  const push = (t: DateTok) => {
    if (toks.some((o) => t.start < o.end && o.start < t.end)) return;
    toks.push(t);
  };

  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push({ start: m.index, end: m.index + m[0].length, y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  }
  for (const m of s.matchAll(new RegExp(String.raw`\b(\d{1,2})(?:e|ste|de|st|nd|rd|th)?\s+(${MONTH_RE})\b\.?(?:\s+(\d{4}))?`, 'g'))) {
    const d = Number(m[1]);
    if (d >= 1 && d <= 31) push({ start: m.index, end: m.index + m[0].length, d, m: MONTHS[m[2] ?? ''], y: m[3] ? Number(m[3]) : undefined });
  }
  for (const m of s.matchAll(new RegExp(String.raw`\b(${MONTH_RE})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`, 'g'))) {
    const d = Number(m[2]);
    const next = s.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (d >= 1 && d <= 31 && !/^[:.]\d/.test(next)) push({ start: m.index, end: m.index + m[0].length, d, m: MONTHS[m[1] ?? ''], y: m[3] ? Number(m[3]) : undefined });
  }
  for (const m of s.matchAll(/(?<![\d/.:-])(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}|\d{2}))?(?![\d:/-])(?!\s*(?:uur|u\b|h\b))/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    push({ start: m.index, end: m.index + m[0].length, d, m: mo, y });
  }
  for (const m of s.matchAll(/\b(vandaag|today|overmorgen|day after tomorrow|morgen(?:ochtend|middag|avond)?|tomorrow)\b/g)) {
    const w = m[1] ?? '';
    const rel = w === 'vandaag' || w === 'today' ? 0 : w === 'overmorgen' || w === 'day after tomorrow' ? 2 : 1;
    push({ start: m.index, end: m.index + m[0].length, rel });
  }
  for (const m of s.matchAll(new RegExp(String.raw`\b(${WEEKDAY_FULL_RE})\b`, 'g'))) {
    push({ start: m.index, end: m.index + m[0].length, weekday: WEEKDAY_FULL[m[1] ?? ''] });
  }
  // Abbreviations only count right before a number ("za 10:00", "do. 1 okt"), so "zo snel" and "do you" stay words.
  for (const m of s.matchAll(new RegExp(String.raw`\b(${WEEKDAY_ABBR_RE})\b\.?(?=\s{0,2}\d)`, 'g'))) {
    push({ start: m.index, end: m.index + m[0].length, weekday: WEEKDAY_ABBR[m[1] ?? ''] });
  }

  toks.sort((a, b) => a.start - b.start);

  // "donderdag 1 oktober", "donderdag, 1 oktober", "1 oktober (donderdag)" are one anchor.
  const merged: DateTok[] = [];
  for (const t of toks) {
    const prev = merged[merged.length - 1];
    if (prev && /^[\s,(]*(?:de\s+|the\s+)?$/.test(s.slice(prev.end, t.start))) {
      const weekdayFirst = prev.weekday !== undefined && prev.d === undefined && t.d !== undefined && t.weekday === undefined;
      const dateFirst = prev.d !== undefined && prev.weekday === undefined && t.weekday !== undefined && t.d === undefined;
      if (weekdayFirst || dateFirst) {
        merged[merged.length - 1] = { ...prev, ...t, weekday: prev.weekday ?? t.weekday, start: prev.start, end: /^\)/.test(s.slice(t.end)) ? t.end + 1 : t.end };
        continue;
      }
    }
    merged.push(t);
  }
  for (const t of merged) {
    const before = s.slice(Math.max(0, t.start - 25), t.start);
    if (DEADLINE_BEFORE.test(before)) t.deadline = true;
    if (t.weekday !== undefined && t.d === undefined && /(?:volgende week|next week|komende week)\s*(?:op\s+)?$/.test(before)) t.nextWeek = true;
  }
  return merged;
}

/* ---------- times ---------- */

const MORNING_BEFORE = /(?:ochtend|'s\s*morgens|’s\s*morgens|in the morning|\bmorning)[^.\n]{0,15}$/;
const EVENING_BEFORE = /(?:avond|middag|evening|afternoon|tonight)[^.\n]{0,15}$/;
const EVENING_AFTER = /^[\s,]*(?:uur\s*)?(?:'s\s*avonds|’s\s*avonds|'s\s*middags|’s\s*middags|in the (?:evening|afternoon)|p\.?m\.?\b)/;
const MORNING_AFTER = /^[\s,]*(?:uur\s*)?(?:'s\s*ochtends|’s\s*ochtends|'s\s*morgens|’s\s*morgens|in the morning|a\.?m\.?\b)/;
const NOT_A_TIME_BEFORE = /(?:€|\beur|\beuro|\bbinnen|\bwithin|\bover|\bna|\bafter|\bnr\.?|\bnummer|\bnumber|\bhuisnummer)\s*$/;

function findTimes(s: string, original: string): TimeTok[] {
  const toks: TimeTok[] = [];
  const add = (start: number, end: number, h: number, mi: number, eh?: number, emi?: number, meridiem?: 'am' | 'pm', clock24 = false) => {
    if (toks.some((o) => start < o.end && o.start < end)) return;
    if (NOT_A_TIME_BEFORE.test(s.slice(Math.max(0, start - 12), start))) return;
    if (h > 23 || mi > 59 || (eh !== undefined && (eh > 23 || (emi ?? 0) > 59))) return;
    const after = s.slice(end, end + 25);
    const before = s.slice(Math.max(0, start - 30), start);
    const pm = meridiem === 'pm' || (!meridiem && (EVENING_AFTER.test(after) || EVENING_BEFORE.test(before)));
    const am = meridiem === 'am' || (!meridiem && !pm && (MORNING_AFTER.test(after) || MORNING_BEFORE.test(before)));
    // Without am, pm or a part of the day, 1 to 7 o'clock means the evening: nobody books a viewing at 6 in the morning.
    // A leading zero ("02:30") is a 24-hour clock and stays as written.
    const adjust = (x: number) => (pm && x < 12 ? x + 12 : am ? (x === 12 ? 0 : x) : !clock24 && x >= 1 && x <= 7 ? x + 12 : x);
    const sh = adjust(h);
    let endH = eh !== undefined ? adjust(eh) : undefined;
    if (endH !== undefined && endH * 60 + (emi ?? 0) <= sh * 60 + mi && endH + 12 <= 23) endH += 12;
    toks.push({ start, end, h: sh, mi, eh: endH, emi: endH !== undefined ? (emi ?? 0) : undefined });
  };
  const num = (x: string | undefined) => Number(x ?? 0);
  const meridiemOf = (x: string | undefined): 'am' | 'pm' | undefined => (x ? (x.startsWith('p') ? 'pm' : x.startsWith('a') ? 'am' : undefined) : undefined);

  // Ranges with clock times: "10:00-10:15", "van 10.00 tot 10.15 uur", "tussen 18:00 en 19:00".
  for (const m of s.matchAll(/(?<![\d.,])(\d{1,2})[:.](\d{2})\s*(?:uur|u)?\s*(?:-|\u2013|\u2014|tot(?: en met)?|t\/m|to|until|till)\s*(\d{1,2})[:.](\d{2})(?!\d)\s*(am|pm)?/g)) {
    add(m.index, m.index + m[0].length, num(m[1]), num(m[2]), num(m[3]), num(m[4]), meridiemOf(m[5]));
  }
  // Ranges that need a lead word: "tussen 17 en 19 uur", "between 5 and 7 pm", "van 14 tot 16u".
  for (const m of s.matchAll(/\b(?:tussen|between|van|from)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uur|u|h)?\s*(?:-|\u2013|en|and|tot|to|until|till)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(uur\b|u\b|h\b|am\b|pm\b)?/g)) {
    if (!m[2] && !m[4] && !m[5]) continue;
    add(m.index, m.index + m[0].length, num(m[1]), num(m[2]), num(m[3]), num(m[4]), meridiemOf(m[5]));
  }
  // "18:30", "18.30 uur", "6:30 pm"
  for (const m of s.matchAll(/(?<![\d.,:])(\d{1,2})[:.](\d{2})(?!\d)(?![.,]\d)\s*(am\b|pm\b|a\.m\.|p\.m\.)?/g)) {
    add(m.index, m.index + m[0].length, num(m[1]), num(m[2]), undefined, undefined, meridiemOf(m[3]), /^0\d$/.test(m[1] ?? ''));
  }
  // "18u", "18u30", "18 uur"
  for (const m of s.matchAll(/(?<![\d.,])(\d{1,2})(?:u(\d{2})?|\s+uur)\b/g)) {
    add(m.index, m.index + m[0].length, num(m[1]), num(m[2]));
  }
  // "6 pm", "11am"
  for (const m of s.matchAll(/(?<![\d.,])(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/g)) {
    add(m.index, m.index + m[0].length, num(m[1]), 0, undefined, undefined, meridiemOf(m[2]));
  }
  // "half zeven", "kwart over zes", "kwart voor zeven"
  for (const m of s.matchAll(new RegExp(String.raw`\b(half|kwart over|kwart voor)\s+(${NUMBER_WORD_RE}|\d{1,2})\b`, 'g'))) {
    const base = NUMBER_WORDS[m[2] ?? ''] ?? num(m[2]);
    if (m[1] === 'half') add(m.index, m.index + m[0].length, base - 1 === 0 ? 12 : base - 1, 30);
    else if (m[1] === 'kwart over') add(m.index, m.index + m[0].length, base, 15);
    else add(m.index, m.index + m[0].length, base - 1 === 0 ? 12 : base - 1, 45);
  }
  // "zeven uur"
  for (const m of s.matchAll(new RegExp(String.raw`\b(${NUMBER_WORD_RE})\s+uur\b`, 'g'))) {
    add(m.index, m.index + m[0].length, NUMBER_WORDS[m[1] ?? ''] ?? 0, 0);
  }
  // "om 6", "at 6", but not "at 12 Kerkstraat" (a house number before a street name)
  for (const m of s.matchAll(/\b(?:om|at)\s+(\d{1,2})\b(?![:.,]\d)(?!\s*(?:jaar|maanden|maand|months?|years?|m2|m²|euro|eur|personen|people|kamers|rooms|%|x\b|keer|times))/g)) {
    const end = m.index + m[0].length;
    if (/^\s*[a-z]?\s+[A-Z]/.test(original.slice(end, end + 4)) || /^[a-z]?\s+[a-z]+(?:straat|weg|laan|gracht|kade|plein|singel|dijk|street|road|avenue|lane)\b/.test(s.slice(end, end + 30))) continue;
    add(m.index, end, num(m[1]), 0);
  }

  return toks.sort((a, b) => a.start - b.start);
}

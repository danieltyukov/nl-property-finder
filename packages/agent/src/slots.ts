import { amsterdam, fromAmsterdam, trimCharsEnd, type AutomationConfig, type ProposedSlot } from '@nlpf/core';
import { localDatePlus } from './window.js';

/*
 * Viewing times in Dutch and English free text, resolved on the Amsterdam
 * wall clock. A slot is `certain` only when nothing had to be guessed: the
 * weekday agrees with the date, a time is given, am or pm is clear, the day
 * is not part of a range such as "ma t/m vr", and the time exists exactly
 * once that day (daylight saving). Anything else still yields a slot so the
 * person can pick it, but the policy never books it automatically.
 */

type Part = 'am' | 'pm';

interface TimeTok {
  start: number;
  end: number;
  h: number;
  m: number;
  eh?: number;
  em?: number;
  ampm?: Part;
  kind: 'clock' | 'bare' | 'word';
  weak: boolean; // "N uur" with no "om" before it: only a time right after a day
  padded?: boolean; // "02:30" is written on the 24-hour clock, "2:30" might mean the afternoon
}

interface DayTok {
  start: number;
  end: number;
  weekday?: number; // 0 = Monday
  date?: { d: number; m: number; y?: number };
  rel?: number;
  nextWeek?: boolean;
  part?: Part;
  availability?: boolean;
  range?: boolean;
}

const NUM_WORDS: Record<string, number> = {
  een: 1,
  één: 1,
  twee: 2,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  zeven: 7,
  acht: 8,
  negen: 9,
  tien: 10,
  elf: 11,
  twaalf: 12,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const NL_NUM = '(een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)';
const EN_NUM = '(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const AMPM = '(am|pm|a\\.m\\.|p\\.m\\.)';

const WEEKDAYS: Record<string, number> = {
  maandag: 0,
  dinsdag: 1,
  woensdag: 2,
  donderdag: 3,
  vrijdag: 4,
  zaterdag: 5,
  zondag: 6,
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
  ma: 0,
  di: 1,
  wo: 2,
  do: 3,
  vr: 4,
  vrij: 4,
  za: 5,
  zat: 5,
  zo: 6,
  zon: 6,
  mon: 0,
  tue: 1,
  tues: 1,
  wed: 2,
  thu: 3,
  thur: 3,
  thurs: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};
const FULL_DAYS =
  'maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const ABBR_DAYS = 'ma|di|wo|do|vrij|vr|zat|za|zon|zo|mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun';

const MONTHS =
  'januari|january|jan|februari|february|feb|maart|march|mrt|mar|april|apr|mei|may|juni|june|jun|juli|july|jul|augustus|august|aug|september|sept|sep|oktober|october|okt|oct|november|nov|december|dec';
const monthNumber = (name: string): number => {
  const n = name.slice(0, 3);
  const map: Record<string, number> = {
    jan: 1,
    feb: 2,
    maa: 3,
    mar: 3,
    mrt: 3,
    apr: 4,
    mei: 5,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    okt: 10,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  return map[n] ?? 0;
};

const PM_CONTEXT =
  /('s|s'|s)[\s-]?avonds|\bavond|\bevening|\btonight|('s|s'|s)[\s-]?middags|\bmiddag|\bafternoon|\bpm\b/;
const AM_CONTEXT = /('s|s'|s)[\s-]?(ochtends|morgens)|\bochtend|\bmorning/;
const TIME_KEYWORD = /\b(om|at|rond|around|vanaf|tot|until|by|tegen)\s*$/;
const AVAILABILITY =
  /\b(per|vanaf|beschikbaar|available|from|m\.i\.v\.|ingangsdatum|starting|start|tot|until|t\/m)\s*$/;
const RANGE_JOIN = /^\s*(t\/m|tot en met|-|\u2013|to|through|until|tot)\s*$/;

function ampmOf(s: string | undefined): Part | undefined {
  if (!s) return undefined;
  if (s.startsWith('p')) return 'pm';
  if (s.startsWith('a')) return 'am';
  return undefined;
}

function findTimes(t: string): TimeTok[] {
  const taken = new Array<boolean>(t.length).fill(false);
  const out: TimeTok[] = [];
  const scan = (re: RegExp, make: (m: RegExpExecArray) => TimeTok | null) => {
    for (const m of t.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].trimEnd().length;
      if (taken.slice(start, end).some(Boolean)) continue;
      const tok = make(m as RegExpExecArray);
      if (!tok) continue;
      tok.start = start;
      tok.end = end;
      for (let i = start; i < end; i += 1) taken[i] = true;
      out.push(tok);
    }
  };
  const base = { start: 0, end: 0 };
  const validHm = (h: number, m: number) => h >= 0 && h <= 24 && m >= 0 && m <= 59;

  // tussen 17 en 19 uur, between 5 and 7 pm, van 10:00 tot 12:00
  scan(
    new RegExp(
      `\\b(tussen|between|van|from)\\s+(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.|uur|u)?\\s+(?:en|and|tot|to|until|-|\\u2013)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?!\\d)\\s*(am|pm|a\\.m\\.|p\\.m\\.|uur|u\\b|h\\b)?`,
      'g',
    ),
    (m) => {
      const [, kw, h1, m1, suf1, h2, m2, suf2] = m;
      const bare = m1 === undefined && m2 === undefined;
      if (bare && !suf1 && !suf2 && kw !== 'tussen' && kw !== 'between') return null;
      const tok: TimeTok = {
        ...base,
        h: Number(h1),
        m: Number(m1 ?? 0),
        eh: Number(h2),
        em: Number(m2 ?? 0),
        ampm: ampmOf(suf2) ?? ampmOf(suf1),
        kind: bare ? 'bare' : 'clock',
        weak: false,
      };
      return validHm(tok.h, tok.m) && validHm(tok.eh!, tok.em!) ? tok : null;
    },
  );
  // 10:00-10:15, 18.00 tot 19.00
  scan(
    /(?<![\d:.])(\d{1,2})[:.](\d{2})\s*(?:(am|pm|a\.m\.|p\.m\.|uur|u)\s*)?(?:-|\u2013|\u2014|tot|to|until|t\/m)\s*(\d{1,2})[:.](\d{2})(?!\d)\s*(am|pm|a\.m\.|p\.m\.|uur|u\b|h\b)?/g,
    (m) => {
      const tok: TimeTok = {
        ...base,
        h: Number(m[1]),
        m: Number(m[2]),
        eh: Number(m[4]),
        em: Number(m[5]),
        ampm: ampmOf(m[6]) ?? ampmOf(m[3]),
        kind: 'clock',
        weak: false,
        padded: m[1]!.startsWith('0'),
      };
      return validHm(tok.h, tok.m) && validHm(tok.eh!, tok.em!) ? tok : null;
    },
  );
  // 17-19 uur
  scan(/(?<![\d:.\/-])(\d{1,2})\s*(?:-|\u2013|tot)\s*(\d{1,2})\s*(?:uur|u|h)\b/g, (m) => ({
    ...base,
    h: Number(m[1]),
    m: 0,
    eh: Number(m[2]),
    em: 0,
    kind: 'bare',
    weak: false,
  }));
  // half zeven, kwart over zes, kwart voor zeven
  scan(new RegExp(`\\b(half|kwart over|kwart voor)\\s+${NL_NUM}\\b`, 'g'), (m) => {
    const n = NUM_WORDS[m[2]!]!;
    if (m[1] === 'half') return { ...base, h: n === 1 ? 12 : n - 1, m: 30, kind: 'word', weak: false };
    if (m[1] === 'kwart over') return { ...base, h: n, m: 15, kind: 'word', weak: false };
    return { ...base, h: n === 1 ? 12 : n - 1, m: 45, kind: 'word', weak: false };
  });
  // half past six, quarter to seven
  scan(new RegExp(`\\b(half past|quarter past|quarter to)\\s+${EN_NUM}\\b`, 'g'), (m) => {
    const n = NUM_WORDS[m[2]!]!;
    if (m[1] === 'half past') return { ...base, h: n, m: 30, kind: 'word', weak: false };
    if (m[1] === 'quarter past') return { ...base, h: n, m: 15, kind: 'word', weak: false };
    return { ...base, h: n === 1 ? 12 : n - 1, m: 45, kind: 'word', weak: false };
  });
  // six o'clock, six pm
  scan(new RegExp(`\\b${EN_NUM}\\s*(o['’]?clock|${AMPM})`, 'g'), (m) => ({
    ...base,
    h: NUM_WORDS[m[1]!]!,
    m: 0,
    ampm: ampmOf(m[2]?.startsWith('o') ? undefined : m[2]),
    kind: 'word',
    weak: false,
  }));
  // zes uur
  scan(new RegExp(`\\b${NL_NUM}\\s+uur\\b`, 'g'), (m) => ({
    ...base,
    h: NUM_WORDS[m[1]!]!,
    m: 0,
    kind: 'word',
    weak: !TIME_KEYWORD.test(t.slice(Math.max(0, m.index - 12), m.index)),
  }));
  scan(/\b(noon|midday|middaguur)\b/g, () => ({
    ...base,
    h: 12,
    m: 0,
    ampm: 'pm',
    kind: 'clock',
    weak: false,
  }));
  // 18u30, 18h30
  scan(/(?<![\d:.])(\d{1,2})[uh](\d{2})(?!\d)/g, (m) =>
    validHm(Number(m[1]), Number(m[2]))
      ? { ...base, h: Number(m[1]), m: Number(m[2]), kind: 'clock', weak: false }
      : null,
  );
  // 18:30, 18.30 uur, 6:30pm (not a price such as EUR 12.50, not part of a date such as 26.09.2026)
  scan(/(?<![\d:.\/€-])(\d{1,2})[:.](\d{2})(?!\d|[.\/-]\d)\s*(am|pm|a\.m\.|p\.m\.|uur|u\b|h\b)?/g, (m) => {
    if (/(€|eur|euro)\s*$/.test(t.slice(Math.max(0, m.index - 6), m.index))) return null;
    const tok: TimeTok = {
      ...base,
      h: Number(m[1]),
      m: Number(m[2]),
      ampm: ampmOf(m[3]),
      kind: 'clock',
      weak: false,
      padded: m[1]!.startsWith('0'),
    };
    return validHm(tok.h, tok.m) && tok.h <= 23 ? tok : null;
  });
  // 6pm
  scan(new RegExp(`(?<![\\d:.])(\\d{1,2})\\s*${AMPM}(?![a-z])`, 'g'), (m) => ({
    ...base,
    h: Number(m[1]),
    m: 0,
    ampm: ampmOf(m[2]),
    kind: 'bare',
    weak: false,
  }));
  // 14u, 14 uur
  scan(/(?<![\d:.\/-])(\d{1,2})\s*(?:uur|u|h)\b/g, (m) => {
    const h = Number(m[1]);
    if (h > 23) return null;
    return {
      ...base,
      h,
      m: 0,
      kind: 'bare',
      weak: !TIME_KEYWORD.test(t.slice(Math.max(0, m.index - 12), m.index)),
    };
  });
  // om 6, at 6
  scan(/\b(?:om|at|rond|around)\s+(\d{1,2})(?![\d:.]|\s*(?:uur|u\b|h\b|am|pm|a\.m|p\.m|-|\u2013))/g, (m) => {
    const h = Number(m[1]);
    return h >= 1 && h <= 23 ? { ...base, h, m: 0, kind: 'bare', weak: false } : null;
  });
  return out.sort((a, b) => a.start - b.start);
}

function findDays(t: string, masked: string): DayTok[] {
  const days: DayTok[] = [];
  const push = (d: DayTok) => days.push(d);

  for (const m of masked.matchAll(
    /\b(the day after tomorrow|day after tomorrow|de dag na morgen|overmorgen|morgenavond|morgenmiddag|morgenochtend|morgen|tomorrow|vandaag|today|vanavond|tonight|vanmiddag|vanochtend|this evening|this afternoon|this morning)\b/g,
  )) {
    const w = m[1]!;
    if (w === 'morgen' && /goede\s*$/.test(t.slice(Math.max(0, m.index - 7), m.index))) continue;
    const rel = /after|na morgen|overmorgen/.test(w) ? 2 : /morgen|tomorrow/.test(w) ? 1 : 0;
    const part: Part | undefined = /avond|evening|tonight|middag|afternoon/.test(w)
      ? 'pm'
      : /ochtend|morning/.test(w)
        ? 'am'
        : undefined;
    push({ start: m.index, end: m.index + w.length, rel, part });
  }
  for (const m of masked.matchAll(new RegExp(`\\b(${FULL_DAYS})(avond|middag|ochtend|morgen)?\\b`, 'g'))) {
    const part: Part | undefined = m[2] === 'ochtend' || m[2] === 'morgen' ? 'am' : m[2] ? 'pm' : undefined;
    push({ start: m.index, end: m.index + m[0].length, weekday: WEEKDAYS[m[1]!], part });
  }
  // Two and three letter abbreviations ("za", "do", "sat") are common words too,
  // so they count only right before a date, a time or a day range.
  for (const m of masked.matchAll(new RegExp(`\\b(${ABBR_DAYS})\\b\\.?`, 'g'))) {
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const before = t.slice(Math.max(0, m.index - 12), m.index);
    const nextIsTime = /^\s*[,.]?\s*(?:(?:om|at|van|vanaf|from|tussen|between|rond|around)\s+)?\d/.test(
      after,
    );
    const nextIsDay = new RegExp(
      `^\\s*(t\\/m|tot en met|-|\\u2013|to|through|until|tot)\\s*(${FULL_DAYS}|${ABBR_DAYS})\\b`,
    ).test(after);
    const prevIsRange = new RegExp(
      `(${FULL_DAYS}|${ABBR_DAYS})\\.?\\s*(t\\/m|tot en met|-|\\u2013|to|through|until|tot)\\s*$`,
    ).test(before);
    if (nextIsTime || nextIsDay || prevIsRange)
      push({ start: m.index, end: m.index + m[1]!.length, weekday: WEEKDAYS[m[1]!] });
  }
  const dateTok = (index: number, text: string, d: number, mo: number, y?: number) => {
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return;
    const availability = AVAILABILITY.test(t.slice(Math.max(0, index - 25), index));
    push({
      start: index,
      end: index + trimCharsEnd(text, ',.', true).length,
      date: { d, m: mo, y: y === undefined ? undefined : y < 100 ? 2000 + y : y },
      availability,
    });
  };
  for (const m of masked.matchAll(
    new RegExp(
      `\\b(\\d{1,2})(?:e|ste|de|st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTHS})\\b\\.?(?:\\s*,?\\s*(\\d{4}))?`,
      'g',
    ),
  )) {
    dateTok(m.index, m[0], Number(m[1]), monthNumber(m[2]!), m[3] ? Number(m[3]) : undefined);
  }
  for (const m of masked.matchAll(
    new RegExp(`\\b(${MONTHS})\\b\\.?\\s*(\\d{1,2})(?:st|nd|rd|th|e|ste|de)?\\b(?:\\s*,?\\s*(\\d{4}))?`, 'g'),
  )) {
    if (days.some((x) => x.date && m.index >= x.start && m.index < x.end)) continue;
    dateTok(m.index, m[0], Number(m[2]), monthNumber(m[1]!), m[3] ? Number(m[3]) : undefined);
  }
  for (const m of masked.matchAll(
    /(?<![\d:.\/-])(\d{1,2})[-\/](\d{1,2})(?:[-\/](\d{4}|\d{2}))?(?![\d:\/-])/g,
  )) {
    dateTok(m.index, m[0], Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
  }
  for (const m of masked.matchAll(/(?<![\d:.\/-])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g)) {
    dateTok(m.index, m[0], Number(m[1]), Number(m[2]), Number(m[3]));
  }

  days.sort((a, b) => a.start - b.start);
  // Merge "donderdag 24 sept", "Thursday, September 24", "morgen (donderdag)".
  const merged: DayTok[] = [];
  for (const d of days) {
    const prev = merged[merged.length - 1];
    const gap = prev ? t.slice(prev.end, d.start) : '';
    const combinable =
      prev &&
      d.start >= prev.end &&
      /^[\s,.()]*(?:de|the|on|op)?[\s,.()]*$/.test(gap) &&
      !(prev.date && d.date) &&
      !(prev.weekday !== undefined && d.weekday !== undefined);
    if (prev && combinable) {
      merged[merged.length - 1] = {
        ...prev,
        ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)),
        start: prev.start,
        end: d.end,
        availability: (prev.availability ?? false) && (d.availability ?? false),
        part: prev.part ?? d.part,
      };
    } else if (!prev || d.start >= prev.end) merged.push({ ...d });
  }
  for (let i = 0; i < merged.length; i += 1) {
    const d = merged[i]!;
    const lead = /(volgende week|next week|komende week)\s*(op\s+)?$/.exec(
      t.slice(Math.max(0, d.start - 22), d.start),
    );
    if (lead && d.weekday !== undefined) {
      d.nextWeek = true;
      d.start -= lead[0].length;
    }
    const next = merged[i + 1];
    if (next && RANGE_JOIN.test(t.slice(d.end, next.start))) {
      d.range = true;
      next.range = true;
    }
  }
  return merged;
}

const dayIndex = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const wallIs = (at: Date, y: number, m: number, d: number, h: number, mi: number) => {
  const p = amsterdam(at);
  return p.y === y && p.m === m && p.d === d && p.hh === h && p.mm === mi;
};

interface ResolvedDay {
  y: number;
  m: number;
  d: number;
  conflict: boolean;
  weekdayOnly: boolean;
}

function resolveDay(day: DayTok, now: Date): ResolvedDay | undefined {
  const today = amsterdam(now);
  let conflict = false;
  if (day.date) {
    const { d, m } = day.date;
    let y = day.date.y ?? today.y;
    if (
      day.date.y === undefined &&
      Date.UTC(y, m - 1, d) < Date.UTC(today.y, today.m - 1, today.d) - 60 * 86_400_000
    )
      y += 1;
    if (d > daysInMonth(y, m)) return undefined;
    if (day.weekday !== undefined && dayIndex(y, m, d) !== day.weekday) conflict = true;
    if (day.rel !== undefined) {
      const r = localDatePlus(now, day.rel);
      if (r.y !== y || r.m !== m || r.d !== d) conflict = true;
    }
    return { y, m, d, conflict, weekdayOnly: false };
  }
  if (day.rel !== undefined) {
    const r = localDatePlus(now, day.rel);
    if (day.weekday !== undefined && dayIndex(r.y, r.m, r.d) !== day.weekday) conflict = true;
    return { ...r, conflict, weekdayOnly: false };
  }
  if (day.weekday !== undefined) {
    const todayIdx = dayIndex(today.y, today.m, today.d);
    const add = day.nextWeek ? 7 - todayIdx + day.weekday : (day.weekday - todayIdx + 7) % 7;
    return { ...localDatePlus(now, add), conflict, weekdayOnly: !day.nextWeek };
  }
  return undefined;
}

function resolveHour(
  h: number,
  tok: TimeTok,
  part: Part | undefined,
  globalPm: boolean,
): { h: number; sure: boolean } {
  if (tok.ampm) return { h: (h % 12) + (tok.ampm === 'pm' ? 12 : 0), sure: true };
  if (h >= 12 || h === 0) return { h: h === 24 ? 0 : h, sure: true };
  if (part === 'pm') return { h: h + 12, sure: true };
  if (part === 'am') return { h, sure: true };
  if (tok.kind === 'clock') return h >= 7 || tok.padded ? { h, sure: true } : { h: h + 12, sure: globalPm };
  if (tok.kind === 'bare') return h >= 8 ? { h, sure: true } : { h: h + 12, sure: globalPm };
  // Spoken times ("half zeven") name a clock hour of 1 to 12.
  if (globalPm) return { h: h + 12, sure: true };
  return h <= 7 ? { h: h + 12, sure: false } : { h, sure: false };
}

function contextPart(t: string, tok: TimeTok): Part | undefined {
  const around = `${t.slice(Math.max(0, tok.start - 25), tok.start)} ${t.slice(tok.end, tok.end + 25)}`;
  if (PM_CONTEXT.test(around)) return 'pm';
  if (AM_CONTEXT.test(around)) return 'am';
  return undefined;
}

function instant(y: number, m: number, d: number, h: number, mi: number): { at: Date; dstIssue: boolean } {
  const at = fromAmsterdam(y, m, d, h, mi);
  const missing = !wallIs(at, y, m, d, h, mi);
  const repeated = wallIs(new Date(at.getTime() + 3_600_000), y, m, d, h, mi);
  return { at, dstIssue: missing || repeated };
}

const tidy = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.!,:;]+$/, '');

/**
 * Proposed viewing slots in a message, in Europe/Amsterdam. See the header
 * comment for when a slot counts as certain. Past slots are dropped.
 */
export function parseSlots(text: string, now: Date): ProposedSlot[] {
  const t = text.toLowerCase();
  const times = findTimes(t);
  let masked = t;
  for (const tok of times)
    masked = masked.slice(0, tok.start) + ' '.repeat(tok.end - tok.start) + masked.slice(tok.end);
  const days = findDays(t, masked);

  const rawHourPm = (tok: TimeTok) => tok.ampm === 'pm' || (tok.h >= 12 && tok.h <= 23);
  const byDay = new Map<DayTok, TimeTok[]>();
  const lineOf = (i: number) => t.slice(0, i).split('\n').length;

  for (const tok of times) {
    const before = days.filter((d) => d.end <= tok.start && tok.start - d.end <= 300);
    const after = days.filter(
      (d) => d.start >= tok.end && d.start - tok.end <= 60 && lineOf(d.start) === lineOf(tok.end),
    );
    const sameLineBefore = before.filter((d) => lineOf(d.end) === lineOf(tok.start));
    const day = sameLineBefore[sameLineBefore.length - 1] ?? after[0] ?? before[before.length - 1];
    if (!day) continue;
    if (tok.weak) {
      const gap = day.end <= tok.start ? t.slice(day.end, tok.start) : '';
      if (!/^[\s,.:]{0,3}$/.test(gap) || day.end > tok.start) continue;
    }
    const list = byDay.get(day) ?? [];
    list.push(tok);
    byDay.set(day, list);
  }

  const slots: ProposedSlot[] = [];
  for (const day of days) {
    const r = resolveDay(day, now);
    if (!r) continue;
    const toks = byDay.get(day) ?? [];
    if (toks.length === 0) {
      if (day.availability || (day.weekday === undefined && day.rel === undefined)) continue;
      const midnight = fromAmsterdam(r.y, r.m, r.d, 0, 0);
      if (midnight.getTime() + 86_400_000 <= now.getTime()) continue;
      slots.push({
        start: midnight.toISOString(),
        text: tidy(text.slice(day.start, day.end)),
        certain: false,
      });
      continue;
    }
    if (day.availability && day.weekday === undefined) continue;
    for (const tok of toks) {
      const globalPm = times.some((o) => o !== tok && rawHourPm(o));
      const part = contextPart(t, tok) ?? day.part;
      const sh = resolveHour(tok.h, tok, part, globalPm);
      let { y, m, d } = r;
      let start = instant(y, m, d, sh.h, tok.m);
      if (start.at < now && r.weekdayOnly) {
        ({ y, m, d } = localDatePlus(new Date(Date.UTC(y, m - 1, d, 12)), 7));
        start = instant(y, m, d, sh.h, tok.m);
      }
      if (start.at < now) continue;
      let end: { at: Date; dstIssue: boolean } | undefined;
      let endSure = true;
      if (tok.eh !== undefined) {
        const eh = resolveHour(tok.eh, tok, part, globalPm);
        let endHour = eh.h;
        if (endHour * 60 + (tok.em ?? 0) <= sh.h * 60 + tok.m && endHour < 12) endHour += 12;
        // An end hour that was guessed is still sure when its morning reading
        // would not come after the start: "9:00-3:00" can only end at 15:00.
        const amReadingBeforeStart = tok.eh * 60 + (tok.em ?? 0) <= sh.h * 60 + tok.m;
        endSure = eh.sure || (sh.sure && amReadingBeforeStart);
        end = instant(y, m, d, endHour, tok.em ?? 0);
      }
      const a = Math.min(day.start, tok.start);
      const b = Math.max(day.end, tok.end);
      const snippet = t.slice(a, b).includes('\n')
        ? `${text.slice(day.start, day.end)} ${text.slice(tok.start, tok.end)}`
        : text.slice(a, b);
      const certain =
        !r.conflict && !day.range && sh.sure && endSure && !start.dstIssue && !(end?.dstIssue ?? false);
      const slot: ProposedSlot = { start: start.at.toISOString(), text: tidy(snippet), certain };
      if (end) slot.end = end.at.toISOString();
      slots.push(slot);
    }
  }
  const seen = new Set<string>();
  return slots
    .filter((s) => {
      const key = `${s.start}|${s.end ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** How long a viewing is assumed to take when the landlord gives only a start time. */
export const VIEWING_MINUTES = 30;
const STEP_MINUTES = 15;
const MINUTE = 60_000;

const toMin = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function fitsAvailability(start: Date, end: Date, availability: AutomationConfig['availability']): boolean {
  const s = amsterdam(start);
  const e = amsterdam(end);
  if (s.y !== e.y || s.m !== e.m || s.d !== e.d) return false;
  const sm = s.hh * 60 + s.mm;
  const em = e.hh * 60 + e.mm;
  return availability.some((a) => a.days.includes(s.weekday) && sm >= toMin(a.start) && em <= toMin(a.end));
}

function clashes(start: Date, end: Date, bufferMin: number, busy: { start: string; end: string }[]): boolean {
  const s = start.getTime() - bufferMin * MINUTE;
  const e = end.getTime() + bufferMin * MINUTE;
  return busy.some((b) => s < Date.parse(b.end) && e > Date.parse(b.start));
}

/**
 * The earliest certain slot that lies inside the person's availability and
 * keeps `bufferMin` minutes of travel time around every booked viewing. A
 * long window ("tussen 17 en 19 uur") is narrowed to its first free half
 * hour. Uncertain slots are never chosen; they go to a person.
 */
export function chooseSlot(
  slots: ProposedSlot[],
  availability: AutomationConfig['availability'],
  bufferMin: number,
  busy: { start: string; end: string }[],
): ProposedSlot | null {
  const ordered = slots.filter((s) => s.certain).sort((a, b) => a.start.localeCompare(b.start));
  for (const slot of ordered) {
    const start = Date.parse(slot.start);
    const end = slot.end ? Date.parse(slot.end) : start + VIEWING_MINUTES * MINUTE;
    if (end - start <= VIEWING_MINUTES * MINUTE) {
      if (
        fitsAvailability(new Date(start), new Date(end), availability) &&
        !clashes(new Date(start), new Date(end), bufferMin, busy)
      )
        return slot;
      continue;
    }
    for (let s = start; s + VIEWING_MINUTES * MINUTE <= end; s += STEP_MINUTES * MINUTE) {
      const a = new Date(s);
      const b = new Date(s + VIEWING_MINUTES * MINUTE);
      if (fitsAvailability(a, b, availability) && !clashes(a, b, bufferMin, busy)) {
        return { ...slot, start: a.toISOString(), end: b.toISOString() };
      }
    }
  }
  return null;
}

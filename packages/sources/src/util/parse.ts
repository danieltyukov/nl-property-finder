import { amsterdam, type Furnishing, type PropertyType } from '@nlpf/core';

/**
 * Parsers for the free text Dutch rental sites put in their cards: prices,
 * sizes, room counts, availability dates, furnishing and property type.
 * They read Dutch and English and return undefined rather than guess.
 */

export interface ParsedPrice {
  priceEur?: number;
  basis: 'excl' | 'incl' | 'unknown';
}

/**
 * Reads a number written with Dutch or English separators: "1.250", "1,250",
 * "1.250,00", "850,50", "1250". A group of exactly three digits after the
 * last separator is a thousands group; one or two digits are decimals.
 */
export function parseAmount(raw: string): number | undefined {
  const s = raw.trim().replace(/[.,]-*$/, '');
  if (!/^\d[\d.,]*$/.test(s)) return undefined;
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let value: number;
  if (last === -1) value = Number(s);
  else {
    const decimals = s.length - last - 1;
    if (decimals === 3 && /^\d{1,3}([.,]\d{3})+$/.test(s)) value = Number(s.replace(/[.,]/g, ''));
    else if (decimals <= 2) value = Number(`${s.slice(0, last).replace(/[.,]/g, '')}.${s.slice(last + 1) || '0'}`);
    else value = Number(s.replace(/[.,]/g, ''));
  }
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
}

const INCL = /\binclusief\b|\bincl\b|\bincluding\b|\binclusive\b|\ball[- ]?in\b/i;
const EXCL = /\bexclusief\b|\bexcl\b|\bexcluding\b|\bexclusive\b/i;

function firstBasis(text: string): ParsedPrice['basis'] | undefined {
  const i = text.search(INCL);
  const e = text.search(EXCL);
  if (i === -1 && e === -1) return undefined;
  if (i === -1) return 'excl';
  if (e === -1) return 'incl';
  return i < e ? 'incl' : 'excl';
}

/**
 * The monthly rent in a price text and whether it includes service costs.
 * "€ 1.250,- per maand excl." is `{ priceEur: 1250, basis: 'excl' }`;
 * "Prijs op aanvraag" has no price. With a range the first amount counts.
 */
export function parsePrice(text: string): ParsedPrice {
  const t = (text ?? '').replace(/ /g, ' ');
  const m = /(?:€|\beur(?:o)?\b)\s*(\d[\d.,]*-*)/i.exec(t) ?? /(?<![\w.,])(\d[\d.,]*-*)/.exec(t);
  if (!m) return { basis: firstBasis(t) ?? 'unknown' };
  const priceEur = parseAmount(m[1] ?? '');
  const after = t.slice(m.index + m[0].length);
  const basis = firstBasis(after) ?? firstBasis(t) ?? 'unknown';
  return priceEur === undefined ? { basis } : { priceEur, basis };
}

const AREA_UNIT = String.raw`(?:m²|m2|m\^2|㎡|vierkante\s*meters?|sq\.?\s*m\b|sqm\b|square\s*met(?:re|er)s?)`;

/** Living area in whole square metres: "Woonoppervlakte 42 m²" is 42. A bare number is taken as square metres. */
export function parseSize(text: string): number | undefined {
  const t = (text ?? '').replace(/ /g, ' ');
  const m = new RegExp(String.raw`(\d[\d.,]*)\s*${AREA_UNIT}`, 'i').exec(t) ?? /^\s*(\d[\d.,]*)\s*$/.exec(t);
  const n = m ? parseAmount(m[1] ?? '') : undefined;
  return n === undefined || n <= 0 ? undefined : Math.round(n);
}

const NOT_AREA = String.raw`(?!\s*[.,]?\d*\s*${AREA_UNIT})`;

/** Number of rooms ("3 kamers", "Aantal kamers: 4", "2 rooms"). Bedrooms alone do not count. */
export function parseRooms(text: string): number | undefined {
  const t = text ?? '';
  const m =
    /(\d{1,2})\s*(?:-\s*)?(?:kamers?|rooms?)(?:appartement|woning)?\b/i.exec(t) ??
    new RegExp(String.raw`(?:\bkamers?|(?<!(?:living|dining|sitting)\s?)\brooms?)\s*(?::\s*)?(\d{1,2})\b${NOT_AREA}`, 'i').exec(t) ??
    /^\s*(\d{1,2})\s*$/.exec(t);
  return m ? Number(m[1]) : undefined;
}

/** Number of bedrooms ("2 slaapkamers", "1 bedroom", "Aantal slaapkamers: 3"). */
export function parseBedrooms(text: string): number | undefined {
  const t = text ?? '';
  const m =
    /(\d{1,2})\s*(?:slaapkamers?|bedrooms?|slpk)\b/i.exec(t) ??
    /\b(?:slaapkamers?|bedrooms?)\s*(?::\s*)?(\d{1,2})\b/i.exec(t) ??
    /^\s*(\d{1,2})\s*$/.exec(t);
  return m ? Number(m[1]) : undefined;
}

const MONTHS: Record<string, number> = {
  januari: 1, january: 1, jan: 1,
  februari: 2, february: 2, feb: 2,
  maart: 3, march: 3, mrt: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, june: 6, jun: 6,
  juli: 7, july: 7, jul: 7,
  augustus: 8, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  oktober: 10, october: 10, okt: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};
const MONTH = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')})\\.?(?![a-z])`;

const IMMEDIATE =
  /\bper\s+direct\b|\bdirect\b|\bper\s+omgaande\b|\bonmiddellijk\b|\bimmediately\b|\bavailable\s+now\b|\bnu\s+beschikbaar\b|\bz\.s\.m\.|\bzo\s+snel\s+mogelijk\b|\basap\b/i;

const pad = (n: number) => String(n).padStart(2, '0');

function ymd(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** A date without a year is the coming one, unless it passed less than 60 days ago. */
function withYear(m: number, d: number, now: Date): string | undefined {
  const today = amsterdam(now);
  const thisYear = ymd(today.y, m, d);
  if (!thisYear) return ymd(today.y + 1, m, d);
  const ageDays = (Date.UTC(today.y, today.m - 1, today.d) - Date.UTC(today.y, m - 1, d)) / 86_400_000;
  return ageDays > 60 ? ymd(today.y + 1, m, d) : thisYear;
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * The availability date in a text, as YYYY-MM-DD in Amsterdam. "per direct"
 * is today; "Beschikbaar vanaf 1 november 2026" is 2026-11-01; "vanaf
 * december" is the first of that month. Returns undefined for "in overleg".
 */
export function parseDutchDate(text: string, now: Date = new Date()): string | undefined {
  const t = (text ?? '').toLowerCase().replace(/ /g, ' ');
  if (!t.trim()) return undefined;

  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(t);
  if (m) return ymd(fullYear(m[3] ?? ''), Number(m[2]), Number(m[1]));

  m = new RegExp(String.raw`\b(\d{1,2})(?:e|ste|de|st|nd|rd|th)?\s+${MONTH}(?:\s+(\d{4}))?`).exec(t);
  if (m) {
    const month = MONTHS[m[2] ?? ''] ?? 0;
    return m[3] ? ymd(Number(m[3]), month, Number(m[1])) : withYear(month, Number(m[1]), now);
  }

  m = new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b,?(?:\s+(\d{4}))?`).exec(t);
  if (m) {
    const month = MONTHS[m[1] ?? ''] ?? 0;
    return m[3] ? ymd(Number(m[3]), month, Number(m[2])) : withYear(month, Number(m[2]), now);
  }

  if (IMMEDIATE.test(t)) {
    const p = amsterdam(now);
    return ymd(p.y, p.m, p.d);
  }

  m = new RegExp(String.raw`\b${MONTH}(?:\s+(\d{4}))?`).exec(t);
  if (m) {
    const month = MONTHS[m[1] ?? ''] ?? 0;
    return m[2] ? ymd(Number(m[2]), month, 1) : withYear(month, 1, now);
  }
  return undefined;
}

function earliest<T>(text: string, patterns: [RegExp, T][]): T | undefined {
  let best: { index: number; value: T } | undefined;
  for (const [re, value] of patterns) {
    const i = text.search(re);
    if (i !== -1 && (!best || i < best.index)) best = { index: i, value };
  }
  return best?.value;
}

const FURNISHING: [RegExp, Furnishing][] = [
  [/\b(?:on|niet[- ]?)gemeubileerde?\b|\bongemeubelde?\b|\bunfurnished\b|\bnot\s+furnished\b|\bkaal\b/i, 'unfurnished'],
  [/\bsemi[- ]?(?:furnished|gemeubileerde?|gemeubelde?)\b|\bgestoffeerde?\b|\bupholstered\b|\bpart(?:ly|ially)\s+furnished\b/i, 'upholstered'],
  [/(?<!semi[- ]?|not\s+)\bfurnished\b|\bgemeubileerde?\b|\bgemeubelde?\b/i, 'furnished'],
];

/** Furnishing from text; the first term mentioned wins. "Gestoffeerd" is `upholstered`. */
export function detectFurnishing(text: string): Furnishing {
  return earliest(text ?? '', FURNISHING) ?? 'unknown';
}

const TYPES: [RegExp, PropertyType][] = [
  [/\bstudio(?:'s|s)?\b|\bstudiootje\b/i, 'studio'],
  [
    /\b(?:kamer|studentenkamer|hospitakamer|onzelfstandige?(?:\s+woonruimte)?)\b|(?<!(?:living|dining|sitting|storage|utility|laundry|bike|guest|box|family|common|shower|boiler)\s?)\broom\b/i,
    'room',
  ],
  [
    /\b(?:appartement|apartment|flat|bovenwoning|benedenwoning|penthouse|maisonnette|portiekwoning|galerijflat|portiekflat|etage|etagewoning|loft)\b/i,
    'apartment',
  ],
  [
    /\b(?:woonhuis|huis|eengezinswoning|tussenwoning|hoekwoning|twee-onder-een-kap(?:woning)?|2-onder-1-kap|vrijstaande?\s+woning|villa|house|rijtjeshuis|herenhuis|geschakelde\s+woning|townhouse)\b/i,
    'house',
  ],
];

/** Property type from a type label, title or description; the first type word mentioned wins. */
export function detectType(text: string): PropertyType | undefined {
  return earliest(text ?? '', TYPES);
}

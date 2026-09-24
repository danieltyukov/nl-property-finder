import { amsterdamDate } from '@nlpf/core';
import type { Address, ContactMethod, Furnishing, InboundMessage, PropertyType, RawListing } from '@nlpf/core';
import { readHtml, readText, type Doc } from '../html.js';

/**
 * Shared engine for alert emails. Every platform's alert is a list of cards:
 * a link to the listing (often several: photo, title, "view" button) and a
 * few lines of text around it. The engine finds the listing links with the
 * platform's URL matcher, cuts the mail into one block of lines per listing,
 * and reads price, size, rooms, address and dates from each block.
 *
 * Alert emails are untrusted input. Only links whose URL the matcher accepts
 * become listings, so a mail cannot point a listing at an arbitrary site
 * while claiming to be a platform.
 */

export interface UrlMatch {
  sourceId: string;
  externalId: string;
  /** Canonical listing URL without tracking parameters. */
  url: string;
  contact: ContactMethod;
  /** Type the URL states for certain (a Pararius `/studio-te-huur/` path). */
  type?: PropertyType;
  /** Type the URL suggests, used only when the text names none (a Marktplaats category). */
  typeHint?: PropertyType;
  city?: string;
  street?: string;
}

export type UrlMatcher = (url: URL) => UrlMatch | null;

export interface ExtractOptions {
  /** Drop listings without a price (the generic fallback needs one to be believed). */
  requirePrice?: boolean;
}

/* ---------- URLs ---------- */

const WRAP_PARAMS = new Set(['u', 'url', 'redirect', 'redirect_url', 'redirecturl', 'target', 'dest', 'destination', 'link', 'r', 'q', 'to']);

/** Parses an href and follows click-tracking wrappers that carry the destination in a query parameter. */
export function unwrapUrl(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }
  for (let depth = 0; depth < 3; depth++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    let inner: URL | null = null;
    for (const [key, raw] of url.searchParams) {
      if (!WRAP_PARAMS.has(key.toLowerCase())) continue;
      const value = /^https?%3a/i.test(raw) ? safeDecode(raw) : raw;
      if (!/^https?:\/\//i.test(value)) continue;
      try {
        inner = new URL(value);
        break;
      } catch {
        // not a URL after all
      }
    }
    if (!inner) return url;
    url = inner;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|correlationid|trk|ref|source|campaign)$/i;

/** The URL without tracking parameters and fragment. */
export function stripTracking(url: URL): URL {
  const out = new URL(url.href);
  out.hash = '';
  for (const key of [...out.searchParams.keys()]) if (TRACKING_PARAM.test(key)) out.searchParams.delete(key);
  return out;
}

/** Host without `www.`, lowercased. */
export const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/** The last two labels of a host name (`mail.funda.nl` gives `funda.nl`). */
export function registrableDomain(host: string): string {
  const labels = bareHost(host).split('.').filter(Boolean);
  return labels.slice(-2).join('.');
}

export const hostIs = (host: string, domains: readonly string[]): boolean => {
  const h = bareHost(host);
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
};

/* ---------- text helpers ---------- */

const PARTICLES = new Set(['aan', 'den', 'de', 'der', 'van', 'op', 'in', 'bij', 'het', 'ter', 'ten', 'te', 'en', 'onder', 'over', 'of']);

/** `van-der-heimstraat` gives `Van der Heimstraat`, `den-haag` gives `Den Haag`, `s-gravenhage` gives `'s-Gravenhage`. */
export function titleCaseSlug(slug: string): string {
  const s = safeDecode(slug).trim().toLowerCase();
  if (s.startsWith('s-')) return `'s-${titleCaseSlug(s.slice(2))}`;
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && PARTICLES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Parses Dutch and English money notation: `1.395`, `1,150`, `675,00`, `625,-`. */
export function parseEuroNumber(raw: string): number {
  const s = raw.trim().replace(/[.,-]+$/, '');
  if (!/^\d[\d.,]*$/.test(s)) return NaN;
  const groups = s.split(/[.,]/);
  if (groups.length === 1) return Number(s);
  const last = groups[groups.length - 1] ?? '';
  if (last.length === 3) return Number(groups.join(''));
  if (last.length <= 2) return Number(`${groups.slice(0, -1).join('')}.${last}`);
  return NaN;
}

const URL_RE = /https?:\/\/\S+/g;
// Bounded digit groups, and no start inside a run of digits, keep this linear on hostile text.
const PRICE_RE = /(?:€|\bEUR\b)\s*(\d[\d.,]{0,12}(?:,-{1,2})?)|(?<![\d.,])(\d[\d.,]{0,12})\s*(?:euro|eur)\b/gi;
const NOT_RENT_BEFORE = /(borg|waarborg|deposit|servicekosten|service ?costs?|service ?charges?|bijkomende|g\/w\/l|gwl|energie|voorschot|administratie|bemiddeling)\W{0,12}$/i;

export interface PriceHit {
  value: number;
  basis?: 'incl' | 'excl';
}

/** The first rent-looking amount in the lines, skipping deposits and service costs. */
export function findPrice(lines: string[]): PriceHit | undefined {
  for (const line of lines) {
    PRICE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PRICE_RE.exec(line))) {
      const before = line.slice(Math.max(0, m.index - 30), m.index);
      if (NOT_RENT_BEFORE.test(before)) continue;
      const value = parseEuroNumber(m[1] ?? m[2] ?? '');
      if (!Number.isFinite(value) || value < 50 || value > 25_000) continue;
      const hit: PriceHit = { value: Math.round(value * 100) / 100 };
      if (/\b(incl|inclusief|including|all[- ]?in)\b/i.test(line)) hit.basis = 'incl';
      else if (/\b(excl|exclusief|excluding|kale huur)\b/i.test(line)) hit.basis = 'excl';
      return hit;
    }
  }
  return undefined;
}

export function findSize(text: string): number | undefined {
  const m = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|m2|m\^2|㎡|vierkante\s+meter|sqm|sq\.?\s?m)(?![\p{L}\d])/iu.exec(text);
  if (!m?.[1]) return undefined;
  const v = Math.round(Number(m[1].replace(',', '.')));
  return v >= 5 && v <= 2000 ? v : undefined;
}

const count = (re: RegExp, text: string): number | undefined => {
  const m = re.exec(text);
  const v = m?.[1] ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 && v < 30 ? v : undefined;
};

export const findRooms = (text: string) => count(/\b(\d{1,2})\s*(?:kamers?|rooms?)\b/i, text);
export const findBedrooms = (text: string) => count(/\b(\d{1,2})\s*(?:slaapkamers?|bedrooms?)\b/i, text);

export function findEnergyLabel(text: string): string | undefined {
  const m = /\b(?:energielabel|energy\s+label)\s*:?\s*([A-G](?:\+{1,4})?)(?![\w+])/i.exec(text);
  return m?.[1]?.toUpperCase();
}

export function findFurnishing(text: string): Furnishing | undefined {
  if (/\b(ongemeubileerd|unfurnished|kaal)\b/i.test(text)) return 'unfurnished';
  if (/\b(gestoffeerd|upholstered|semi[- ]furnished)\b/i.test(text)) return 'upholstered';
  if (/\b(gemeubileerd|gemeubeld|furnished)\b/i.test(text)) return 'furnished';
  return undefined;
}

const TYPE_WORDS: [RegExp, PropertyType][] = [
  [/\bstudio'?s?\b/i, 'studio'],
  [/\b(kamer|room|studentenkamer|onzelfstandig)\b/i, 'room'],
  [/\b(appartement|apartment|flat|bovenwoning|benedenwoning|maisonnette|penthouse|portiekwoning)\b/i, 'apartment'],
  [/\b(huis|house|eengezinswoning|woonhuis|tussenwoning|hoekwoning|villa|twee-onder-een-kap)\b/i, 'house'],
];

/** The type named earliest in the text. */
export function findType(text: string): PropertyType | undefined {
  let best: { at: number; type: PropertyType } | undefined;
  for (const [re, type] of TYPE_WORDS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { at: m.index, type };
  }
  return best?.type;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mrt: 3, maart: 3, mar: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8,
  augustus: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** Move-in date as YYYY-MM-DD. A date without a year is the next such date on or after the mail date. */
export function findAvailableFrom(text: string, mailAt: Date): string | undefined {
  const lead = String.raw`(?:beschikbaar|available|per|vanaf|from|ingangsdatum|move[- ]in)`;
  if (/\b(per direct|direct beschikbaar|beschikbaar per direct|available (?:now|immediately)|immediately available)\b/i.test(text)) {
    return amsterdamDate(mailAt);
  }
  const today = amsterdamDate(mailAt);
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const build = (y: number | undefined, m: number, d: number): string | undefined => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    let year = y ?? ty;
    if (y === undefined && (m < tm || (m === tm && d < td))) year = ty + 1;
    return `${year}-${pad(m)}-${pad(d)}`;
  };
  // "per" also starts "per maand", so every candidate is tried until one is a real date.
  for (const m of text.matchAll(new RegExp(String.raw`\b${lead}\b[^\n\d]{0,20}?(\d{1,2})\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?`, 'gi'))) {
    const month = MONTHS[m[2]?.toLowerCase() ?? ''];
    const date = month ? build(m[3] ? Number(m[3]) : undefined, month, Number(m[1])) : undefined;
    if (date) return date;
  }
  for (const m of text.matchAll(new RegExp(String.raw`\b${lead}\b[^\n\d]{0,20}?(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})`, 'gi'))) {
    const date = build(Number(m[3]), Number(m[2]), Number(m[1]));
    if (date) return date;
  }
  return undefined;
}

// Suffixes that also end common town names (Rotterdam, Eindhoven, Emmeloord) are left out on purpose.
const STREET_SUFFIX = /(straat|weg|laan|plein|gracht|kade|singel|dijk|steeg|hof|park|dreef|pad|markt|plantsoen|kanaal|haven|wal|vest|burgwal|baan|ring|erf|poort|zijde|boulevard|allee|kwartier)$/i;
const TYPE_PREFIX = /^(?:(?:ruime|mooie|nieuwe|lichte|gezellige|private|shared|gedeelde|gemeubileerde|gestoffeerde)\s+)?(?:appartement|studio|kamer|huis|woning|room|apartment|house|eengezinswoning|benedenwoning|bovenwoning|maisonnette|penthouse|studentenkamer|tussenwoning|hoekwoning|flat)(?:\s+(?:in|aan|at|on|op)(?:\s+de)?)?\s+/i;
const WORD = String.raw`(?:'s[- ])?\p{Lu}[\p{L}'.-]*`;
const STREET_RE = new RegExp(
  String.raw`^(${WORD}(?:[ ](?:${WORD}|van|de|der|den|het|'t|aan|op|in|ter|ten|te|en|bij))*)(?:\s+(\d{1,5})(?:\s*-?\s*([A-Za-z]{1,2}|\d{1,4}[A-Za-z]?))?)?\s*(?:,\s*(.+))?$`,
  'u',
);
// Words are joined by single spaces only: a hyphen belongs to the word ("Tanthof-West"), so no
// input can be split into words in more than one way, which keeps matching linear.
const CITY_RE = new RegExp(String.raw`^${WORD}(?:[ ](?:${WORD}|aan|den|de|op|in|bij))*$`, 'u');

const isCity = (s: string | undefined): s is string => !!s && s.length <= 40 && CITY_RE.test(s) && !STREET_SUFFIX.test(s);

/** Street, number and addition from a card title such as "Oude Delft 12 A" or "Appartement Kruisstraat". */
export function streetFromTitle(title: string): { street?: string; houseNumber?: string; addition?: string; city?: string } {
  const rest = title.trim().replace(TYPE_PREFIX, '');
  const m = STREET_RE.exec(rest);
  if (!m?.[1]) return {};
  const street = m[1].trim();
  const houseNumber = m[2];
  if (!houseNumber && !STREET_SUFFIX.test(street)) return {};
  const out: { street?: string; houseNumber?: string; addition?: string; city?: string } = { street };
  if (houseNumber) out.houseNumber = houseNumber;
  if (m[3]) out.addition = m[3].toUpperCase();
  const tail = m[4]?.trim();
  if (isCity(tail)) out.city = tail;
  return out;
}

const POSTCODE_RE = /\b([1-9]\d{3})\s?([A-Z]{2})\b([^\n]*)/;
const AFTER_POSTCODE = new RegExp(String.raw`^\s*,?\s*(${WORD}(?:[ ](?:${WORD}|aan|den|de|op|in|bij))*)\s*(?:\(([^)]{1,60})\))?`, 'u');

export function findPostcode(text: string): { postcode?: string; city?: string; neighbourhood?: string } {
  const m = POSTCODE_RE.exec(text);
  if (!m?.[1] || !m[2]) return {};
  const out: { postcode?: string; city?: string; neighbourhood?: string } = { postcode: `${m[1]} ${m[2]}` };
  const after = AFTER_POSTCODE.exec(m[3] ?? '');
  if (after?.[1] && isCity(after[1].trim())) out.city = after[1].trim();
  if (after?.[2]) out.neighbourhood = after[2].trim();
  return out;
}

/** "Delft · Vandaag" or "Rotterdam | 3 km": a place followed by a date or a distance. */
export function cityFromLocationLine(lines: string[]): string | undefined {
  // No "i" flag: with it \p{Lu} also matches lowercase letters and "de" could be read two ways.
  const re = new RegExp(
    String.raw`^(${WORD}(?:[ ](?:${WORD}|aan|den|de|op|in|bij))*)\s*[·•|]\s*(?:[Vv]andaag|[Gg]isteren|[Ee]ergisteren|[Tt]oday|[Yy]esterday|\d{1,2}\s+\p{L}+|\d{1,4}(?:[.,]\d+)?\s*km)\b`,
    'u',
  );
  for (const line of lines) {
    const m = re.exec(line);
    if (m?.[1] && isCity(m[1])) return m[1];
  }
  return undefined;
}

function cityFromTitle(title: string): string | undefined {
  const m = new RegExp(String.raw`\bin[ ](${WORD}(?:[ ](?:aan|den|de|op|${WORD}))*)`, 'u').exec(title);
  const city = m?.[1]?.trim();
  return isCity(city) ? city : undefined;
}

const GENERIC_LINK_TEXT = /^(bekijk|view|see|meer info|more info|details|lees meer|read more|open|klik|click|reageer|respond|contact|naar de|ga naar|go to|foto|photo)\b/i;

const meaningful = (s: string): boolean =>
  s.length >= 3 && !GENERIC_LINK_TEXT.test(s) && !/^https?:\/\//i.test(s) && !/^[\d\s€.,/-]+$/.test(s) && !/^(?:€|EUR)\s*\d/i.test(s);

const FOOTER = /^(bekijk alle|alle resultaten|see all|view all|je ontvangt|u ontvangt|you receive|you are receiving|uitschrijven|afmelden|unsubscribe|beheer|manage|instellingen|settings|privacy|zoekopdrachten beheren|alert beheren)/i;
const MAX_BLOCK_LINES = 12;
const MAX_LINE = 500; // bounds the cost of every pattern run on a line of an untrusted mail
const MAX_TITLE = 200;

interface Block {
  key: string;
  match: UrlMatch;
  lines: number[];
}

function segment(doc: Doc, keys: (string | null)[], matches: (UrlMatch | null)[]): Block[] {
  const blocks = new Map<string, Block>();
  const lineKeys = doc.lines.map((line) => [...new Set(line.links.map((i) => keys[i]).filter((k): k is string => !!k))]);
  const matchFor = (key: string): UrlMatch | null => {
    const i = keys.indexOf(key);
    return i >= 0 ? (matches[i] ?? null) : null;
  };
  const open = (key: string): Block | undefined => {
    let b = blocks.get(key);
    if (!b) {
      const match = matchFor(key);
      if (!match) return undefined;
      b = { key, match, lines: [] };
      blocks.set(key, b);
    }
    return b;
  };

  const linkStart = (indexes: number[]) => {
    let current: Block | undefined;
    for (const i of indexes) {
      const line = doc.lines[i];
      if (!line) continue;
      const lk = lineKeys[i] ?? [];
      if (!lk.length && FOOTER.test(line.text)) {
        current = undefined;
        continue;
      }
      for (const key of lk) if (!blocks.has(key)) current = open(key);
      if (current && current.lines.length < MAX_BLOCK_LINES) current.lines.push(i);
    }
  };

  if (doc.kind === 'text') {
    // Plain text puts one listing per paragraph, often with the link last.
    const paras = new Map<number, number[]>();
    doc.lines.forEach((line, i) => paras.set(line.para, [...(paras.get(line.para) ?? []), i]));
    for (const indexes of paras.values()) {
      const inPara = [...new Set(indexes.flatMap((i) => lineKeys[i] ?? []))];
      if (inPara.length === 1 && inPara[0]) {
        const b = open(inPara[0]);
        if (b && !b.lines.length) b.lines.push(...indexes.slice(0, MAX_BLOCK_LINES));
      } else if (inPara.length > 1) {
        linkStart(indexes);
      }
    }
  } else {
    linkStart(doc.lines.map((_, i) => i));
  }
  return [...blocks.values()];
}

function compactAddress(a: Address): Address {
  const out: Address = {};
  for (const [k, v] of Object.entries(a) as [keyof Address, string | number | undefined][]) {
    if (v !== undefined && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Runs the engine over one mail with one URL matcher: the HTML part first, the text part when HTML gives nothing. */
export function extractAlertListings(mail: InboundMessage, match: UrlMatcher, opts: ExtractOptions = {}): RawListing[] {
  if (mail.html) {
    const fromHtml = extractFromDoc(readHtml(mail.html), mail, match, opts);
    if (fromHtml.length || !mail.text) return fromHtml;
  }
  return extractFromDoc(readText(mail.text), mail, match, opts);
}

function extractFromDoc(doc: Doc, mail: InboundMessage, match: UrlMatcher, opts: ExtractOptions): RawListing[] {
  const matches = doc.links.map((l) => {
    const url = unwrapUrl(l.href);
    return url ? match(url) : null;
  });
  const keys = matches.map((m) => (m ? `${m.sourceId}:${m.externalId}` : null));
  const mailAt = new Date(mail.at);
  const out: RawListing[] = [];

  for (const block of segment(doc, keys, matches)) {
    const m = block.match;
    const lines = block.lines
      .map((i) => (doc.lines[i]?.text ?? '').replace(URL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE))
      .filter(Boolean);
    const text = lines.join('\n');
    const own = doc.links.filter((_, i) => keys[i] === block.key);

    const title = (own.map((l) => l.text).find(meaningful) ?? lines.find(meaningful) ?? m.street ?? m.externalId).slice(0, MAX_TITLE);
    const fromTitle = streetFromTitle(title);
    const pc = findPostcode(text);
    const city = pc.city ?? m.city ?? fromTitle.city ?? cityFromLocationLine(lines) ?? cityFromTitle(title);

    const listing: RawListing = {
      sourceId: m.sourceId,
      externalId: m.externalId,
      url: m.url,
      title,
      address: compactAddress({
        street: fromTitle.street ?? m.street,
        houseNumber: fromTitle.houseNumber,
        addition: fromTitle.addition,
        postcode: pc.postcode,
        city,
        neighbourhood: pc.neighbourhood,
      }),
      contact: m.contact,
      extra: { via: 'alert', alertMessageId: mail.id },
    };

    const price = findPrice(lines);
    if (price) {
      listing.priceEur = price.value;
      if (price.basis) listing.priceBasis = price.basis;
    } else if (opts.requirePrice) {
      continue;
    }
    const size = findSize(text);
    if (size !== undefined) listing.sizeM2 = size;
    const rooms = findRooms(text);
    if (rooms !== undefined) listing.rooms = rooms;
    const bedrooms = findBedrooms(text);
    if (bedrooms !== undefined) listing.bedrooms = bedrooms;
    const type = m.type ?? findType(title) ?? findType(text) ?? m.typeHint;
    if (type) listing.type = type;
    const furnishing = findFurnishing(text);
    if (furnishing) listing.furnishing = furnishing;
    const available = findAvailableFrom(text, mailAt);
    if (available) listing.availableFrom = available;
    const label = findEnergyLabel(text);
    if (label) listing.energyLabel = label;
    const images = [...new Set(own.flatMap((l) => l.images))].filter((src) => /^https:\/\//i.test(src)).slice(0, 5);
    if (images.length) listing.images = images;
    out.push(listing);
  }
  return out;
}

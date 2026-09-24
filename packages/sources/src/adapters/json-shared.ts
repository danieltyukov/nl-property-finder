/**
 * Helpers shared by the JSON platform adapters (Funda, Kamernet,
 * HousingAnywhere, Marktplaats, Vesteda, SSH): turning the user's searches
 * into municipalities, a small table of Dutch places for platforms that
 * search by coordinates or postcode, alert-email card extraction, and a few
 * browser steps the contact flows have in common.
 */
import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { Page } from 'playwright-core';
import { fromAmsterdam, type InboundMessage, type Lang, type NamedSearch, type SourceContext } from '@nlpf/core';
import { parseDutchDate } from '../util/parse.js';

type AnyNode = Exclude<Parameters<typeof load>[0], string | Buffer | readonly unknown[]>;

/* ---------- small value helpers ---------- */

/** Removes keys whose value is undefined, so fixtures and snapshots stay tidy. */
export function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export const clean = (s: string | undefined | null): string => (s ?? '').replace(/[\s ]+/g, ' ').trim();

/** A finite number from a number or numeric string, else undefined. */
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export const positive = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
};

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** "Den Haag" becomes "den-haag"; "'s-Gravenhage" becomes "s-gravenhage". */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "UTRECHT" and "utrecht" become "Utrecht"; "'s-gravenhage" becomes "'s-Gravenhage". */
export function titleCase(text: string): string {
  return clean(text)
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(/^'S-/, "'s-");
}

/** YYYY-MM-DD from an ISO date or date-time string. */
export function ymd(v: unknown): string | undefined {
  const s = str(v);
  const m = s ? /^(\d{4}-\d{2}-\d{2})/.exec(s) : null;
  return m?.[1];
}

/** An ISO instant from an ISO string (with or without zone; a bare date or time is read as Amsterdam time). */
export function isoInstant(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const bare = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(s);
  if (bare) {
    const [, y, m, d, hh, mm, ss] = bare;
    const at = fromAmsterdam(Number(y), Number(m), Number(d), Number(hh ?? 0), Number(mm ?? 0));
    return new Date(at.getTime() + Number(ss ?? 0) * 1000).toISOString();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Midnight in Amsterdam of a YYYY-MM-DD date, as an ISO instant. */
export function amsterdamMidnight(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return fromAmsterdam(y ?? 1970, m ?? 1, d ?? 1, 0, 0).toISOString();
}

/** "Vandaag", "Gisteren", "Eergisteren", "9 sep 26" or "9 sep" as the start of that day in Amsterdam. */
export function relativeDutchDay(text: string | undefined, now: Date): string | undefined {
  const t = clean(text).toLowerCase();
  if (!t) return undefined;
  const back = t === 'vandaag' || t === 'today' ? 0 : t === 'gisteren' || t === 'yesterday' ? 1 : t === 'eergisteren' ? 2 : undefined;
  if (back !== undefined) {
    const today = parseDutchDate('per direct', now);
    if (!today) return undefined;
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    return amsterdamMidnight(d.toISOString().slice(0, 10));
  }
  const short = /^(\d{1,2})\s+([a-z]+)\.?\s+(\d{2})$/.exec(t);
  const date = parseDutchDate(short ? `${short[1]} ${short[2]} 20${short[3]}` : t, now);
  return date ? amsterdamMidnight(date) : undefined;
}

const NL_WORDS = /\b(de|het|een|en|van|te|huur|kamer|met|voor|is|op|zijn|beschikbaar|woning|per maand|gemeubileerd)\b/gi;
const EN_WORDS = /\b(the|and|a|for|rent|room|with|in|is|available|month|furnished|apartment|house)\b/gi;

/** Dutch or English, from common words; undefined for text too short to tell. */
export function guessLanguage(text: string | undefined): Lang | undefined {
  const t = text ?? '';
  const nl = t.match(NL_WORDS)?.length ?? 0;
  const en = t.match(EN_WORDS)?.length ?? 0;
  if (nl + en < 3) return undefined;
  return en > nl ? 'en' : 'nl';
}

/* ---------- searches ---------- */

/** Municipality spellings that platforms know under another name. */
const ALIASES: Record<string, string> = {
  "'s-gravenhage": 'den haag',
  's-gravenhage': 'den haag',
  'the hague': 'den haag',
  "'s-hertogenbosch": 'den bosch',
  's-hertogenbosch': 'den bosch',
  'hertogenbosch': 'den bosch',
};

/** A municipality name lowercased, trimmed and with its common alias resolved ("'s-Gravenhage" is "den haag"). */
export function canonicalMunicipality(name: string): string {
  const n = clean(name).toLowerCase();
  return ALIASES[n] ?? n;
}

/**
 * The municipalities a search covers, lowercased and deduplicated, in
 * config order. A region without municipalities counts by its name, unless
 * it only lists postcodes or a polygon (those are checked after polling).
 */
export function searchMunicipalities(search: NamedSearch): string[] {
  const out: string[] = [];
  for (const region of search.regions) {
    const names = region.municipalities.length
      ? region.municipalities
      : region.postcodes.length || region.polygon?.length
        ? []
        : [region.name];
    for (const n of names) {
      const c = canonicalMunicipality(n);
      if (c && !out.includes(c)) out.push(c);
    }
  }
  return out;
}

/** Display name for a canonical municipality ("den haag" is "Den Haag"). */
export function municipalityName(canonical: string): string {
  return PLACES[canonical]?.name ?? titleCase(canonical);
}

/** A short signature of the filters one request encodes, for deduplicated request keys. */
export function filterKey(parts: Record<string, string | number | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/* ---------- places ---------- */

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** A central postcode, only where it was checked against a live search. */
  postcode?: string;
  /** Radius that covers the municipality from its centre, in km. */
  radiusKm: number;
}

/**
 * Centres of the municipalities people search most. Coordinates are rounded
 * town centres; postcodes are listed only where a live Marktplaats search
 * accepted them (2026-09-24). Anything missing is looked up at runtime with
 * the PDOK Locatieserver (see `resolvePlace`).
 */
export const PLACES: Record<string, Place> = {
  delft: { name: 'Delft', lat: 52.0116, lon: 4.3571, postcode: '2611BC', radiusKm: 5 },
  rotterdam: { name: 'Rotterdam', lat: 51.9225, lon: 4.4792, postcode: '3011AD', radiusKm: 10 },
  'den haag': { name: 'Den Haag', lat: 52.0705, lon: 4.3007, postcode: '2511CV', radiusKm: 7 },
  leiden: { name: 'Leiden', lat: 52.1601, lon: 4.497, radiusKm: 5 },
  amsterdam: { name: 'Amsterdam', lat: 52.3728, lon: 4.8936, radiusKm: 10 },
  utrecht: { name: 'Utrecht', lat: 52.0907, lon: 5.1214, radiusKm: 7 },
  rijswijk: { name: 'Rijswijk', lat: 52.0363, lon: 4.3251, radiusKm: 3 },
  zoetermeer: { name: 'Zoetermeer', lat: 52.0575, lon: 4.4931, radiusKm: 5 },
  schiedam: { name: 'Schiedam', lat: 51.9192, lon: 4.3886, radiusKm: 3 },
  vlaardingen: { name: 'Vlaardingen', lat: 51.9122, lon: 4.3419, radiusKm: 3 },
  'capelle aan den ijssel': { name: 'Capelle aan den IJssel', lat: 51.9292, lon: 4.5778, radiusKm: 3 },
  'leidschendam-voorburg': { name: 'Leidschendam-Voorburg', lat: 52.0833, lon: 4.3953, radiusKm: 4 },
  'pijnacker-nootdorp': { name: 'Pijnacker-Nootdorp', lat: 52.0197, lon: 4.4292, radiusKm: 4 },
  westland: { name: 'Westland', lat: 51.9967, lon: 4.2092, radiusKm: 8 },
  haarlem: { name: 'Haarlem', lat: 52.3874, lon: 4.6462, radiusKm: 5 },
  amstelveen: { name: 'Amstelveen', lat: 52.3114, lon: 4.8701, radiusKm: 4 },
  eindhoven: { name: 'Eindhoven', lat: 51.4416, lon: 5.4697, radiusKm: 7 },
  groningen: { name: 'Groningen', lat: 53.2194, lon: 6.5665, radiusKm: 7 },
  nijmegen: { name: 'Nijmegen', lat: 51.8126, lon: 5.8372, radiusKm: 6 },
  tilburg: { name: 'Tilburg', lat: 51.5555, lon: 5.0913, radiusKm: 6 },
  breda: { name: 'Breda', lat: 51.5719, lon: 4.7683, radiusKm: 6 },
  arnhem: { name: 'Arnhem', lat: 51.9851, lon: 5.8987, radiusKm: 6 },
  enschede: { name: 'Enschede', lat: 52.2215, lon: 6.8937, radiusKm: 6 },
  maastricht: { name: 'Maastricht', lat: 50.8514, lon: 5.691, radiusKm: 5 },
  zwolle: { name: 'Zwolle', lat: 52.5168, lon: 6.083, radiusKm: 5 },
  'den bosch': { name: "'s-Hertogenbosch", lat: 51.6978, lon: 5.3037, radiusKm: 5 },
  amersfoort: { name: 'Amersfoort', lat: 52.1561, lon: 5.3878, radiusKm: 5 },
  almere: { name: 'Almere', lat: 52.3508, lon: 5.2647, radiusKm: 8 },
  dordrecht: { name: 'Dordrecht', lat: 51.8133, lon: 4.6901, radiusKm: 5 },
  gouda: { name: 'Gouda', lat: 52.0115, lon: 4.7105, radiusKm: 3 },
  wageningen: { name: 'Wageningen', lat: 51.9692, lon: 5.6654, radiusKm: 3 },
};

const resolved = new Map<string, Promise<Place | undefined>>();

/**
 * A place for a municipality: from the table, or else from the PDOK
 * Locatieserver (free, no key), cached for the life of the process. The
 * lookup asks for a postcode in the municipality, which gives both a
 * centre and a postcode for platforms that search by postcode.
 */
export function resolvePlace(municipality: string, ctx: SourceContext): Promise<Place | undefined> {
  const key = canonicalMunicipality(municipality);
  const known = PLACES[key];
  if (known?.postcode) return Promise.resolve(known);
  let pending = resolved.get(key);
  if (!pending) {
    const q = encodeURIComponent(known?.name ?? titleCase(key));
    const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${q}&fq=type:postcode&rows=1&fl=postcode,centroide_ll,woonplaatsnaam`;
    pending = ctx
      .fetch(url, { headers: { accept: 'application/json' } })
      .then((res) => {
        const doc = res.json<{ response?: { docs?: { postcode?: string; centroide_ll?: string }[] } }>().response?.docs?.[0];
        const point = /POINT\(([\d.]+) ([\d.]+)\)/.exec(doc?.centroide_ll ?? '');
        const lon = num(point?.[1]);
        const lat = num(point?.[2]);
        if (!doc?.postcode && !known) return undefined;
        return {
          name: known?.name ?? titleCase(key),
          lat: known?.lat ?? lat ?? 0,
          lon: known?.lon ?? lon ?? 0,
          postcode: doc?.postcode?.replace(/\s+/g, '').toUpperCase(),
          radiusKm: known?.radiusKm ?? 5,
        } satisfies Place;
      })
      .catch((e: unknown) => {
        resolved.delete(key);
        ctx.log.warn('could not look up a place', { municipality: key, error: (e as Error).message });
        return known;
      });
    resolved.set(key, pending);
  }
  return pending;
}

/* ---------- alert emails ---------- */

const REDIRECT_PARAMS = ['u', 'url', 'target', 'redirect', 'redirect_url', 'dest', 'destination', 'link', 'l', 'to'];

/** Follows click-tracking wrappers ("https://click.mail.funda.nl/?u=https%3A...") to the real URL. */
export function unwrapUrl(href: string): URL | undefined {
  let u: URL;
  try {
    u = new URL(href.trim());
  } catch {
    return undefined;
  }
  for (let hop = 0; hop < 3; hop++) {
    const inner = REDIRECT_PARAMS.map((p) => u.searchParams.get(p)).find((v) => v && /^https?:\/\//i.test(v));
    if (!inner) break;
    try {
      u = new URL(inner);
    } catch {
      break;
    }
  }
  return u.protocol === 'http:' || u.protocol === 'https:' ? u : undefined;
}

/** True when the sender's domain is `domain` or a subdomain of it. */
export function senderIs(mail: InboundMessage, domains: string[]): boolean {
  const host = mail.from.address?.split('@')[1]?.toLowerCase() ?? '';
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export interface AlertCard {
  /** What `match` returned for the card's links: the listing's id. */
  id: string;
  url: URL;
  /** The link text that names the listing (the longest one). */
  title: string;
  /** All text of the card, one line per block element. */
  lines: string[];
  image?: string;
}

function blockLines($: CheerioAPI, el: Cheerio<AnyNode>): string[] {
  const copy = el.clone();
  copy.find('script, style').remove();
  copy.find('br').replaceWith('\n');
  copy.find('p, div, li, tr, td, h1, h2, h3, h4, h5, h6, table').each((_, n) => {
    $(n).append('\n');
  });
  return copy
    .text()
    .split('\n')
    .map(clean)
    .filter(Boolean);
}

/**
 * Listing cards in an alert email. Every link whose unwrapped URL `match`
 * recognises belongs to that listing; the card is the largest element around
 * those links that holds no other listing's links. Plain-text mails are split
 * into blocks at blank lines instead.
 */
export function alertCards(mail: InboundMessage, match: (url: URL) => string | undefined): AlertCard[] {
  const cards = new Map<string, AlertCard>();
  if (mail.html) {
    const $ = load(mail.html);
    const byId = new Map<string, { url: URL; anchors: AnyNode[] }>();
    $('a[href]').each((_, a) => {
      const url = unwrapUrl($(a).attr('href') ?? '');
      const id = url ? match(url) : undefined;
      if (!url || !id) return;
      const entry = byId.get(id) ?? { url, anchors: [] };
      entry.anchors.push(a);
      byId.set(id, entry);
    });
    const owner = new Map<AnyNode, string>();
    for (const [id, { anchors }] of byId) for (const a of anchors) owner.set(a, id);
    const others = (el: Cheerio<AnyNode>, id: string) =>
      el.find('a[href]').toArray().some((a) => {
        const o = owner.get(a);
        return o !== undefined && o !== id;
      });
    for (const [id, { url, anchors }] of byId) {
      let box = $(anchors[0] as AnyNode);
      for (;;) {
        const parent = box.parent();
        if (!parent.length || parent.is('body, html') || others(parent, id)) break;
        box = parent;
      }
      const title = anchors
        .map((a) => clean($(a).text()))
        .filter(Boolean)
        .sort((x, y) => y.length - x.length)[0];
      const image = box.find('img[src]').first().attr('src');
      cards.set(id, compact({ id, url, title: title ?? '', lines: blockLines($, box), image }));
    }
    if (cards.size) return [...cards.values()];
  }
  for (const block of (mail.text ?? '').split(/\n\s*\n/)) {
    for (const m of block.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
      const url = unwrapUrl(m[0]);
      const id = url ? match(url) : undefined;
      if (!url || !id || cards.has(id)) continue;
      const lines = block
        .split('\n')
        .map((l) => clean(l.replace(/https?:\/\/\S+/g, '')))
        .filter(Boolean);
      cards.set(id, { id, url, title: lines[0] ?? '', lines });
    }
  }
  return [...cards.values()];
}

/* ---------- browser steps ---------- */

const VISIBLE_CAPTCHA =
  'iframe[src*="recaptcha"]:not([src*="size=invisible"]), iframe[src*="hcaptcha.com"], .cf-turnstile, iframe[src*="challenges.cloudflare.com"], iframe[src*="captcha-delivery.com"]';

/** True when the page shows a captcha a person has to solve. */
export async function showsCaptcha(page: Page): Promise<boolean> {
  return page
    .locator(VISIBLE_CAPTCHA)
    .first()
    .isVisible()
    .catch(() => false);
}

/** The first of several selectors that is visible right now, or undefined. */
export async function firstVisible(page: Page, selectors: string[]): Promise<string | undefined> {
  for (const s of selectors) {
    if (
      await page
        .locator(s)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return s;
  }
  return undefined;
}

/** Visible text of the page body, whitespace collapsed; empty when the page has none. */
export async function pageText(page: Page): Promise<string> {
  return clean(await page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''));
}

/**
 * Waits until the page shows text matching `success` (or a URL matching
 * `successUrl`) and returns that text. When `failure` returns a message
 * first (a validation error under a field, say), that message comes back
 * with `failed: true`. Undefined after `timeoutMs`.
 */
export async function waitForConfirmation(
  page: Page,
  opts: { success: RegExp; successUrl?: RegExp; timeoutMs: number; failure?: () => Promise<string | undefined> },
): Promise<{ text: string; failed?: true } | undefined> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (opts.successUrl?.test(page.url())) return { text: `confirmation page ${new URL(page.url()).pathname}` };
    const text = await pageText(page);
    const m = opts.success.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 60);
      return { text: text.slice(start, m.index + m[0].length + 100).trim() };
    }
    const failed = await opts.failure?.();
    if (failed) return { text: failed, failed: true };
    await page.waitForTimeout(250).catch(() => undefined);
  }
  return undefined;
}

/** First line of an error message, for ContactResult.error. */
export const firstLine = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0] ?? '';

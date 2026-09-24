import { createHash } from 'node:crypto';
import { load, type CheerioAPI } from 'cheerio';
import { fromAmsterdam, type NamedSearch, type RawListing, type SearchRequest, type SourceAdapter, type SourceConfig } from '@nlpf/core';
import { UNAVAILABLE_STATUS } from '../generic/presets.js';
import { SourceHttpError } from '../runtime/errors.js';
import { detectFurnishing, detectType, parseBedrooms, parseDutchDate, parsePrice, parseRooms, parseSize } from '../util/parse.js';

/*
 * 123Wonen: a franchise of rental agents with branches across the country.
 * City pages /huurwoningen/in/<city>/sort/newest are server-rendered cards
 * (VERIFIED 2026-09-24); rented cards carry the class "verhuurd". A price in
 * the URL (?addspec=priceend/-/1400) is ignored on a page load (VERIFIED),
 * so only the city is sent. The information form on a listing has
 * reCAPTCHA Enterprise and asks for the applicant's home address, which the
 * profile does not have, so the agent is contacted by email at the branch
 * named on the listing page (detail() fills it in).
 */

const BASE = 'https://www.123wonen.nl';

/**
 * Municipalities around the branches (the /huurwoningen/van/<branch> links on
 * the site). A regional source is only polled when a search names one.
 */
const REGIONS = [
  'alkmaar', 'almere', 'amersfoort', 'amstelveen', 'amsterdam', 'apeldoorn', 'arnhem', 'assen', 'bergen op zoom', 'breda', 'capelle aan den ijssel',
  'delft', 'den bosch', "'s-hertogenbosch", 'den haag', "'s-gravenhage", 'deventer', 'dordrecht', 'eindhoven', 'emmen', 'enschede', 'etten-leur',
  'gouda', 'groningen', 'haarlem', 'haarlemmermeer', 'heerlen', 'hengelo', 'hilversum', 'leeuwarden', 'leiden', 'leidschendam-voorburg', 'lelystad',
  'maastricht', 'middelburg', 'nieuwegein', 'nijmegen', 'rijswijk', 'roermond', 'roosendaal', 'rotterdam', 'schiedam', 'tilburg', 'utrecht',
  'venlo', 'vlaardingen', 'vlissingen', 'woerden', 'zaanstad', 'zoetermeer', 'zwolle',
];

const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

function slug(city: string): string {
  const s = city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === 's-gravenhage' ? 'den-haag' : s === 's-hertogenbosch' ? 'den-bosch' : s;
}

/** Municipalities of the enabled searches this agent covers; null when a search covers the whole country. */
function coveredCities(searches: NamedSearch[]): string[] | null {
  const all = new Set<string>();
  for (const s of searches) {
    if (s.enabled === false) continue;
    if (s.regions.length === 0) return null;
    for (const r of s.regions) {
      if (r.municipalities.length === 0) return null;
      for (const m of r.municipalities) if (m.trim()) all.add(m.trim());
    }
  }
  const covered = [...all].filter((m) => REGIONS.includes(m.toLowerCase()));
  // Turned on by hand for other places: try them all.
  return covered.length ? covered : [...all];
}

function extraUrls(source: SourceConfig): SearchRequest[] {
  return source.searchUrls.map((url) => ({
    key: `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
    label: `123Wonen: ${url}`,
    url,
  }));
}

/** Label and value pairs of a spec list: `<li><span>Type</span><span>Appartement</span></li>`. */
function specs($: CheerioAPI, scope: ReturnType<CheerioAPI>): Map<string, string> {
  const out = new Map<string, string>();
  scope.find('.pand-specs li').each((_, li) => {
    const spans = $(li).children('span');
    const key = clean(spans.first().text()).toLowerCase();
    if (key && spans.length > 1 && !out.has(key)) out.set(key, clean(spans.eq(1).text()));
  });
  return out;
}

function dayStart(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split('-').map(Number);
  return fromAmsterdam(y ?? 0, m ?? 1, d ?? 1, 0, 0).toISOString();
}

/** Reads the cards of a /huurwoningen/in/<city> page. */
export function parseWonen123List(html: string, now: Date = new Date()): RawListing[] {
  const $ = load(html);
  const out: RawListing[] = [];
  $('.pandlist-container').each((_, el) => {
    const card = $(el);
    const status = clean(card.find('.pand-status').text()).toLowerCase();
    if (card.hasClass('verhuurd') || UNAVAILABLE_STATUS.some((w) => status.includes(w))) return;
    const href = card.find('a.textlink-design').attr('href') ?? /location\.href='([^']+)'/.exec(card.attr('onclick') ?? '')?.[1];
    if (!href) return;
    const url = new URL(href, BASE).toString();
    const street = clean(card.find('.pand-address').text());
    const city = clean(card.find('.pand-title').clone().children().remove().end().text()).replace(/,\s*$/, '');
    const s = specs($, card);
    const price = parsePrice(clean(card.find('.pand-price').text()));
    const image = card.find('.pand-image').attr('data-src');
    const kind = s.get('type') ?? new URL(url).pathname.split('/')[3] ?? '';
    const furnishing = detectFurnishing(s.get('interieur') ?? '');
    const available = s.get('beschikbaarheid');
    const label = s.get('energielabel');
    const listing: RawListing = {
      sourceId: 'wonen123',
      externalId: /-(\d+-\d+)$/.exec(new URL(url).pathname)?.[1] ?? new URL(url).pathname,
      url,
      title: [street, city].filter(Boolean).join(', ') || url,
      priceEur: price.priceEur,
      priceBasis: price.priceEur !== undefined ? price.basis : undefined,
      sizeM2: parseSize(s.get('woonoppervlakte') ?? ''),
      bedrooms: parseBedrooms(s.get('slaapkamers') ?? ''),
      type: detectType(kind),
      furnishing: furnishing === 'unknown' ? undefined : furnishing,
      address: { ...(street ? { street } : {}), ...(city ? { city } : {}) },
      availableFrom: available ? parseDutchDate(available, now) : undefined,
      description: clean(card.find('.pand-slogan').text()) || undefined,
      images: image ? [new URL(image, BASE).toString()] : undefined,
      energyLabel: label && /^[A-G]\+*$/i.test(label) ? label.toUpperCase() : undefined,
      publishedAt: dayStart(parseDutchDate(s.get('aangeboden sinds') ?? '', now)),
      agent: { name: '123Wonen', url: BASE },
      contact: 'email',
      language: 'nl',
    };
    for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
    out.push(listing);
  });
  return out;
}

/** Adds the branch contact block, the room count, the description and furnishing from a listing page. */
export function parseWonen123Detail(listing: RawListing, html: string, now: Date = new Date()): RawListing {
  const $ = load(html);
  const out: RawListing = { ...listing, address: { ...listing.address } };
  const contact = $('.pandetail-contact').first();
  const branch = clean(contact.find('b').first().text());
  const contactText = clean(contact.text());
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(contactText)?.[0];
  const phone = /\bT\s+(\+?[\d][\d\s-]{7,}\d)/.exec(contactText)?.[1]?.trim();
  out.agent = { ...out.agent, ...(branch ? { name: branch } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
  const s = specs($, $.root());
  const rooms = parseRooms(s.get('kamers') ?? '');
  if (rooms !== undefined) out.rooms = rooms;
  const size = parseSize(s.get('woonoppervlakte') ?? '');
  if (size !== undefined) out.sizeM2 ??= size;
  const available = s.get('beschikbaarheid');
  const date = available ? parseDutchDate(available, now) : undefined;
  if (date) out.availableFrom = date;
  const desc = $('.panddetail-desc').first().clone();
  desc.find('h2, a, script').remove();
  desc.find('br').replaceWith('\n');
  const description = desc
    .text()
    .split('\n')
    .map((l) => clean(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (description) out.description = description;
  if (!out.furnishing && description) {
    const f = detectFurnishing(description);
    if (f !== 'unknown') out.furnishing = f;
  }
  return out;
}

export function createWonen123Adapter(): SourceAdapter {
  return {
    id: 'wonen123',
    name: '123Wonen',
    homepage: BASE,
    regions: REGIONS,
    defaultIntervalSec: 600,
    capabilities: { search: 'html', detail: true, contact: 'email', login: 'none', terms: 'unknown' },

    buildSearches(searches, source) {
      const cities = coveredCities(searches);
      const reqs: SearchRequest[] =
        cities === null
          ? [{ key: 'nl', label: '123Wonen: alle huurwoningen', url: `${BASE}/huurwoningen` }]
          : [...new Map(cities.map((c) => [slug(c), c])).entries()].map(([s, city]) => ({
              key: s,
              label: `123Wonen: ${city}`,
              url: `${BASE}/huurwoningen/in/${s}/sort/newest`,
            }));
      return [...reqs, ...extraUrls(source)];
    },

    async search(req, ctx) {
      const res = await ctx.fetch(req.url ?? `${BASE}/huurwoningen`);
      return parseWonen123List(res.text, ctx.now());
    },

    async detail(listing, ctx) {
      const res = await ctx.fetch(listing.url);
      return parseWonen123Detail(listing, res.text, ctx.now());
    },

    async isAvailable(listing, ctx) {
      try {
        const res = await ctx.fetch(listing.url);
        if (new URL(res.url || listing.url).pathname !== new URL(listing.url).pathname) return false;
        const $ = load(res.text);
        return !/verhuurd|onder optie/i.test(clean($('.pand-status, .panddetail-status').text()));
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },
  };
}

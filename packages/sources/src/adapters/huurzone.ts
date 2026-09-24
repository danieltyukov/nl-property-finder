import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { NamedSearch, RawListing, SearchRequest, SourceAdapter, SourceConfig } from '@nlpf/core';
import { UNAVAILABLE_STATUS } from '../generic/presets.js';
import { SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode } from '../util/address.js';
import { detectFurnishing, detectType, parseBedrooms, parsePrice, parseRooms, parseSize } from '../util/parse.js';

/*
 * Huurzone: a paid re-aggregator (Premium EUR 29/month, REPORTED). City
 * pages take sort_by=created_at.desc and price_to=<step> as GET parameters
 * and filter on the server (VERIFIED 2026-09-24). Cards show the type, city,
 * price, size and rooms but no street; the detail page adds the postcode,
 * deposit and furnishing, and keeps the street for Premium members. Ingest
 * only, for dedupe and the paywall router.
 */

const BASE = 'https://www.huurzone.nl';
/** The steps of the site's price_to select; above the last one there is no ceiling. */
const PRICE_STEPS = [300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900];

const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

function slug(city: string): string {
  const s = city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === 's-gravenhage' ? 'den-haag' : s;
}

function searchCities(searches: NamedSearch[]): string[] | null {
  const out = new Set<string>();
  for (const s of searches) {
    if (s.enabled === false) continue;
    if (s.regions.length === 0) return null;
    for (const r of s.regions) {
      if (r.municipalities.length === 0) return null;
      for (const m of r.municipalities) if (m.trim()) out.add(m.trim());
    }
  }
  return [...out];
}

function maxPrice(searches: NamedSearch[]): number | undefined {
  let max = 0;
  for (const s of searches) {
    if (s.enabled === false) continue;
    if (s.priceMaxEur === undefined) return undefined;
    max = Math.max(max, s.priceMaxEur);
  }
  return max > 0 ? max : undefined;
}

function extraUrls(source: SourceConfig): SearchRequest[] {
  return source.searchUrls.map((url) => ({
    key: `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
    label: `Huurzone: ${url}`,
    url,
  }));
}

/** Reads the result cards of a /huurwoningen/<city> page. */
export function parseHuurzoneList(html: string, pageUrl: string): RawListing[] {
  const $ = load(html);
  const out: RawListing[] = [];
  $('a[data-rental-card]').each((_, el) => {
    const card = $(el);
    const href = card.attr('href');
    if (!href) return;
    const url = new URL(href, pageUrl).toString();
    const text = clean(card.text()).toLowerCase();
    if (UNAVAILABLE_STATUS.some((w) => text.includes(w))) return;
    const title = clean(card.find('h2').first().text());
    const city = clean(card.find('p').first().text()).split(',')[0]?.trim();
    const facts = card
      .find('span.whitespace-nowrap')
      .toArray()
      .map((s) => clean($(s).text()));
    const price = parsePrice(clean(card.find('.items-baseline').first().text()));
    const image = card.find('img').attr('src');
    const listing: RawListing = {
      sourceId: 'huurzone',
      externalId: new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url,
      url,
      title: title || url,
      priceEur: price.priceEur,
      priceBasis: price.priceEur !== undefined ? price.basis : undefined,
      sizeM2: parseSize(facts.find((f) => /m\s*2|m²/i.test(f)) ?? ''),
      rooms: parseRooms(facts.find((f) => /^\d{1,2}$/.test(f)) ?? '') ?? parseRooms(title),
      type: detectType(title),
      address: city ? { city } : {},
      images: image && !/placeholder/.test(image) ? [image] : undefined,
      agent: { name: 'Huurzone', url: BASE },
      contact: 'none',
      language: 'nl',
    };
    for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
    out.push(listing);
  });
  return out;
}

/** Adds what the free detail page shows: postcode, deposit, furnishing, bedrooms and the listing date. */
export function parseHuurzoneDetail(listing: RawListing, html: string): RawListing {
  const $ = load(html);
  const out: RawListing = { ...listing, address: { ...listing.address } };
  const facts = new Map<string, string>();
  $('dl').each((_, dl) => {
    const key = clean($(dl).find('dt').first().text()).toLowerCase();
    if (key) facts.set(key, clean($(dl).find('dd').first().text()));
  });
  const postcode = normalisePostcode(facts.get('postcode') ?? '');
  if (postcode) out.address.postcode = postcode;
  const place = facts.get('woonplaats');
  if (place) out.address.city = place;
  const deposit = parsePrice(facts.get('borg') ?? '').priceEur;
  if (deposit !== undefined) out.depositEur = deposit;
  const furnishing = detectFurnishing(facts.get('interieur') ?? '');
  if (furnishing !== 'unknown') out.furnishing = furnishing;
  const bedrooms = parseBedrooms(facts.get('slaapkamers') ?? '');
  if (bedrooms !== undefined) out.bedrooms = bedrooms;
  const rooms = parseRooms(facts.get('kamers') ?? '');
  if (rooms !== undefined) out.rooms ??= rooms;
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const d = JSON.parse($(s).text()) as { '@graph'?: Record<string, unknown>[] };
      for (const node of d['@graph'] ?? [d as Record<string, unknown>]) {
        if (node['@type'] === 'RealEstateListing') {
          const posted = Date.parse(String(node.datePosted ?? ''));
          if (!Number.isNaN(posted)) out.publishedAt = new Date(posted).toISOString();
          if (typeof node.description === 'string' && node.description.trim()) out.description = node.description.trim();
        }
      }
    } catch {
      // not ours
    }
  });
  return out;
}

export function createHuurzoneAdapter(): SourceAdapter {
  return {
    id: 'huurzone',
    name: 'Huurzone',
    homepage: BASE,
    regions: 'nl',
    defaultIntervalSec: 900,
    capabilities: {
      search: 'html',
      detail: true,
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'huurzone-premium' },
      terms: 'unknown',
    },

    buildSearches(searches, source) {
      const cities = searchCities(searches);
      const max = maxPrice(searches);
      const step = max === undefined ? undefined : PRICE_STEPS.find((p) => p >= max);
      const url = (path: string) => {
        const q = new URLSearchParams({ sort_by: 'created_at.desc' });
        if (step !== undefined) q.set('price_to', String(step));
        return `${BASE}/huurwoningen/${path}?${q}`;
      };
      const reqs: SearchRequest[] =
        cities === null
          ? [{ key: 'heel-nederland', label: 'Huurzone: heel Nederland', url: url('heel-nederland') }]
          : [...new Map(cities.map((c) => [slug(c), c])).entries()].map(([s, city]) => ({ key: s, label: `Huurzone: ${city}`, url: url(s) }));
      return [...reqs, ...extraUrls(source)];
    },

    async search(req, ctx) {
      const url = req.url ?? `${BASE}/huurwoningen/heel-nederland?sort_by=created_at.desc`;
      const res = await ctx.fetch(url);
      return parseHuurzoneList(res.text, res.url || url);
    },

    async detail(listing, ctx) {
      const res = await ctx.fetch(listing.url);
      return parseHuurzoneDetail(listing, res.text);
    },

    async isAvailable(listing, ctx) {
      try {
        const res = await ctx.fetch(listing.url);
        const status = /Status\s*<\/span>\s*<div[^>]*>\s*<span[^>]*>\s*([^<]+)/i.exec(res.text)?.[1] ?? '';
        return !UNAVAILABLE_STATUS.some((w) => status.toLowerCase().includes(w));
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },
  };
}

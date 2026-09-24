import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { NamedSearch, RawListing, SearchRequest, SourceAdapter, SourceConfig } from '@nlpf/core';
import { UNAVAILABLE_STATUS } from '../generic/presets.js';
import { SourceHttpError } from '../runtime/errors.js';
import { splitAddress } from '../util/address.js';
import { detectFurnishing, detectType, parseDutchDate, parsePrice, parseRooms, parseSize } from '../util/parse.js';

/*
 * NederWoon: a rental agent with offices across the country. /search?city=
 * lists server-rendered results with a map (VERIFIED 2026-09-24); the city is
 * required ("U dient een plaatsnaam op te geven" without one) and there is
 * no price filter. search_type=1 is homes and 3 is rooms. Planning a viewing
 * (/sighting) redirects to /login (VERIFIED), and the account is paid per
 * region (REPORTED), so listings are ingested and routed to a person.
 */

const BASE = 'https://www.nederwoon.nl';

/** Towns with NederWoon offices or regular listings; not checked one by one. */
const REGIONS = [
  'almere', 'amersfoort', 'amsterdam', 'apeldoorn', 'arnhem', 'breda', 'delft', 'den bosch', "'s-hertogenbosch", 'den haag', "'s-gravenhage",
  'deventer', 'ede', 'eindhoven', 'enschede', 'groningen', 'haarlem', 'houten', 'leeuwarden', 'leiden', 'maastricht', 'nieuwegein', 'nijmegen',
  'rotterdam', 'tilburg', 'utrecht', 'veenendaal', 'wageningen', 'zeist', 'zwolle',
];

const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

function coveredCities(searches: NamedSearch[]): string[] {
  const all = new Set<string>();
  for (const s of searches) {
    if (s.enabled === false) continue;
    for (const r of s.regions) for (const m of r.municipalities) if (m.trim()) all.add(m.trim());
  }
  const covered = [...all].filter((m) => REGIONS.includes(m.toLowerCase()));
  return covered.length ? covered : [...all];
}

const wantsRooms = (searches: NamedSearch[]) => searches.some((s) => s.enabled !== false && s.types.includes('room'));

function extraUrls(source: SourceConfig): SearchRequest[] {
  return source.searchUrls.map((url) => ({
    key: `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
    label: `NederWoon: ${url}`,
    url,
  }));
}

/** Coordinates by listing id from the page's `var mapData = { locations: [{ id, lat, lon }] }`. */
function coordinates(html: string): Map<string, { lat: number; lon: number }> {
  const out = new Map<string, { lat: number; lon: number }>();
  for (const m of html.matchAll(/\{\s*id:\s*(\d+),\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)/g)) {
    out.set(m[1] ?? '', { lat: Number(m[2]), lon: Number(m[3]) });
  }
  return out;
}

/** Reads the results of a /search page. */
export function parseNederwoonList(html: string, now: Date = new Date()): RawListing[] {
  const $ = load(html);
  const coords = coordinates(html);
  const out: RawListing[] = [];
  $('#locations .location[data-marker-id]').each((_, el) => {
    const card = $(el);
    const id = card.attr('data-marker-id') ?? '';
    const link = card.find('a.see-page-button').first();
    const href = link.attr('href');
    if (!href) return;
    const text = clean(card.text()).toLowerCase();
    if (UNAVAILABLE_STATUS.some((w) => text.includes(w))) return;
    const url = new URL(href, BASE).toString();
    const street = clean(link.text());
    const place = splitAddress(clean(card.find('h2 + p').first().text()));
    const kind = clean(card.find('p.color-primary').first().text()).split('|')[0]?.trim() ?? '';
    const facts = card
      .find('ul li')
      .toArray()
      .map((li) => clean($(li).text()));
    const price = parsePrice(`${clean(card.find('.item-start p').first().text())} ${clean(card.find('.item-start p').eq(1).text())}`);
    const furnishing = detectFurnishing(facts.find((f) => /oplevering/i.test(f)) ?? '');
    const available = facts.find((f) => /beschikbaar/i.test(f));
    const views = /door\s+(\d+)\s+personen bekeken/i.exec(card.text())?.[1];
    const image = card.find('img[data-src]').first().attr('data-src');
    const address: RawListing['address'] = { ...(street ? { street } : {}), ...place };
    const point = coords.get(id);
    if (point) Object.assign(address, point);
    const listing: RawListing = {
      sourceId: 'nederwoon',
      externalId: id || (/\/(\d+)\//.exec(new URL(url).pathname)?.[1] ?? url),
      url,
      title: [street, place.city].filter(Boolean).join(', ') || url,
      priceEur: price.priceEur,
      // "Kale huur" is the bare rent.
      priceBasis: price.priceEur !== undefined ? (/kale huur/i.test(card.text()) ? 'excl' : price.basis) : undefined,
      sizeM2: parseSize(facts.find((f) => /m²|m2/i.test(f)) ?? ''),
      rooms: parseRooms(facts.find((f) => /kamer/i.test(f)) ?? ''),
      type: detectType(kind),
      furnishing: furnishing === 'unknown' ? undefined : furnishing,
      address,
      availableFrom: available ? parseDutchDate(available, now) : undefined,
      images: image ? [new URL(image, BASE).toString()] : undefined,
      agent: { name: 'NederWoon', url: BASE },
      contact: 'none',
      language: 'nl',
      extra: views ? { views: Number(views) } : undefined,
    };
    for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
    out.push(listing);
  });
  return out;
}

export function createNederwoonAdapter(): SourceAdapter {
  return {
    id: 'nederwoon',
    name: 'NederWoon',
    homepage: BASE,
    regions: REGIONS,
    defaultIntervalSec: 900,
    capabilities: {
      search: 'html',
      detail: false,
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'nederwoon-account' },
      terms: 'unknown',
    },

    buildSearches(searches, source) {
      const kinds = wantsRooms(searches) ? ['1', '3'] : ['1'];
      const reqs: SearchRequest[] = [];
      for (const city of new Map(coveredCities(searches).map((c) => [c.toLowerCase(), c])).values()) {
        for (const kind of kinds) {
          const q = new URLSearchParams({ search_type: kind, city, sort: '1' });
          reqs.push({ key: `${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${kind}`, label: `NederWoon: ${city}`, url: `${BASE}/search?${q}` });
        }
      }
      return [...reqs, ...extraUrls(source)];
    },

    async search(req, ctx) {
      if (!req.url) return [];
      const res = await ctx.fetch(req.url);
      return parseNederwoonList(res.text, ctx.now());
    },

    async isAvailable(listing, ctx) {
      try {
        const res = await ctx.fetch(listing.url);
        return new URL(res.url || listing.url).pathname === new URL(listing.url).pathname;
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
    },
  };
}

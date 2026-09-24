import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { Address, NamedSearch, PropertyType, RawListing, SearchRequest, SourceAdapter, SourceConfig } from '@nlpf/core';
import { SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode, splitAddress } from '../util/address.js';
import { detectType } from '../util/parse.js';

/*
 * Rentola: a paid re-aggregator (photos come from Pararius, Funda and
 * Kamernet). /huren?location=<City>&rent=0-<max> is filtered on the server
 * and its JSON-LD SearchResultsPage lists every result with a full postal
 * address, price, size and the date it was listed (VERIFIED 2026-09-24).
 * The postal address is geocoded and sometimes points at a neighbour
 * ("Delflandplein 522" for a listing named "Delflandplein 442"), so a house
 * number in the listing's own name wins and the geocoded postcode is then
 * dropped. Ingest only.
 */

const BASE = 'https://rentola.nl';

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
  return max > 0 ? Math.ceil(max) : undefined;
}

function extraUrls(source: SourceConfig): SearchRequest[] {
  return source.searchUrls.map((url) => ({
    key: `url-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`,
    label: `Rentola: ${url}`,
    url,
  }));
}

const keyOf = (city: string) =>
  city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

interface LdOffer {
  price?: number | string;
  availability?: string;
  validFrom?: string;
  itemOffered?: {
    '@type'?: string;
    address?: { streetAddress?: string; addressLocality?: string };
    geo?: { latitude?: number; longitude?: number };
    floorSize?: { value?: number };
    numberOfBedrooms?: { value?: number };
    numberOfRooms?: { value?: number } | number;
  };
}
interface LdListing {
  url?: string;
  name?: string;
  image?: string | string[];
  offers?: LdOffer;
}

const LD_TYPES: Record<string, PropertyType> = {
  Room: 'room',
  Apartment: 'apartment',
  House: 'house',
  SingleFamilyResidence: 'house',
  Residence: 'apartment',
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Number and addition from the text after a house number: "B 03" is "B-03", "E" is "E". */
function additionOf(raw: string | undefined): string | undefined {
  const t = (raw ?? '').trim().replace(/^[-\s]+/, '');
  if (!t) return undefined;
  const parts = t.split(/[\s-]+/).filter(Boolean);
  return parts.map((p) => (/^\p{L}+$/u.test(p) ? p.toUpperCase() : p)).join('-');
}

/** The geocoded "In de Hoven, Delflandplein 522, 2624 GD Delft, Netherlands" as an Address. */
function geocoded(streetAddress: string, locality: string | undefined): Address {
  const text = streetAddress.replace(/,\s*(Netherlands|Nederland)\s*$/i, '');
  const a = splitAddress(text);
  if (a.street && (/unnamed road/i.test(a.street) || a.street.toLowerCase() === (locality ?? a.city ?? '').toLowerCase())) delete a.street;
  if (!a.street) {
    delete a.houseNumber;
    delete a.addition;
  } else if (a.houseNumber && !a.addition) {
    // splitAddress leaves out additions like "B-03" and "M-10".
    const seg = text.split(',').find((s) => new RegExp(`\\b${escape(a.houseNumber!)}`).test(s) && s.includes(a.street!));
    const tail = seg ? new RegExp(`\\s${escape(a.houseNumber)}\\s*([^,\\s][^,]*)?$`).exec(seg.trim())?.[1] : undefined;
    const addition = additionOf(tail);
    if (addition) a.addition = addition;
  }
  if (locality) a.city = locality;
  return a;
}

const NAME_PREFIX = /^(?:[A-Z][A-Za-z]+\s*-\s*)?(?:te huur:?\s*)?(?:appartement|studio|kamer|woning|huis|apartment|room|house)?\s*(?:at\s+)?/i;

/** A street and house number written in the listing's name, if there is one. */
function fromName(name: string, street: string | undefined): { street?: string; houseNumber?: string; addition?: string; postcode?: string } {
  const postcode = /\b([1-9]\d{3})\s?([A-Z]{2})\b/.exec(name);
  const pc = postcode ? normalisePostcode(`${postcode[1]}${postcode[2]}`) : undefined;
  if (street) {
    const m = new RegExp(`${escape(street)}\\s+(\\d{1,5})(?!\\d)((?:\\s*(?:[A-Za-z]{1,2}(?![A-Za-z])|\\d{1,3}(?!\\d)))*)`, 'i').exec(name);
    if (!m) return {};
    const tail = (m[2] ?? '').replace(/\s+in\s*$/i, '');
    return { street, houseNumber: m[1], addition: additionOf(tail), postcode: pc };
  }
  const stripped = name.replace(NAME_PREFIX, '').replace(/\s+in\s+[^,]+$/i, '');
  const a = splitAddress(stripped);
  return a.street && a.houseNumber ? { street: a.street, houseNumber: a.houseNumber, addition: a.addition, postcode: a.postcode ?? pc } : {};
}

function address(item: LdListing): Address {
  const offered = item.offers?.itemOffered;
  const locality = offered?.address?.addressLocality;
  const geo = geocoded(offered?.address?.streetAddress ?? '', locality);
  const named = fromName(item.name ?? '', geo.street);
  let out: Address = { ...geo };
  if (named.houseNumber) {
    if (named.houseNumber === geo.houseNumber) {
      if (!geo.addition && named.addition) out.addition = named.addition;
    } else {
      out = { street: named.street, houseNumber: named.houseNumber, addition: named.addition, postcode: named.postcode, city: locality ?? geo.city };
    }
  }
  if (!geo.street && !named.houseNumber) delete out.postcode;
  const lat = offered?.geo?.latitude;
  const lon = offered?.geo?.longitude;
  // Coordinates only describe the home when the address was not corrected.
  if (typeof lat === 'number' && typeof lon === 'number' && out.houseNumber === geo.houseNumber && out.street) Object.assign(out, { lat, lon });
  const ordered: Address = {};
  for (const k of ['street', 'houseNumber', 'addition', 'postcode', 'city', 'lat', 'lon'] as const) {
    if (out[k] !== undefined) Object.assign(ordered, { [k]: out[k] });
  }
  return ordered;
}

function titleOf(a: Address, fallback: string): string {
  if (!a.street) return fallback;
  const add = a.addition ? (/^\p{L}$/u.test(a.addition) ? a.addition : ` ${a.addition}`) : '';
  return `${a.street}${a.houseNumber ? ` ${a.houseNumber}${add}` : ''}${a.city ? `, ${a.city}` : ''}`;
}

/** Every RealEstateListing in the SearchResultsPage JSON-LD of a /huren page. */
export function parseRentolaPage(html: string): RawListing[] {
  const $ = load(html);
  const items: LdListing[] = [];
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const d = JSON.parse($(s).text()) as { '@type'?: string; mainEntity?: { itemListElement?: { item?: LdListing }[] } };
      if (d['@type'] !== 'SearchResultsPage') return;
      for (const el of d.mainEntity?.itemListElement ?? []) if (el.item) items.push(el.item);
    } catch {
      // other blocks are not ours
    }
  });
  const out: RawListing[] = [];
  for (const item of items) {
    if (!item.url) continue;
    const offer = item.offers ?? {};
    if (offer.availability && !/InStock/i.test(offer.availability)) continue;
    const url = new URL(item.url, BASE).toString();
    const slug = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url;
    const addr = address(item);
    const price = Number(offer.price);
    const offered = offer.itemOffered ?? {};
    const size = Number(offered.floorSize?.value);
    const bedrooms = Number(offered.numberOfBedrooms?.value);
    const listed = offer.validFrom ? Date.parse(offer.validFrom) : NaN;
    const image = Array.isArray(item.image) ? item.image[0] : item.image;
    const listing: RawListing = {
      sourceId: 'rentola',
      externalId: /-(p[0-9a-f]+)$/.exec(slug)?.[1] ?? slug,
      url,
      title: titleOf(addr, (item.name ?? url).trim().slice(0, 140)),
      priceEur: Number.isFinite(price) && price > 0 ? price : undefined,
      sizeM2: Number.isFinite(size) && size > 0 ? Math.round(size) : undefined,
      bedrooms: Number.isFinite(bedrooms) && bedrooms > 0 ? bedrooms : undefined,
      type: detectType(item.name ?? '') ?? LD_TYPES[offered['@type'] ?? ''],
      address: addr,
      images: image ? [image] : undefined,
      publishedAt: Number.isNaN(listed) ? undefined : new Date(listed).toISOString(),
      agent: { name: 'Rentola', url: BASE },
      contact: 'none',
      language: 'nl',
    };
    for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
    out.push(listing);
  }
  return out;
}

export function createRentolaAdapter(): SourceAdapter {
  return {
    id: 'rentola',
    name: 'Rentola',
    homepage: BASE,
    regions: 'nl',
    defaultIntervalSec: 900,
    capabilities: {
      search: 'html',
      detail: false,
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'rentola-premium' },
      terms: 'unknown',
    },

    buildSearches(searches, source) {
      const cities = searchCities(searches);
      const max = maxPrice(searches);
      const url = (city?: string) => {
        const q = new URLSearchParams();
        if (city) q.set('location', city);
        if (max !== undefined) q.set('rent', `0-${max}`);
        const qs = q.toString();
        return `${BASE}/huren${qs ? `?${qs}` : ''}`;
      };
      const reqs: SearchRequest[] =
        cities === null
          ? [{ key: 'nederland', label: 'Rentola: heel Nederland', url: url() }]
          : [...new Map(cities.map((c) => [keyOf(c), c])).entries()].map(([key, city]) => ({ key, label: `Rentola: ${city}`, url: url(city) }));
      return [...reqs, ...extraUrls(source)];
    },

    async search(req, ctx) {
      const res = await ctx.fetch(req.url ?? `${BASE}/huren`);
      return parseRentolaPage(res.text);
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

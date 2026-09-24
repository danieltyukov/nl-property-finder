import { load, type CheerioAPI } from 'cheerio';
import type { ContactResult, Listing, NamedSearch, OutboundMessage, PropertyType, RawListing, SearchRequest, SourceAdapter, SourceConfig, SourceContext } from '@nlpf/core';
import { trimTrailingSlashes } from '@nlpf/core';
import { SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode } from '../util/address.js';
import { detectFurnishing, parseDutchDate, parseRooms, parseSize } from '../util/parse.js';
import { areasFromSearches, citySlug, dedupeListings, loadPage, searchUrlRequests, withBrowserPage, type Area, type LoadedPage } from './pararius.js';

export interface KamerNlOptions {
  /** Site root, for tests against a local server. Default https://www.kamer.nl */
  baseUrl?: string;
  /** How long a page may take to get past a bot check. Default 30 s. */
  waitMs?: number;
}

/** Category path prefix per type: /huren/kamer-delft/, /huren/studio-delft/, /huren/appartement-delft/, /huren/huurwoning-delft/ (links recorded 2026-09-24). */
const CATEGORY: Record<Exclude<PropertyType, 'other'>, string> = { room: 'kamer', studio: 'studio', apartment: 'appartement', house: 'huurwoning' };
const TYPE_OF: Record<string, PropertyType> = { kamer: 'room', studio: 'studio', appartement: 'apartment', huurwoning: 'house' };

/**
 * `/huren/{category}-{city}/?sort=-created`, newest first ("Datum" in the
 * sort menu, recorded). The price bounds use the names of the filter form's
 * inputs, `min_price` and `max_price`; UNVERIFIED that the page applies them
 * from the query string (it filters its other facets that way, such as
 * `?rooms=2`). A superset is harmless: the agent filters again.
 */
export function kamerNlSearchUrl(base: string, category: string, area: Area): string {
  const u = new URL(`${base}/huren/${category}-${area.slug}/`);
  u.searchParams.set('sort', '-created');
  if (area.minPrice !== undefined) u.searchParams.set('min_price', String(Math.floor(area.minPrice)));
  if (area.maxPrice !== undefined) u.searchParams.set('max_price', String(Math.ceil(area.maxPrice)));
  return u.toString();
}

const SEARCH_READY = '.search-results-list, p.results';
const DETAIL_READY = 'script[type="application/ld+json"]';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clean = (s: string | undefined) => (s ?? '').replace(/[\s ]+/g, ' ').trim();

function jsonLd($: CheerioAPI, scope?: string): unknown[] {
  const out: unknown[] = [];
  $(`${scope ? `${scope} ` : ''}script[type="application/ld+json"]`).each((_, el) => {
    try {
      out.push(JSON.parse($(el).text()));
    } catch {
      // Kamer.nl's FAQ block has raw newlines inside strings and does not parse; it holds no listings.
    }
  });
  return out;
}

const typesOf = (o: Record<string, unknown>): string[] => (Array.isArray(o['@type']) ? (o['@type'] as unknown[]).map(String) : [String(o['@type'] ?? '')]);

/** "/huren/kamer-delft/julianalaan/675658/" into its parts. */
export function kamerNlPath(url: string): { category: string; citySlug: string; street: string; id: string } | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const m = /^\/huren\/(kamer|studio|appartement|huurwoning)-([a-z0-9-]+)\/([a-z0-9-]+)\/(\d+)\/?$/i.exec(path);
  if (!m) return undefined;
  return { category: (m[1] ?? '').toLowerCase(), citySlug: (m[2] ?? '').toLowerCase(), street: m[3] ?? '', id: m[4] ?? '' };
}

const titleCase = (slug: string) => slug.split('-').map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');

const GONE = /\b(verhuurd|onder optie|gereserveerd|niet meer beschikbaar)\b/i;

/**
 * Reads a Kamer.nl search page: the JSON-LD `ItemList` inside the results
 * block (URL, price, start date, photo) enriched with the card for each id
 * (street and town, size, rooms, availability, the first lines of the text).
 * The page lists homes "net buiten" the town in a second ItemList; only
 * items whose URL is in the requested category and town are kept.
 */
export function parseKamerNlSearch(html: string, opts: { baseUrl: string; category?: string; citySlug?: string; now: Date }): RawListing[] {
  const $ = load(html);
  const lists = [...jsonLd($, '.search-results-list'), ...jsonLd($)].filter((d): d is Record<string, unknown> => isObj(d) && typesOf(d).includes('ItemList'));
  const main = lists[0];
  if (!main) return [];
  const want = opts.category && opts.citySlug ? `${opts.category}-${opts.citySlug}` : undefined;
  const items = (Array.isArray(main.itemListElement) ? main.itemListElement : []).filter(isObj);
  const out: RawListing[] = [];
  for (const item of items) {
    const url = typeof item.url === 'string' ? new URL(item.url, opts.baseUrl).toString() : undefined;
    const parts = url ? kamerNlPath(url) : undefined;
    if (!url || !parts) continue;
    if (want && `${parts.category}-${parts.citySlug}` !== want) continue;
    const card = $(`div[id="${parts.id}"]`).first();
    const cardText = clean(card.text());
    if (GONE.test(cardText.split('€')[0] ?? '')) continue;
    const addressLine = /^(?:populair!\s*)?(.+?),\s*([^€]+?)\s*€/i.exec(cardText);
    const street = clean(addressLine?.[1]) || titleCase(parts.street);
    const city = clean(addressLine?.[2]) || titleCase(parts.citySlug);
    const price = Number(item.price);
    const start = typeof item.startTime === 'string' && /^\d{4}-\d{2}-\d{2}/.test(item.startTime) ? item.startTime.slice(0, 10) : undefined;
    const availability = /(per direct beschikbaar|beschikbaar (?:vanaf|per) [^€]*?\d{4}|beschikbaar (?:vanaf|per) \d{1,2} \w+)/i.exec(cardText)?.[1];
    const afterPrice = cardText.split(/p\/m/i)[1] ?? '';
    const description = clean(card.find('p.line-clamp-3').first().text()) || undefined;
    const typeName = { kamer: 'Kamer', studio: 'Studio', appartement: 'Appartement', huurwoning: 'Huis' }[parts.category] ?? '';
    const title = card.find('a[title]').first().attr('title')?.trim() || `${typeName} ${street} in ${city}`.trim();
    const furnishing = description ? detectFurnishing(description) : 'unknown';
    const image = typeof item.image === 'string' && /^https?:/.test(item.image) && !/logo-kamer/.test(item.image) ? item.image : undefined;
    const listing: RawListing = {
      sourceId: 'kamernl',
      externalId: parts.id,
      url,
      title,
      address: { street, city },
      type: TYPE_OF[parts.category],
      contact: 'message',
      contactUrl: `${url.replace(/\/?$/, '/')}reageren/`,
      language: 'nl',
    };
    if (Number.isFinite(price) && price > 0) Object.assign(listing, { priceEur: price, priceBasis: 'unknown' });
    const size = parseSize(/(\d+[.,]?\d*)\s*m²/.exec(afterPrice)?.[0] ?? '');
    if (size) listing.sizeM2 = size;
    const rooms = parseRooms(/(\d+)\s*kamers?\b/i.exec(afterPrice)?.[0] ?? '');
    if (rooms) listing.rooms = rooms;
    const from = (availability ? parseDutchDate(availability, opts.now) : undefined) ?? start;
    if (from) listing.availableFrom = from;
    if (description) listing.description = description;
    if (furnishing !== 'unknown') listing.furnishing = furnishing;
    if (image) listing.images = [image];
    out.push(listing);
  }
  return out;
}

/** Fields from a Kamer.nl listing page's JSON-LD (`@type: ["Huis", "Product"]`). */
export function parseKamerNlDetail(html: string): Partial<RawListing> {
  const $ = load(html);
  const product = jsonLd($).find((d): d is Record<string, unknown> => isObj(d) && typesOf(d).some((t) => t === 'Product' || t === 'Huis'));
  if (!product) return {};
  const out: Partial<RawListing> = {};
  if (typeof product.description === 'string') out.description = product.description.trim();
  const addr = isObj(product.address) ? product.address : {};
  const postcode = typeof addr.postalCode === 'string' ? normalisePostcode(addr.postalCode) : undefined;
  out.address = {
    ...(typeof addr.streetAddress === 'string' ? { street: addr.streetAddress } : {}),
    ...(postcode ? { postcode } : {}),
    ...(typeof addr.addressLocality === 'string' ? { city: addr.addressLocality } : {}),
  };
  const offer = isObj(product.offers) ? product.offers : {};
  const price = Number(offer.price);
  if (Number.isFinite(price) && price > 0) out.priceEur = price;
  const size = isObj(product.floorSize) ? Number(product.floorSize.value) : NaN;
  if (Number.isFinite(size) && size > 0) out.sizeM2 = Math.round(size);
  const rooms = Number(product.numberOfRooms);
  if (Number.isInteger(rooms) && rooms > 0) out.rooms = rooms;
  if (typeof product.available_from === 'string' && /^\d{4}-\d{2}-\d{2}/.test(product.available_from)) out.availableFrom = product.available_from.slice(0, 10);
  const photos = (Array.isArray(product.photo) ? product.photo : [])
    .map((p) => (isObj(p) && typeof p.contentUrl === 'string' ? p.contentUrl : undefined))
    .filter((s): s is string => Boolean(s));
  if (photos.length) out.images = photos;
  if (out.description) {
    const f = detectFurnishing(out.description);
    if (f !== 'unknown') out.furnishing = f;
  }
  if (product.petsAllowed === 'false' || product.petsAllowed === false) out.extra = { petsAllowed: false };
  else if (product.petsAllowed === 'true' || product.petsAllowed === true) out.extra = { petsAllowed: true };
  return out;
}

/**
 * Kamer.nl: rooms and small homes, mostly from private landlords, behind a
 * Cloudflare managed challenge. Reacting needs Premium (EUR 29.95 a month,
 * VERIFIED on the pricing page), so this source is for discovery: the router
 * reacts on a free copy of the home elsewhere unless the plan is set.
 */
export function createKamerNlAdapter(options: KamerNlOptions = {}): SourceAdapter {
  const base = trimTrailingSlashes(options.baseUrl ?? 'https://www.kamer.nl');
  const waitMs = options.waitMs ?? 30_000;

  return {
    id: 'kamernl',
    name: 'Kamer.nl',
    homepage: 'https://www.kamer.nl',
    regions: 'nl',
    defaultIntervalSec: 900,
    capabilities: {
      search: 'browser',
      detail: true,
      contact: 'message',
      login: 'required',
      paid: { feature: 'contact', plan: 'kamernl-premium' },
      terms: 'unknown',
      browser: 'headed',
    },
    loginUrl: `${base}/login/`,

    buildSearches(searches: NamedSearch[], source: SourceConfig) {
      const reqs: SearchRequest[] = [];
      for (const area of areasFromSearches(searches)) {
        const types = (area.types ?? (['room', 'studio', 'apartment', 'house'] as const)).filter((t): t is Exclude<PropertyType, 'other'> => t !== 'other');
        for (const t of types) {
          const category = CATEGORY[t];
          reqs.push({
            key: `${category}-${area.slug}:${area.minPrice ?? 0}-${area.maxPrice ?? ''}`,
            label: `Kamer.nl ${area.name} (${category})`,
            url: kamerNlSearchUrl(base, category, area),
            params: { category, city: area.slug },
          });
        }
      }
      return [...reqs, ...searchUrlRequests(source, 'Kamer.nl', reqs)];
    },

    async search(req, ctx) {
      const url = req.url ?? `${base}/huren/kamer-nederland/?sort=-created`;
      return withBrowserPage(ctx, async (page) => {
        const loaded = await loadPage(page, url, { ready: SEARCH_READY, waitMs, signal: ctx.signal });
        const category = typeof req.params?.category === 'string' ? req.params.category : undefined;
        const city = typeof req.params?.city === 'string' ? citySlug(req.params.city) : undefined;
        return dedupeListings(parseKamerNlSearch(loaded.html, { baseUrl: loaded.url, category, citySlug: city, now: ctx.now() }));
      });
    },

    async detail(listing, ctx) {
      return withBrowserPage(ctx, async (page) => {
        const loaded = await loadPage(page, listing.url, { ready: DETAIL_READY, waitMs, signal: ctx.signal });
        const d = parseKamerNlDetail(loaded.html);
        return {
          ...listing,
          ...d,
          title: listing.title,
          address: { ...listing.address, ...d.address },
          extra: { ...listing.extra, ...d.extra },
          contact: 'message',
          contactUrl: listing.contactUrl ?? `${listing.url.replace(/\/?$/, '/')}reageren/`,
        };
      });
    },

    async isAvailable(listing, ctx) {
      return withBrowserPage(ctx, async (page) => {
        let loaded: LoadedPage;
        try {
          loaded = await loadPage(page, listing.url, { ready: DETAIL_READY, waitMs, signal: ctx.signal });
        } catch (e) {
          if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
          throw e;
        }
        // A removed listing lands on a search page; a live one still has its listing JSON-LD.
        return Boolean(kamerNlPath(loaded.url)) && Object.keys(parseKamerNlDetail(loaded.html)).length > 0;
      });
    },

    async contact(listing: Listing, _message: OutboundMessage, ctx: SourceContext): Promise<ContactResult> {
      if (!ctx.source.paidPlan) return { ok: false, channel: 'message', needs: 'paid', error: 'reacting on Kamer.nl needs Premium (kamernl-premium)' };
      // The Premium reaction form could not be recorded without an account, so it is not automated yet.
      return { ok: false, channel: 'message', error: `automatic reactions on Kamer.nl are not supported yet; react on ${listing.contactUrl ?? listing.url}` };
    },

    async checkSession(ctx) {
      // Logged out, the header links to /login/ (recorded); logged in it should not (UNVERIFIED).
      return withBrowserPage(ctx, async (page) => {
        const loaded = await loadPage(page, `${base}/`, { ready: 'header, nav', waitMs, signal: ctx.signal });
        return load(loaded.html)('a[href="/login/"], a[href$="/login/"]').length > 0 ? 'none' : 'ok';
      });
    },
  };
}

export const kamernl = createKamerNlAdapter();

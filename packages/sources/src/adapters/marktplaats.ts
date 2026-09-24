/**
 * Marktplaats (marktplaats.nl, Huizen en Kamers): rooms and homes, mostly
 * from private people. Listings come from the JSON search API the site's own
 * result pages use; reacting is an in-app chat that needs a login, which this
 * adapter does not automate (the router then asks the user to react).
 *
 * Verified live on 2026-09-24: `GET /lrp/api/search` with `l2CategoryIds[]`
 * (2771 kamers te huur, 2143 huizen te huur, 2147 expat rentals), `postcode`
 * plus `distanceMeters`, `attributeRanges[]=PriceCents:from:to` (applied
 * server side) and newest-first sorting; the item fields; and the item page's
 * `window.__CONFIG__.listing` (seller type, account type, `stats.since`,
 * `isReserved`) plus its JSON-LD description.
 *
 * Scam guard: Marktplaats has the highest scam rate of all sources (fake
 * rooms, "landlord abroad", deposit before viewing, furniture ads in the
 * rental categories). The adapter drops ads that are not homes at all and
 * passes signals in `extra` for the scam scoring in the agent package:
 * `privateLandlord`, `sellerType`, `sellerAccountType`, `sellerVerified`,
 * `sellerAbroad`, `sellerActiveYears` and `priceType`. Weigh them more
 * heavily here than on any other source.
 */
import { load } from 'cheerio';
import type {
  InboundMessage,
  NamedSearch,
  PropertyType,
  RawListing,
  SearchRequest,
  SourceAdapter,
  SourceContext,
} from '@nlpf/core';
import { SourceHttpError } from '../runtime/errors.js';
import { detectFurnishing, detectType, parsePrice, parseRooms, parseSize } from '../util/parse.js';
import {
  alertCards,
  assignedJson,
  clean,
  compact,
  filterKey,
  guessLanguage,
  isObj,
  isoInstant,
  municipalityName,
  num,
  PLACES,
  relativeDutchDay,
  resolvePlace,
  searchMunicipalities,
  senderIs,
  str,
} from './json-shared.js';

const BASE = 'https://www.marktplaats.nl';
const L1_HOUSES_AND_ROOMS = 1032;

/** Rental categories of Huizen en Kamers. The "op zoek naar" categories (2145, 2146) are wanted ads and never polled. */
const CATEGORY = { rooms: 2771, houses: 2143, expat: 2147, antiSquat: 2144 } as const;
const CATEGORY_TYPE: Record<number, PropertyType> = {
  2771: 'room',
  2143: 'apartment',
  2147: 'apartment',
  2144: 'other',
};

function categories(types: PropertyType[]): number[] {
  const out = new Set<number>();
  if (types.includes('room') || types.includes('studio')) out.add(CATEGORY.rooms);
  if (types.some((t) => t === 'studio' || t === 'apartment' || t === 'house')) out.add(CATEGORY.houses);
  out.add(CATEGORY.expat);
  if (types.includes('other')) out.add(CATEGORY.antiSquat);
  return [...out].sort((a, b) => a - b);
}

/** Words that show an ad is about a place to live. Furniture and odd jobs in the rental categories lack them. */
const HOME_WORDS =
  /\b(kamers?|room|rooms|studio'?s?|appartement(en)?|apartments?|woning|woonruimte|huis|house|woonboot|houseboat|flat|bovenwoning|benedenwoning|te\s?huur|for rent|huur|rent|onderhuur|sublet)\b/i;
/** Ads for things that are not a home to rent: offices, storage, postal addresses, short stays. */
const NOT_A_HOME =
  /\b(bedrijfsruimte|kantoor(ruimte)?|praktijkruimte|winkel(ruimte)?|pop.?up|opslag(ruimte)?|garagebox|parkeerplaats|briefadres|postadres|vakantie\w*|overnacht\w*|per nacht|per dag|hotel(kamer)?|overwinteren|te koop|for sale)\b/i;
/** Wanted ads that ended up in the offer categories ("kamer gezocht", "I'm looking for a room"). */
const WANTED =
  /\b(kamer|woning|woonruimte|studio|appartement|huis|room|place|accommodation|housing)\s+(gezocht|zoeken|wanted)\b|^\s*(ik\s+)?zoek|\bop zoek naar\b|\blooking for\b|\bsearching for\b/i;

/** Whether a Marktplaats ad in a rental category is an offer of a place to live. */
export function isHomeOffer(title: string, description = ''): boolean {
  const text = `${title}\n${description}`;
  if (WANTED.test(title) || NOT_A_HOME.test(title)) return false;
  return HOME_WORDS.test(text);
}

interface MpItem {
  itemId?: string;
  title?: string;
  description?: string;
  categorySpecificDescription?: string;
  priceInfo?: { priceCents?: number; priceType?: string };
  location?: { cityName?: string; latitude?: number; longitude?: number; distanceMeters?: number };
  date?: string;
  imageUrls?: string[];
  pictures?: { largeUrl?: string; extraExtraLargeUrl?: string }[];
  sellerInformation?: {
    sellerId?: number;
    sellerName?: string;
    isVerified?: boolean;
    showWebsiteUrl?: boolean;
  };
  categoryId?: number;
  attributes?: { key?: string; value?: string }[];
  reserved?: boolean;
  vipUrl?: string;
}

/** Prices below this are placeholders ("bieden", a symbolic euro) or not rent at all. */
const MIN_RENT_EUR = 100;

const ALERT_DOMAINS = ['marktplaats.nl'];
const DETAIL_PATH = /^\/[va]\/huizen-en-kamers\/([a-z-]+)\/(m\d{6,})(-[a-z0-9-]*)?\/?$/i;
const ALERT_CATEGORY_TYPE: Record<string, PropertyType | undefined> = {
  'kamers-te-huur': 'room',
  'huizen-te-huur': 'apartment',
  'anti-kraak': 'other',
};

function attr(item: MpItem, key: string): string | undefined {
  return item.attributes?.find((a) => a.key === key)?.value;
}

function toRaw(item: MpItem, now: Date): RawListing | undefined {
  const id = str(item.itemId)?.toLowerCase();
  const title = clean(item.title);
  if (!id || !/^m\d+$/.test(id) || !title || !item.vipUrl) return undefined;
  if (item.reserved) return undefined;
  const description = str(item.categorySpecificDescription) ?? str(item.description);
  if (!isHomeOffer(title, description)) return undefined;
  const priceType = str(item.priceInfo?.priceType);
  const cents = num(item.priceInfo?.priceCents);
  const priceEur =
    (priceType === 'FIXED' || priceType === 'MIN_BID') && cents && cents / 100 >= MIN_RENT_EUR
      ? cents / 100
      : undefined;
  const text = `${title}\n${description ?? ''}`;
  const living = attr(item, 'livingArea');
  const size =
    living && !/\btot\b|minder|meer/i.test(living)
      ? parseSize(living)
      : parseSize(/\d\s*(m2|m²)/i.test(title) ? title : '');
  const furnishing = detectFurnishing(text);
  const images = (item.pictures ?? [])
    .map((p) => str(p.extraExtraLargeUrl) ?? str(p.largeUrl))
    .filter((u): u is string => Boolean(u))
    .slice(0, 5);
  if (!images.length && item.imageUrls?.length)
    images.push(...item.imageUrls.slice(0, 5).map((u) => (u.startsWith('//') ? `https:${u}` : u)));
  const seller = item.sellerInformation ?? {};
  const url = `${BASE}${item.vipUrl}`;
  const label = attr(item, 'energyLabel');
  return compact<RawListing>({
    sourceId: 'marktplaats',
    externalId: id,
    url,
    title,
    priceEur,
    priceBasis: priceEur === undefined ? undefined : parsePrice(text).basis,
    sizeM2: size,
    rooms: parseRooms(attr(item, 'numberOfRooms') ?? ''),
    type: detectType(title) ?? detectType(description ?? '') ?? CATEGORY_TYPE[item.categoryId ?? 0],
    furnishing: furnishing === 'unknown' ? undefined : furnishing,
    address: compact({
      city: str(item.location?.cityName),
      lat: num(item.location?.latitude),
      lon: num(item.location?.longitude),
    }),
    description,
    images: images.length ? images : undefined,
    energyLabel: label ? /^([A-G]\+*)/i.exec(label)?.[1]?.toUpperCase() : undefined,
    agent: compact({ name: str(seller.sellerName) }),
    contact: 'message',
    contactUrl: url,
    publishedAt: relativeDutchDay(item.date, now),
    language: guessLanguage(text),
    extra: compact({
      // A business account shows its website; everyone else is taken as a private person
      // only after detail() reads the seller type.
      privateLandlord: seller.showWebsiteUrl ? false : undefined,
      sellerVerified: typeof seller.isVerified === 'boolean' ? seller.isVerified : undefined,
      sellerId: num(seller.sellerId),
      priceType,
      category: item.categoryId,
    }),
  });
}

export interface MarktplaatsOptions {
  /** Radius around the municipality centre when the place table has none. Default 5 km. */
  defaultRadiusKm?: number;
}

export function createMarktplaatsAdapter(options: MarktplaatsOptions = {}): SourceAdapter {
  const defaultRadiusKm = options.defaultRadiusKm ?? 5;

  function searchUrl(
    params: Record<string, string | number | boolean>,
    postcode: string | undefined,
  ): string {
    const cats = String(params.categories ?? '')
      .split(',')
      .filter(Boolean);
    const q: string[] = [`l1CategoryId=${L1_HOUSES_AND_ROOMS}`, ...cats.map((c) => `l2CategoryIds[]=${c}`)];
    if (postcode) q.push(`postcode=${postcode}`, `distanceMeters=${params.distanceMeters}`);
    if (params.priceFromCents !== undefined || params.priceToCents !== undefined) {
      q.push(`attributeRanges[]=PriceCents:${params.priceFromCents ?? 0}:${params.priceToCents ?? ''}`);
    }
    q.push('limit=30', 'offset=0', 'sortBy=SORT_INDEX', 'sortOrder=DECREASING', 'viewOptions=list-view');
    return `${BASE}/lrp/api/search?${q.join('&')}`;
  }

  async function readItemPage(url: string, ctx: SourceContext) {
    const res = await ctx.fetch(url);
    const html = res.text;
    const config = assignedJson(html, '__CONFIG__');
    const $ = load(html);
    let ld: Record<string, unknown> | undefined;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const v = JSON.parse($(el).text()) as unknown;
        if (isObj(v) && v['@type'] === 'RealEstateListing') ld = v;
      } catch {
        // other JSON-LD blocks
      }
    });
    return { finalUrl: res.url || url, listing: isObj(config?.listing) ? config.listing : undefined, ld };
  }

  const adapter: SourceAdapter = {
    id: 'marktplaats',
    name: 'Marktplaats',
    homepage: BASE,
    regions: 'nl',
    defaultIntervalSec: 60,
    capabilities: { search: 'json', detail: true, contact: 'message', login: 'required', terms: 'forbids' },
    alertSenders: ['noreply@marktplaats.nl', 'marktplaats.nl'],

    buildSearches(searches: NamedSearch[]): SearchRequest[] {
      const out = new Map<string, SearchRequest>();
      for (const search of searches) {
        const cats = categories(search.types).join(',');
        const priceFromCents =
          search.priceMinEur !== undefined ? Math.round(search.priceMinEur * 100) : undefined;
        const priceToCents =
          search.priceMaxEur !== undefined ? Math.round(search.priceMaxEur * 100) : undefined;
        const municipalities = searchMunicipalities(search);
        for (const m of municipalities.length ? municipalities : ['']) {
          const place = m ? PLACES[m] : undefined;
          const params = compact({
            municipality: m || undefined,
            categories: cats,
            postcode: place?.postcode,
            distanceMeters: m ? (place?.radiusKm ?? defaultRadiusKm) * 1000 : undefined,
            priceFromCents,
            priceToCents,
          }) as Record<string, string | number>;
          const key = `${m || 'nl'}?${filterKey({ cats, from: priceFromCents, to: priceToCents })}`;
          if (out.has(key)) continue;
          out.set(key, {
            key,
            label: `Marktplaats ${m ? municipalityName(m) : 'Nederland'}`,
            // Without a known postcode the URL is completed in search() after a place lookup.
            url: m && !place?.postcode ? undefined : searchUrl(params, place?.postcode),
            params,
          });
        }
      }
      return [...out.values()];
    },

    async search(req, ctx) {
      const params = req.params ?? {};
      let url = req.url;
      if (!url) {
        const place = params.municipality ? await resolvePlace(String(params.municipality), ctx) : undefined;
        if (params.municipality && !place?.postcode) {
          ctx.log.warn('marktplaats: no postcode for this municipality, searching without a location', {
            municipality: params.municipality,
          });
        }
        url = searchUrl(params, place?.postcode);
      }
      const res = await ctx.fetch(url, { headers: { accept: 'application/json' } });
      const items = res.json<{ listings?: MpItem[] }>().listings ?? [];
      const now = ctx.now();
      const out: RawListing[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const raw = toRaw(item, now);
        if (raw && !seen.has(raw.externalId)) {
          seen.add(raw.externalId);
          out.push(raw);
        }
      }
      ctx.log.debug('marktplaats listings read', { count: out.length, items: items.length });
      return out;
    },

    async detail(listing, ctx) {
      const { listing: item, ld } = await readItemPage(listing.url, ctx);
      const out: RawListing = { ...listing, address: { ...listing.address }, extra: { ...listing.extra } };
      const extra = out.extra as Record<string, unknown>;
      const description = str(ld?.description);
      if (description && description.length >= (out.description?.length ?? 0)) out.description = description;
      const images = Array.isArray(ld?.image)
        ? ld.image.filter((u): u is string => typeof u === 'string')
        : [];
      if (images.length) out.images = images.slice(0, 10);
      if (item) {
        const seller = isObj(item.seller) ? item.seller : {};
        const sellerType = str(seller.sellerType);
        const dims = Array.isArray(item.customDimensions) ? item.customDimensions.filter(isObj) : [];
        const accountType = str(dims.find((d) => d.name === 'SellerAccountType')?.value);
        if (sellerType) extra.sellerType = sellerType;
        if (accountType) extra.sellerAccountType = accountType;
        // CONSUMER is a private person; TRADER declared itself a business under the
        // EU rules for marketplaces. A Pro or business account is never private.
        if (sellerType === 'CONSUMER') extra.privateLandlord = true;
        else if (sellerType === 'TRADER' || /pro|business|bedrijf|dealer/i.test(accountType ?? ''))
          extra.privateLandlord = false;
        const location = isObj(seller.location) ? seller.location : {};
        if (typeof location.isAbroad === 'boolean') extra.sellerAbroad = location.isAbroad;
        const years = num(seller.activeYears);
        if (years !== undefined) extra.sellerActiveYears = years;
        const stats = isObj(item.stats) ? item.stats : {};
        const since = isoInstant(stats.since);
        if (since) out.publishedAt = since;
        if (item.isReserved === true) extra.reserved = true;
        const views = num(stats.viewCount);
        if (views !== undefined) extra.views = views;
        const favorites = num(stats.favoritedCount);
        if (favorites !== undefined) extra.favorites = favorites;
      }
      if (out.description) out.language = guessLanguage(`${out.title}\n${out.description}`) ?? out.language;
      return out;
    },

    async isAvailable(listing, ctx) {
      let page;
      try {
        page = await readItemPage(listing.url, ctx);
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
      // A removed ad redirects to its category or a search page.
      if (!new URL(page.finalUrl).pathname.includes(listing.externalId)) return false;
      if (!page.listing) return false;
      return page.listing.isReserved !== true;
    },

    parseAlertEmail(mail: InboundMessage): RawListing[] {
      if (mail.channel !== 'email' || !senderIs(mail, ALERT_DOMAINS)) return [];
      const cards = alertCards(mail, (u) => {
        if (!/(^|\.)marktplaats\.nl$/i.test(u.hostname)) return undefined;
        const m = DETAIL_PATH.exec(u.pathname);
        const category = m?.[1]?.toLowerCase();
        return category && (category in ALERT_CATEGORY_TYPE || category === 'expat-rentals')
          ? m?.[2]?.toLowerCase()
          : undefined;
      });
      const now = new Date(mail.at);
      return cards
        .filter((card) => isHomeOffer(card.title))
        .map((card) => {
          const m = DETAIL_PATH.exec(card.url.pathname);
          const category = m?.[1]?.toLowerCase() ?? '';
          const priceLine = card.lines.find((l) => /€|prijs|bieden/i.test(l)) ?? '';
          const price = parsePrice(priceLine);
          const placeLine = card.lines.find((l) => /·/.test(l));
          const [city, when] = placeLine ? placeLine.split('·').map(clean) : [];
          return compact<RawListing>({
            sourceId: 'marktplaats',
            externalId: card.id,
            url: `${BASE}${card.url.pathname.replace(/\/+$/, '')}`,
            title: card.title,
            priceEur:
              price.priceEur !== undefined && price.priceEur >= MIN_RENT_EUR ? price.priceEur : undefined,
            priceBasis:
              price.priceEur !== undefined && price.priceEur >= MIN_RENT_EUR ? price.basis : undefined,
            sizeM2: parseSize(/\d\s*(m2|m²)/i.test(card.title) ? card.title : ''),
            type: detectType(card.title) ?? ALERT_CATEGORY_TYPE[category],
            address: compact({ city }),
            images: card.image ? [card.image] : undefined,
            contact: 'message',
            publishedAt: relativeDutchDay(when, now),
            language: guessLanguage(card.title),
            extra: { via: 'alert', alertMessageId: mail.id },
          });
        });
    },
  };
  return adapter;
}

export const marktplaats = createMarktplaatsAdapter();

import type { PropertyType, RawListing, SourceAdapter, SourceContext } from '@nlpf/core';
import { parseDutchDate } from '../util/parse.js';

/*
 * Stadswonen Rotterdam (student and starter housing of Woonstad). The
 * /nl/aanbod page renders its list in the browser from a JSON API on an
 * Azure gateway (VERIFIED 2026-09-24: 32 listings, one request with
 * size=100). The API has no price filter, and reacting happens in
 * MijnStadswonen after registration, so listings are notify-only.
 */

export const STADSWONEN_API = 'https://wrf-prod-app-api-gateway.azurewebsites.net/api/stadswonen/search/nl/aanbod';
const SITE = 'https://www.stadswonenrotterdam.nl';
const LIST_URL = `${STADSWONEN_API}?${new URLSearchParams({ qson: 'filter:(),list:(page:1,sort:default,type:list)', size: '100' })}`;

interface Item {
  id: string;
  name: string;
  url: string;
  category?: string;
  type?: string;
  objectType?: string;
  image?: { url?: string };
  district?: string;
  latitude?: number;
  longitude?: number;
  price?: number;
  serviceCosts?: number;
  surface?: number;
  rooms?: number;
  energyLabel?: string;
  description?: string;
  available?: string;
  isoUntil?: string;
  complexName?: string;
  campaign?: string;
  target?: string[];
  ageMin?: number;
  ageMax?: number;
  incomeMin?: number;
  incomeMax?: number;
  gender?: string;
}

const TYPES: Record<string, PropertyType> = { kamer: 'room', studio: 'studio', appartement: 'apartment', woning: 'house' };
const ALLOCATION: Record<string, string> = { SWHospiteren: 'hospiteren', SWToewijzing: 'toewijzing' };

/** Street, number and addition from names like "Coolhaven 222A 1", "Rivierstraat 41A /1" or "Laan op Zuid 181 j". */
function address(name: string): RawListing['address'] {
  const m = /^(.*?\p{L}.*?)\s+(\d+)\s*(.*)$/u.exec(name.trim());
  if (!m) return { street: name.trim(), city: 'Rotterdam' };
  const rest = (m[3] ?? '').trim().replace(/\s*\/\s*|\s+/g, '-');
  const addition = /^\p{L}$/u.test(rest) ? rest.toUpperCase() : rest.replace(/^(\p{L})(?=-)/u, (l) => l.toUpperCase());
  return { street: m[1], houseNumber: m[2], ...(addition ? { addition } : {}), city: 'Rotterdam' };
}

/** A MongoDB ObjectId starts with its creation time in seconds, which is when the listing was put online. */
function createdAt(id: string): string | undefined {
  if (!/^[0-9a-f]{24}$/.test(id)) return undefined;
  return new Date(parseInt(id.slice(0, 8), 16) * 1000).toISOString();
}

const positive = (n: number | undefined) => (typeof n === 'number' && n > 0 ? n : undefined);

export function mapStadswonenItem(item: Item, now: Date = new Date()): RawListing | undefined {
  if (item.category && item.category !== 'rent') return undefined;
  const addr = address(item.name);
  if (item.district) addr.neighbourhood = item.district;
  if (typeof item.latitude === 'number' && typeof item.longitude === 'number') Object.assign(addr, { lat: item.latitude, lon: item.longitude });
  const label = item.energyLabel?.trim();
  const listing: RawListing = {
    sourceId: 'stadswonen',
    externalId: item.id,
    url: `${SITE}/nl/aanbod/${item.url}`,
    title: item.name.trim(),
    priceEur: positive(item.price),
    priceBasis: positive(item.price) ? 'excl' : undefined,
    serviceCostsEur: positive(item.serviceCosts),
    sizeM2: positive(item.surface),
    rooms: positive(item.rooms),
    type: TYPES[(item.objectType ?? '').toLowerCase()],
    address: addr,
    availableFrom: item.available ? parseDutchDate(item.available, now) : undefined,
    description: item.description?.trim() || undefined,
    images: item.image?.url ? [item.image.url] : undefined,
    energyLabel: label && /^[A-G]\+*$/i.test(label) ? label.toUpperCase() : undefined,
    publishedAt: createdAt(item.id),
    agent: { name: 'Stadswonen Rotterdam', url: SITE },
    contact: 'none',
    language: 'nl',
    extra: {
      deadline: item.isoUntil,
      allocation: ALLOCATION[item.type ?? ''] ?? item.type,
      complex: item.complexName,
      target: item.target,
      ageMin: item.ageMin,
      ageMax: item.ageMax,
      incomeMin: positive(item.incomeMin),
      incomeMax: positive(item.incomeMax),
      gender: item.gender && item.gender !== 'none' ? item.gender : undefined,
      campaign: item.campaign || undefined,
    },
  };
  for (const k of Object.keys(listing) as (keyof RawListing)[]) if (listing[k] === undefined) delete listing[k];
  const extra = listing.extra ?? {};
  for (const k of Object.keys(extra)) if (extra[k] === undefined) delete extra[k];
  return listing;
}

async function fetchItems(ctx: SourceContext, url = LIST_URL): Promise<Item[]> {
  const res = await ctx.fetch(url, { headers: { accept: 'application/json', origin: SITE, referer: `${SITE}/` } });
  const data = res.json<{ items?: Item[] }>();
  if (!Array.isArray(data.items)) throw new Error('Stadswonen: the aanbod API answered without an items list');
  return data.items;
}

export function createStadswonenAdapter(): SourceAdapter {
  return {
    id: 'stadswonen',
    name: 'Stadswonen Rotterdam',
    homepage: `${SITE}/nl/aanbod`,
    regions: ['rotterdam'],
    defaultIntervalSec: 600,
    capabilities: { search: 'json', detail: false, contact: 'none', login: 'required', terms: 'unknown' },

    buildSearches() {
      return [{ key: 'aanbod', label: 'Stadswonen Rotterdam', url: LIST_URL }];
    },

    async search(req, ctx) {
      const now = ctx.now();
      return (await fetchItems(ctx, req.url))
        .map((item) => mapStadswonenItem(item, now))
        .filter((l): l is RawListing => Boolean(l));
    },

    async isAvailable(listing, ctx) {
      const item = (await fetchItems(ctx)).find((i) => i.id === listing.externalId);
      if (!item) return false;
      return !item.isoUntil || Date.parse(item.isoUntil) > ctx.now().getTime();
    },
  };
}

/**
 * Vesteda (vesteda.com): a large institutional landlord with mid-rent
 * apartments. Listings come from the JSON search API behind the site's
 * search page; reacting ("Inschrijven en bezichtigen") needs a free account
 * at hurenbij.vesteda.com and is not automated here, so the router asks the
 * user to react.
 *
 * Verified live on 2026-09-24: `POST /api/units/search/facet` with place,
 * coordinates, radius (km), `priceFrom` and `priceTo` (the price range only
 * applies with `priceFrom` of at least 500, the lowest option on the site)
 * and `sorting: 1` (newest, which groups the results by week, month and
 * older); the `UnitStatus` enum from the site's bundle (1 for rent, 2
 * rented, 3 rented under reservation, 4 reserved, 5 new); and the unit
 * page's definition lists plus the minimum gross income it shows.
 */
import { load, type CheerioAPI } from 'cheerio';
import type { NamedSearch, PropertyType, RawListing, Requirements, SearchRequest, SourceAdapter, SourceContext } from '@nlpf/core';
import { SourceHttpError } from '../runtime/errors.js';
import { normalisePostcode } from '../util/address.js';
import { detectType, parseDutchDate, parsePrice } from '../util/parse.js';
import {
  clean,
  compact,
  filterKey,
  isObj,
  municipalityName,
  num,
  PLACES,
  positive,
  resolvePlace,
  searchMunicipalities,
  str,
  titleCase,
} from './json-shared.js';

const BASE = 'https://www.vesteda.com';

/** `UnitStatus` from the Vesteda bundle. Only ForRent and New are open to reactions. */
const OPEN_STATUS = new Set([1, 5]);
const STATUS_LABEL: Record<number, string> = { 1: 'for rent', 2: 'rented', 3: 'rented under reservation', 4: 'reserved', 5: 'new' };

/** The lowest `priceFrom` the site offers; lower values make the API ignore the price range. */
const MIN_PRICE_FROM = 500;

interface VUnit {
  id?: number;
  street?: string;
  houseNumber?: string | null;
  houseNumberAddition?: string | null;
  postalCode?: string | null;
  city?: string;
  size?: number | null;
  priceUnformatted?: number;
  numberOfBedRooms?: number;
  latitude?: number;
  longitude?: number;
  imageBig?: string;
  imageSmall?: string;
  district?: string | null;
  status?: number;
  url?: string;
  onlyMiddleRent?: boolean;
  onlySixtyFivePlus?: boolean;
  ageFrom?: number;
  prioritizeKeyProfessions?: boolean;
  suitedForHomeSharers?: boolean;
  complex?: string | null;
  entitytypeid?: number;
  entitysubtypelabel?: string | null;
}

/** "'s-gravenhage" becomes "'s-Gravenhage"; "Capelle Aan Den Ijssel" becomes "Capelle aan den IJssel". */
function cityName(city: string): string {
  return titleCase(city)
    .replace(/\b(Aan|Den|De|Der|Van|Op|In|Bij)\b/g, (w, _m, offset: number) => (offset === 0 ? w : w.toLowerCase()))
    .replace(/\bIj/g, 'IJ');
}

/** Units come as a list, or grouped by recency ("week", "month", "older") when sorted by newest. */
function flatten(objects: unknown): { unit: VUnit; group?: string }[] {
  if (Array.isArray(objects)) return objects.filter(isObj).map((unit) => ({ unit: unit as VUnit }));
  if (isObj(objects)) {
    return Object.entries(objects).flatMap(([group, list]) =>
      Array.isArray(list) ? list.filter(isObj).map((unit) => ({ unit: unit as VUnit, group })) : [],
    );
  }
  return [];
}

function toRaw(unit: VUnit, group: string | undefined): RawListing | undefined {
  if (!unit.id || !unit.url || unit.entitytypeid === 2) return undefined; // entity type 2 is a whole complex, not a unit
  if (!OPEN_STATUS.has(unit.status ?? 0)) return undefined;
  const street = str(unit.street);
  const number = str(unit.houseNumber ?? undefined);
  const addition = str(unit.houseNumberAddition ?? undefined);
  const price = num(unit.priceUnformatted);
  const kind = str(unit.entitysubtypelabel ?? undefined);
  const type: PropertyType = kind ? (detectType(kind) ?? (/eengezins|woning/i.test(kind) ? 'house' : 'apartment')) : 'apartment';
  const image = str(unit.imageBig) ?? str(unit.imageSmall);
  return compact<RawListing>({
    sourceId: 'vesteda',
    externalId: String(unit.id),
    url: `${BASE}${unit.url}`,
    title: clean(`${street ?? ''} ${number ?? ''}${addition ? ` ${addition.toUpperCase()}` : ''}`),
    priceEur: price && price > 0 ? Math.round(price * 100) / 100 : undefined,
    // Vesteda lists the bare rent; service costs come on top (shown on the unit page).
    priceBasis: price && price > 0 ? 'excl' : undefined,
    sizeM2: positive(unit.size),
    bedrooms: positive(unit.numberOfBedRooms),
    type,
    address: compact({
      street,
      houseNumber: number,
      addition: addition ? (addition.length === 1 ? addition.toUpperCase() : addition) : undefined,
      postcode: normalisePostcode(unit.postalCode ?? ''),
      city: unit.city ? cityName(unit.city) : undefined,
      neighbourhood: str(unit.district ?? undefined),
      lat: num(unit.latitude),
      lon: num(unit.longitude),
    }),
    images: image ? [image] : undefined,
    agent: { name: 'Vesteda', url: BASE },
    contact: 'form',
    contactUrl: `${BASE}${unit.url}`,
    language: 'nl',
    extra: compact({
      status: STATUS_LABEL[unit.status ?? 0],
      recency: group,
      complex: str(unit.complex ?? undefined),
      onlyMiddleRent: unit.onlyMiddleRent || undefined,
      onlySixtyFivePlus: unit.onlySixtyFivePlus || undefined,
      minimumAge: positive(unit.ageFrom),
      prioritizeKeyProfessions: unit.prioritizeKeyProfessions || undefined,
      suitedForHomeSharers: unit.suitedForHomeSharers || undefined,
    }),
  });
}

/** Label and value pairs of the unit page's definition lists ("Servicekosten p.m." to "€ 92,-"). */
function definitions($: CheerioAPI): Map<string, string> {
  const out = new Map<string, string>();
  $('dl dt').each((_, dt) => {
    const label = clean($(dt).text()).toLowerCase();
    const value = clean($(dt).next('dd').text());
    if (label && value && !out.has(label)) out.set(label, value);
  });
  return out;
}

export interface VestedaOptions {
  /** Radius when a municipality is not in the place table, in km. Default 5. */
  defaultRadiusKm?: number;
}

export function createVestedaAdapter(options: VestedaOptions = {}): SourceAdapter {
  const defaultRadiusKm = options.defaultRadiusKm ?? 5;

  async function unitPage(url: string, ctx: SourceContext) {
    const res = await ctx.fetch(url);
    return { $: load(res.text), finalUrl: res.url || url };
  }

  const adapter: SourceAdapter = {
    id: 'vesteda',
    name: 'Vesteda',
    homepage: BASE,
    regions: 'nl',
    defaultIntervalSec: 60,
    capabilities: { search: 'json', detail: true, contact: 'form', login: 'required', terms: 'forbids' },
    loginUrl: 'https://hurenbij.vesteda.com/login/',

    buildSearches(searches: NamedSearch[]): SearchRequest[] {
      const out = new Map<string, SearchRequest>();
      for (const search of searches) {
        // Vesteda rents out apartments and family houses only.
        if (!search.types.some((t) => t === 'apartment' || t === 'house' || t === 'studio' || t === 'other')) continue;
        const priceTo = search.priceMaxEur ?? 9999;
        const priceFrom = Math.max(MIN_PRICE_FROM, search.priceMinEur ?? MIN_PRICE_FROM);
        if (priceFrom > priceTo) continue;
        for (const m of searchMunicipalities(search)) {
          const place = PLACES[m];
          const key = `${m}?${filterKey({ from: priceFrom, to: priceTo })}`;
          if (out.has(key)) continue;
          out.set(key, {
            key,
            label: `Vesteda ${municipalityName(m)}`,
            url: `${BASE}/api/units/search/facet`,
            params: compact({
              municipality: m,
              place: municipalityName(m),
              latitude: place?.lat,
              longitude: place?.lon,
              radius: place?.radiusKm ?? defaultRadiusKm,
              priceFrom,
              priceTo,
            }) as Record<string, string | number>,
          });
        }
      }
      return [...out.values()];
    },

    async search(req, ctx) {
      const p = req.params ?? {};
      let lat = num(p.latitude);
      let lon = num(p.longitude);
      if (lat === undefined || lon === undefined) {
        const place = await resolvePlace(String(p.municipality ?? p.place ?? ''), ctx);
        lat = place?.lat;
        lon = place?.lon;
      }
      if (lat === undefined || lon === undefined || (lat === 0 && lon === 0)) {
        ctx.log.warn('vesteda: no coordinates for this place, skipping', { place: p.place });
        return [];
      }
      const name = String(p.place ?? '');
      const body = {
        filters: [],
        latitude: lat,
        longitude: lon,
        place: name,
        placeObject: { placeType: '1', name, latitude: String(lat), longitude: String(lon) },
        placeType: 1,
        radius: Number(p.radius ?? defaultRadiusKm),
        sorting: 1, // newest first
        priceFrom: Number(p.priceFrom ?? MIN_PRICE_FROM),
        priceTo: Number(p.priceTo ?? 9999),
        language: 'nl',
      };
      const res = await ctx.fetch(req.url ?? `${BASE}/api/units/search/facet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = res.json<{ results?: { objects?: unknown } }>();
      const out: RawListing[] = [];
      const seen = new Set<string>();
      for (const { unit, group } of flatten(data.results?.objects)) {
        const raw = toRaw(unit, group);
        if (raw && !seen.has(raw.externalId)) {
          seen.add(raw.externalId);
          out.push(raw);
        }
      }
      ctx.log.debug('vesteda listings read', { count: out.length, place: name });
      return out;
    },

    async detail(listing, ctx) {
      const { $ } = await unitPage(listing.url, ctx);
      const out: RawListing = { ...listing, address: { ...listing.address }, extra: { ...listing.extra } };
      const extra = out.extra as Record<string, unknown>;
      const d = definitions($);
      const service = parsePrice(d.get('servicekosten p.m.') ?? '').priceEur;
      if (service) out.serviceCostsEur = service;
      const available = d.get('beschikbaar vanaf');
      const date = available ? parseDutchDate(available, ctx.now()) : undefined;
      if (date) out.availableFrom = date;
      const label = /^Energielabel\s+([A-G]\+*)/i.exec(`Energielabel ${d.get('energielabel') ?? ''}`)?.[1];
      if (label) out.energyLabel = label.toUpperCase();
      const deposit = d.get('borg');
      if (deposit) extra.deposit = deposit;
      const floor = d.get('verdieping');
      if (floor) extra.floor = floor;
      const heading = $('h2')
        .filter((_, h) => /korte omschrijving/i.test($(h).text()))
        .first();
      const description = clean(heading.parent().next().text());
      if (description) out.description = description;
      // "Kan ik deze woning huren?": the gross monthly income Vesteda asks for, one earner and two.
      const incomes: { eur: number; label: string }[] = [];
      $('.u-heading')
        .filter((_, el) => /€/.test($(el).text()))
        .each((_, el) => {
          const eur = parsePrice($(el).text()).priceEur;
          const label = clean($(el).closest('div').find('.u-milli').text());
          if (eur && /bruto/i.test(label)) incomes.push({ eur, label });
        });
      const single = incomes.find((i) => /één|een inkomen|one income/i.test(i.label)) ?? incomes[0];
      const two = incomes.find((i) => /tweeverdieners|two/i.test(i.label));
      if (single) {
        const requirements: Requirements = { minIncomeEur: single.eur };
        if (out.priceEur) requirements.incomeMultiple = Math.round((single.eur / out.priceEur) * 10) / 10;
        extra.requirements = requirements;
        extra.minIncomeEur = single.eur;
      }
      if (two) extra.minIncomeTwoEarnersEur = two.eur;
      return out;
    },

    async isAvailable(listing, ctx) {
      let page;
      try {
        page = await unitPage(listing.url, ctx);
      } catch (e) {
        if (e instanceof SourceHttpError && (e.status === 404 || e.status === 410)) return false;
        throw e;
      }
      // A unit that is gone redirects to its complex or the search page.
      if (new URL(page.finalUrl).pathname !== new URL(listing.url).pathname) return false;
      // An open unit says "Deze woning is te huur" in its availability block.
      const text = clean(page.$('body').text());
      return !/Deze woning is (verhuurd|gereserveerd|niet meer beschikbaar)/i.test(text);
    },
  };
  return adapter;
}

export const vesteda = createVestedaAdapter();

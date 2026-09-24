import type { Address, Store } from '@nlpf/core';
import { formatPostcode, normCity, normPostcode, normStreet, splitHouseNumber } from './cluster.js';

/**
 * JSON over HTTP, injected so tests answer from recorded fixtures. The
 * optional headers carry API keys (EP-Online wants one in `Authorization`).
 * It should throw on network errors and non-2xx responses.
 */
export type FetchJson = (url: string, init?: { headers?: Record<string, string> }) => Promise<unknown>;

/** One address as PDOK Locatieserver knows it, plus the BAG ids the fact lookup needs. */
export interface PdokAddress {
  street: string;
  houseNumber: string;
  addition?: string;
  postcode: string;
  city: string;
  municipality: string;
  neighbourhood?: string;
  lat?: number;
  lon?: number;
  vboId?: string; // adresseerbaarobject_id, the BAG verblijfsobject
  numId?: string; // nummeraanduiding_id, used by the WOZ-waardeloket
}

const LOCATIESERVER = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';

function queryNumber(addr: Address): string | undefined {
  const { number, addition } = splitHouseNumber(addr.houseNumber, addr.addition);
  if (!number) return undefined;
  if (!addition) return number;
  return /^[a-z]$/.test(addition) ? `${number}${addition.toUpperCase()}` : `${number}-${addition}`;
}

/** The PDOK Locatieserver free-search URL for an address, or undefined when it has no house number to look up. */
export function pdokQueryUrl(addr: Address, opts: { withPostcode?: boolean } = {}): string | undefined {
  const num = queryNumber(addr);
  const pc = opts.withPostcode === false ? undefined : normPostcode(addr.postcode);
  if (!num || (!addr.street && !pc)) return undefined;
  const q = [addr.street?.trim(), num, pc, addr.city?.trim()].filter(Boolean).join(' ');
  return `${LOCATIESERVER}?q=${encodeURIComponent(q)}&fq=type:adres&rows=1`;
}

interface PdokDoc {
  straatnaam?: string;
  huisnummer?: number;
  huisletter?: string;
  huisnummertoevoeging?: string;
  postcode?: string;
  woonplaatsnaam?: string;
  gemeentenaam?: string;
  buurtnaam?: string;
  centroide_ll?: string;
  adresseerbaarobject_id?: string;
  nummeraanduiding_id?: string;
}

function toPdokAddress(doc: PdokDoc): PdokAddress | undefined {
  if (!doc.straatnaam || doc.huisnummer === undefined || !doc.postcode || !doc.woonplaatsnaam)
    return undefined;
  const point = /POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/.exec(doc.centroide_ll ?? '');
  const addition = [doc.huisletter, doc.huisnummertoevoeging].filter(Boolean).join('-') || undefined;
  return {
    street: doc.straatnaam,
    houseNumber: String(doc.huisnummer),
    addition,
    postcode: formatPostcode(doc.postcode) ?? doc.postcode,
    city: doc.woonplaatsnaam,
    municipality: doc.gemeentenaam ?? doc.woonplaatsnaam,
    neighbourhood: doc.buurtnaam,
    lon: point ? Number(point[1]) : undefined,
    lat: point ? Number(point[2]) : undefined,
    vboId: doc.adresseerbaarobject_id,
    numId: doc.nummeraanduiding_id,
  };
}

/** PDOK ranks fuzzy text hits, so a hit is only used when it is the same street (or postcode) and house number. */
function matches(addr: Address, hit: PdokAddress): boolean {
  const { number } = splitHouseNumber(addr.houseNumber, addr.addition);
  if (hit.houseNumber !== number) return false;
  if (addr.street) {
    if (normStreet(addr.street) !== normStreet(hit.street)) return false;
  } else if (normPostcode(addr.postcode) !== normPostcode(hit.postcode)) return false;
  if (addr.city) {
    const c = normCity(addr.city);
    if (c !== normCity(hit.city) && c !== normCity(hit.municipality)) return false;
  }
  return true;
}

async function lookupUrl(url: string, store: Store, fetchJson: FetchJson): Promise<PdokAddress | null> {
  const cacheKey = `pdok:${url}`;
  const cached = store.geocode.get(cacheKey);
  if (cached !== undefined) return cached as PdokAddress | null;
  const body = (await fetchJson(url)) as { response?: { docs?: PdokDoc[] } };
  const doc = body.response?.docs?.[0];
  const hit = (doc && toPdokAddress(doc)) ?? null;
  store.geocode.put(cacheKey, hit, new Date().toISOString());
  return hit;
}

/**
 * Looks an address up in PDOK Locatieserver, retrying without the postcode
 * when the postcode led to a different house. Returns null for a confirmed
 * miss. Network errors propagate, so callers decide whether to retry later.
 */
export async function pdokLookup(
  addr: Address,
  deps: { store: Store; fetchJson: FetchJson },
): Promise<PdokAddress | null> {
  const first = pdokQueryUrl(addr);
  if (!first) return null;
  const hit = await lookupUrl(first, deps.store, deps.fetchJson);
  if (hit && matches(addr, hit)) return hit;
  if (!normPostcode(addr.postcode) || !addr.street) return null;
  const retry = pdokQueryUrl(addr, { withPostcode: false });
  if (!retry || retry === first) return null;
  const second = await lookupUrl(retry, deps.store, deps.fetchJson);
  return second && matches({ ...addr, postcode: undefined }, second) ? second : null;
}

/** Merges an official PDOK address into a listing address without inventing an addition the listing did not name. */
export function applyPdok(addr: Address, hit: PdokAddress): Address {
  const { addition } = splitHouseNumber(addr.houseNumber, addr.addition);
  const hitAddition = splitHouseNumber(hit.houseNumber, hit.addition).addition;
  const out: Address = {
    ...addr,
    street: hit.street,
    houseNumber: hit.houseNumber,
    postcode: hit.postcode,
    city: hit.city,
    municipality: hit.municipality,
  };
  if (addition && addition === hitAddition) out.addition = hit.addition;
  else if (addition) out.addition = /^[a-z]$/.test(addition) ? addition.toUpperCase() : addition;
  else delete out.addition;
  if (hit.neighbourhood) out.neighbourhood = hit.neighbourhood;
  if (hit.lat !== undefined && hit.lon !== undefined) {
    out.lat = hit.lat;
    out.lon = hit.lon;
  }
  return out;
}

/**
 * Geocoder backed by PDOK Locatieserver (free, no key) and cached in
 * `store.geocode`. A failed request leaves the address unchanged and is not
 * cached; a confirmed miss is cached so it is not asked again.
 */
export function createGeocoder(
  store: Store,
  fetchJson: FetchJson,
): { geocode(addr: Address): Promise<Address> } {
  return {
    async geocode(addr) {
      try {
        const hit = await pdokLookup(addr, { store, fetchJson });
        return hit ? applyPdok(addr, hit) : addr;
      } catch {
        return addr;
      }
    },
  };
}

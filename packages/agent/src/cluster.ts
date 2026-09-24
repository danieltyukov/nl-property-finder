import { newId, type Address, type Listing, type Property, type Store } from '@nlpf/core';
import { fold, squash } from './text.js';

/*
 * Clustering decides which listings are the same home. A property is
 * contacted at most once, so a missed join means a landlord gets two
 * messages and a wrong join means a home is never contacted. The rules
 * below prefer an exact address and only fall back to price and size when
 * one side has no house number.
 */

const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8' };

/** Canonical addition: lowercase, no dashes or spaces, common Dutch floor notations unified. */
export function normAddition(raw: string | undefined): string {
  let a = squash(raw ?? '');
  if (!a) return '';
  if (a in ROMAN) return ROMAN[a]!;
  if (a === 'huis' || a === 'hs' || a === 'h') return 'h';
  const floor = /^(\d+)(hg|hoog|e|ste|de)$/.exec(a);
  if (floor) a = String(Number(floor[1]));
  return a;
}

/** Splits "12-A", "12A", "12 a", "123-III" into a number and a canonical addition. */
export function splitHouseNumber(houseNumber: string | undefined, addition?: string): { number: string | undefined; addition: string } {
  const hn = fold(houseNumber ?? '').trim();
  const m = /^(\d+)\s*[-/]?\s*(.*)$/.exec(hn);
  if (!m) return { number: undefined, addition: normAddition(addition) };
  const rest = [m[2], addition].filter((x) => x && x.trim()).join(' ');
  return { number: String(Number(m[1])), addition: normAddition(rest) };
}

const STREET_ABBREVIATIONS: Record<string, string> = {
  burg: 'burgemeester', v: 'van', st: 'sint', ln: 'laan', pl: 'plein', prof: 'professor', dr: 'doctor',
  mr: 'meester', jhr: 'jonkheer', gen: 'generaal', pr: 'prins', kon: 'koning', w: 'west', o: 'oost', z: 'zuid', n: 'noord',
};

/** "Burg. Jamessingel" and "Burgemeester Jamessingel" both become "burgemeesterjamessingel". */
export function normStreet(street: string): string {
  const tokens = fold(street).replace(/\./g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  return tokens
    .map((t) => STREET_ABBREVIATIONS[t] ?? t)
    .map((t) => (t.endsWith('str') ? `${t}aat` : t))
    .join('');
}

const CITY_ALIASES: Record<string, string> = { sgravenhage: 'denhaag', thehague: 'denhaag', shertogenbosch: 'denbosch' };

export function normCity(city: string): string {
  const c = squash(city);
  return CITY_ALIASES[c] ?? c;
}

/** "2611 bc" -> "2611BC", or undefined when it is not a Dutch postcode. */
export function normPostcode(pc: string | undefined): string | undefined {
  const m = /^\s*([1-9]\d{3})\s*([a-zA-Z]{2})\s*$/.exec(pc ?? '');
  return m ? `${m[1]}${m[2]!.toUpperCase()}` : undefined;
}

/** "2611BC" -> "2611 BC", the way people write it. */
export function formatPostcode(pc: string | undefined): string | undefined {
  const n = normPostcode(pc);
  return n ? `${n.slice(0, 4)} ${n.slice(4)}` : undefined;
}

const TITLE_STOPWORDS = new Set([
  'in', 'de', 'het', 'een', 'te', 'huur', 'for', 'rent', 'the', 'a', 'an', 'of', 'met', 'en', 'and', 'to', 'per', 'aan', 'op', 'with', 'at', 'on',
]);

function titleWords(title: string): string {
  return fold(title)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !TITLE_STOPWORDS.has(w))
    .slice(0, 4)
    .join('-');
}

const band = (v: number | undefined, size: number): string => (v === undefined ? 'x' : String(Math.floor(v / size) * size));

/**
 * The cluster key of an address: `pc:` when postcode and number are known,
 * `addr:` when street and number are known, otherwise a fingerprint `fp:` of
 * city, street or title words, a 50 euro price band and a 5 m2 size band.
 */
export function clusterKey(addr: Address, fallback: { title: string; priceEur?: number; sizeM2?: number }): string {
  const { number, addition } = splitHouseNumber(addr.houseNumber, addr.addition);
  const pc = normPostcode(addr.postcode);
  if (pc && number) return `pc:${pc}:${number}:${addition}`;
  const city = normCity(addr.city ?? addr.municipality ?? '');
  const street = addr.street ? normStreet(addr.street) : '';
  if (street && number) return `addr:${city}:${street}:${number}${addition}`;
  return `fp:${city}:${street || titleWords(fallback.title)}:${band(fallback.priceEur, 50)}:${band(fallback.sizeM2, 5)}`;
}

const keyRank = (key: string): number => (key.startsWith('pc:') ? 3 : key.startsWith('addr:') ? 2 : 1);

type Relation = 'same' | 'different' | 'partial' | 'unknown';

/**
 * How two addresses relate. `partial` means street and number agree but only
 * one side names an addition; `unknown` means at least one side has no number.
 */
export function addressRelation(a: Address, b: Address): Relation {
  const na = splitHouseNumber(a.houseNumber, a.addition);
  const nb = splitHouseNumber(b.houseNumber, b.addition);
  if (!na.number || !nb.number) return 'unknown';
  if (na.number !== nb.number) return 'different';
  const ca = a.city ? normCity(a.city) : '';
  const cb = b.city ? normCity(b.city) : '';
  if (ca && cb && ca !== cb) return 'different';
  const sa = a.street ? normStreet(a.street) : '';
  const sb = b.street ? normStreet(b.street) : '';
  if (sa && sb) {
    if (sa !== sb) return 'different';
  } else {
    // Without both streets, only an equal postcode ties the numbers together.
    const pa = normPostcode(a.postcode);
    const pb = normPostcode(b.postcode);
    if (!pa || !pb) return 'unknown';
    if (pa !== pb) return 'different';
  }
  if (na.addition && nb.addition) return na.addition === nb.addition ? 'same' : 'different';
  return na.addition === nb.addition ? 'same' : 'partial';
}

const within = (a: number | undefined, b: number | undefined, test: (a: number, b: number) => boolean): boolean | undefined =>
  a === undefined || b === undefined ? undefined : test(a, b);
const priceClose = (a?: number, b?: number) => within(a, b, (x, y) => Math.abs(x - y) <= 0.05 * Math.max(x, y));
const sizeClose = (a?: number, b?: number) => within(a, b, (x, y) => Math.abs(x - y) <= 3);

function fuzzyMatch(listing: Listing, p: Property, rel: Relation): boolean {
  if (rel === 'partial') return priceClose(listing.priceEur, p.priceEur) !== false && sizeClose(listing.sizeM2, p.sizeM2) !== false;
  if (rel !== 'unknown') return false;
  const pa = normPostcode(listing.address.postcode);
  if (!pa || pa !== normPostcode(p.address.postcode)) return false;
  if (listing.type && p.type && listing.type !== p.type) return false;
  return priceClose(listing.priceEur, p.priceEur) === true && sizeClose(listing.sizeM2, p.sizeM2) !== false;
}

/** Two different adverts on one platform are normally two homes, so fuzzy joins never merge them. */
function hasOtherListingFromSource(store: Store, propertyId: string, listing: Listing): boolean {
  return store.listings.list({ propertyId, sourceId: listing.sourceId, limit: 50 }).some((l) => l.id !== listing.id);
}

/** Postcode as "2611 BC", house number digits only, addition split off ("A", "bis", "3"). */
export function canonicalAddress(addr: Address): Address {
  const out: Address = { ...addr };
  const pc = formatPostcode(addr.postcode);
  if (pc) out.postcode = pc;
  else delete out.postcode;
  const { number, addition } = splitHouseNumber(addr.houseNumber, addr.addition);
  if (number) {
    out.houseNumber = number;
    if (addition) out.addition = addition.length === 1 && /[a-z]/.test(addition) ? addition.toUpperCase() : addition;
    else delete out.addition;
  }
  return out;
}

function mergeAddress(into: Address, from: Address): Address {
  const out: Address = canonicalAddress(into);
  const src = canonicalAddress(from);
  const sameNumber = !out.houseNumber || out.houseNumber === src.houseNumber;
  for (const [k, v] of Object.entries(src) as [keyof Address, Address[keyof Address]][]) {
    if (k === 'addition' && !sameNumber) continue;
    if (v !== undefined && v !== '' && (out[k] === undefined || out[k] === '')) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function attach(store: Store, listing: Listing, property: Property, key: string, now: string): Property {
  const patch: Partial<Property> = { address: mergeAddress(property.address, listing.address) };
  const upgraded = clusterKey(patch.address!, property);
  if (keyRank(upgraded) > keyRank(property.key) && !store.properties.byKey(upgraded)) patch.key = upgraded;
  else if (keyRank(key) > keyRank(property.key) && !store.properties.byKey(key)) patch.key = key;
  if (property.priceEur === undefined && listing.priceEur !== undefined) patch.priceEur = listing.priceEur;
  if (property.sizeM2 === undefined && listing.sizeM2 !== undefined) patch.sizeM2 = listing.sizeM2;
  if (property.type === undefined && listing.type !== undefined) patch.type = listing.type;
  const updated = store.properties.update(property.id, patch, now);
  store.listings.setProperty(listing.id, updated.id);
  return updated;
}

/**
 * Finds the property a listing belongs to, or creates one. Order: exact
 * cluster key; then a stored property at the same street and number (with
 * the same addition, or a missing addition and a close price); then, when one
 * side has no house number, the same postcode with a price within 5% and a
 * size within 3 m2. A different house number or addition never joins.
 */
export function assignProperty(store: Store, listing: Listing, now: string): { property: Property; created: boolean } {
  return store.tx(() => {
    const key = clusterKey(listing.address, listing);
    const exact = store.properties.byKey(key);
    const fingerprint = key.startsWith('fp:');
    if (exact && !(fingerprint && hasOtherListingFromSource(store, exact.id, listing))) {
      return { property: attach(store, listing, exact, key, now), created: false };
    }

    const a = listing.address;
    const pool = new Map<string, Property>();
    const add = (ps: Property[]) => ps.forEach((p) => pool.set(p.id, p));
    add(store.properties.candidates({ postcode: formatPostcode(a.postcode), city: a.city, priceEur: listing.priceEur, sizeM2: listing.sizeM2 }));
    if (a.street) add(store.properties.list({ q: a.street, limit: 200 }));
    if (a.city) add(store.properties.list({ q: a.city, limit: 200 }));

    let best: { p: Property; score: number } | undefined;
    for (const p of pool.values()) {
      const rel = addressRelation(a, p.address);
      if (rel === 'different') continue;
      let score: number;
      if (rel === 'same') score = 3;
      else if (fuzzyMatch(listing, p, rel) && !hasOtherListingFromSource(store, p.id, listing)) {
        const diff = listing.priceEur !== undefined && p.priceEur !== undefined ? Math.abs(listing.priceEur - p.priceEur) / p.priceEur : 0;
        score = (rel === 'partial' ? 2 : 1) - diff;
      } else continue;
      if (!best || score > best.score) best = { p, score };
    }
    if (best) return { property: attach(store, listing, best.p, key, now), created: false };

    const property = store.properties.create(
      {
        id: newId('p'),
        key: store.properties.byKey(key) ? `${key}~${newId('k').slice(-6)}` : key,
        address: canonicalAddress(listing.address),
        title: listing.title,
        priceEur: listing.priceEur,
        sizeM2: listing.sizeM2,
        type: listing.type,
      },
      now,
    );
    store.listings.setProperty(listing.id, property.id);
    return { property, created: true };
  });
}

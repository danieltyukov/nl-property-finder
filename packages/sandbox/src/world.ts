import type { Furnishing, Lang, PropertyType } from '@nlpf/core';
import catalogueFile from '../data/listings.json' with { type: 'json' };
import { localDay, longDate, ymd } from './dates.js';
import { rngFor, type Rng } from './rng.js';
import {
  REPLY_KINDS,
  type Landlord,
  type ListingInput,
  type ListingStatus,
  type ReplyKind,
  type SandboxListing,
  type Scenario,
  type SourceName,
  type Submission,
} from './types.js';

/** One entry of `data/listings.json`. Dates are relative to the moment the listing goes online. */
export interface CatalogueEntry {
  id: string;
  key: string;
  source: SourceName;
  duplicateOf?: string;
  city: string;
  street: string;
  houseNumber: string;
  addition?: string;
  postcode: string;
  addressText: string;
  title?: string;
  lat: number;
  lon: number;
  type: PropertyType;
  furnishing: Exclude<Furnishing, 'unknown'>;
  priceEur: number;
  priceBasis: 'excl' | 'incl';
  serviceCostsEur?: number;
  depositEur?: number;
  sizeM2: number;
  rooms: number;
  bedrooms: number;
  energyLabel?: string;
  availableInDays: number;
  publishedHoursAgo: number;
  language: Lang;
  description: string;
  landlord: Landlord;
  status?: ListingStatus;
  scenarios?: Scenario[];
  script: ReplyKind[];
}

/** The 30 listings in `data/listings.json`, in file order. */
export const CATALOGUE: readonly CatalogueEntry[] = (catalogueFile as { listings: CatalogueEntry[] })
  .listings;

/**
 * Five catalogue listings that make the dashboard look alive right away in
 * demo mode: a Delft apartment that matches and gets contacted, a Rotterdam
 * apartment whose agent asks a question first, a Den Haag flat that says
 * "geen studenten", an English Delft studio, and a Delft house above budget.
 * Pass them as `startSandbox({ listings: demoSeed() })` or to `control.addListing`.
 */
export function demoSeed(): ListingInput[] {
  return [
    { key: 'delft-tulpgracht-12a' },
    { key: 'rotterdam-havenlichtweg-3' },
    { key: 'den-haag-helmgrasweg-38-no-students' },
    { key: 'delft-zeepziedersteeg-7' },
    { key: 'delft-pottenbakkerssingel-140' },
  ];
}

/* ---------- places and people for generated listings ---------- */

interface Place {
  city: string;
  pc4: [number, number];
  lat: number;
  lon: number;
  streets: string[];
}

const PLACES: Record<string, Place> = {
  delft: {
    city: 'Delft',
    pc4: [2611, 2629],
    lat: 52.0116,
    lon: 4.3571,
    streets: [
      'Klokkengieterslaan',
      'Schuitenmakerskade',
      'Tegelbakkerspad',
      'Touwslagershof',
      'Kuipersgracht',
    ],
  },
  rotterdam: {
    city: 'Rotterdam',
    pc4: [3011, 3089],
    lat: 51.9225,
    lon: 4.4792,
    streets: ['Sleepbootkade', 'Ketelmakersstraat', 'Kadeloperslaan', 'Meerpaalstraat', 'Stuwadoorsweg'],
  },
  'den haag': {
    city: 'Den Haag',
    pc4: [2491, 2599],
    lat: 52.0705,
    lon: 4.3007,
    streets: ['Zeereepstraat', 'Stuifzandweg', 'Golfslagkade', 'Kwelderstraat', 'Schelpenpad'],
  },
};

const placeFor = (city: string): Place => {
  const k = city
    .trim()
    .toLowerCase()
    .replace(/^'s-gravenhage$/, 'den haag');
  return (
    PLACES[k] ?? {
      city: city.trim(),
      pc4: [1011, 9999],
      lat: 52.1,
      lon: 5.1,
      streets: ['Dorpsstraat', 'Kerkweg', 'Molenlaan'],
    }
  );
};

const POSTCODE_LETTERS = [
  'AB',
  'AK',
  'BC',
  'BL',
  'CD',
  'CM',
  'DE',
  'EH',
  'GP',
  'HT',
  'JK',
  'KL',
  'LN',
  'MR',
  'NB',
  'PX',
  'RT',
  'VW',
  'XE',
  'ZG',
];

const PRIVATE_LANDLORDS: [string, string][] = [
  ['Mila Hendriks', 'hendriks-verhuur'],
  ['Jeroen Vos', 'vos-woningen'],
  ['Sophie van Leeuwen', 'vanleeuwen-kamers'],
  ['Omar Haddou', 'haddou-verhuur'],
  ['Iris de Graaf', 'degraaf-wonen'],
  ['Tim Dekker', 'dekker-beheer'],
];
const AGENTS = ['Eva Brouwer', 'Thijs Kok'];
export const GRACHT_EMAIL = 'verhuur@degracht.example';

function privateLandlord(name: string, domain: string): Landlord {
  return { name, email: `${name.split(' ')[0]!.toLowerCase()}@${domain}.example`, kind: 'particulier' };
}

const TYPE_WORDS: Record<PropertyType, [string, string]> = {
  apartment: ['appartement', 'apartment'],
  studio: ['studio', 'studio'],
  room: ['kamer', 'room'],
  house: ['eengezinswoning', 'family house'],
  other: ['woning', 'home'],
};
const FURNISHING_WORDS: Record<Exclude<Furnishing, 'unknown'>, [string, string]> = {
  unfurnished: ['Kaal opgeleverd', 'Unfurnished'],
  upholstered: ['Gestoffeerd', 'Upholstered'],
  furnished: ['Gemeubileerd', 'Furnished'],
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "€ 1.175" in Dutch, "€1,175" in English. */
export function euros(amount: number, lang: Lang): string {
  const n = Math.round(amount);
  return lang === 'nl' ? `€ ${n.toLocaleString('nl-NL')}` : `€${n.toLocaleString('en-GB')}`;
}

/** The ways people write "12" with addition "A": "12-A", "12A", "12 a", "12-a". */
export function addressSpellings(street: string, number: string, addition?: string): string[] {
  if (!addition) return [`${street} ${number}`];
  const a = addition;
  const lower = a.toLowerCase();
  if (a.length > 1)
    return [`${street} ${number} ${lower}`, `${street} ${number}-${lower}`, `${street} ${number}${lower}`];
  return [
    `${street} ${number}-${a.toUpperCase()}`,
    `${street} ${number}${a.toUpperCase()}`,
    `${street} ${number} ${lower}`,
    `${street} ${number}-${lower}`,
  ];
}

/* ---------- the world ---------- */

export interface WorldOptions {
  seed: number;
  now: () => Date;
}

/**
 * Everything the fake Netherlands holds: listings on both sources and every
 * submission with its conversation. The HTTP handlers and `Control` read and
 * change it; nothing else keeps state.
 */
export class World {
  readonly seed: number;
  readonly now: () => Date;
  private listingMap = new Map<string, SandboxListing>();
  private submissionMap = new Map<string, Submission>();
  private counters = new Map<string, number>();

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.now = opts.now;
  }

  /** The next number in a named sequence, starting at `start`. Ids depend only on the order of events. */
  next(name: string, start = 1): number {
    const n = this.counters.get(name) ?? start;
    this.counters.set(name, n + 1);
    return n;
  }

  /**
   * Forgets every listing and submission. Counters keep running, so a daemon
   * that saw earlier threads and messages never mistakes new ones for them.
   */
  clear(): void {
    this.listingMap.clear();
    this.submissionMap.clear();
  }

  /** Listings newest first. Removed ones only with `includeRemoved`. */
  listings(opts: { source?: SourceName; includeRemoved?: boolean } = {}): SandboxListing[] {
    return [...this.listingMap.values()]
      .filter((l) => (opts.source ? l.source === opts.source : true) && (opts.includeRemoved || !l.removed))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  }

  listing(id: string): SandboxListing | undefined {
    return this.listingMap.get(id);
  }

  /** A listing that is online and still for rent. */
  available(id: string): SandboxListing | undefined {
    const l = this.listingMap.get(id);
    return l && !l.removed && l.status === 'available' ? l : undefined;
  }

  byKey(key: string): SandboxListing | undefined {
    return [...this.listingMap.values()].find((l) => l.key === key);
  }

  /** Takes a listing offline (404), or marks it rented so the agency shows "Verhuurd". */
  remove(id: string, how: 'removed' | 'rented' = 'removed'): boolean {
    const l = this.listingMap.get(id);
    if (!l) return false;
    if (how === 'rented') l.status = 'rented';
    else l.removed = true;
    return true;
  }

  submissions(): Submission[] {
    return [...this.submissionMap.values()];
  }

  submission(id: string): Submission | undefined {
    return this.submissionMap.get(id);
  }

  submissionByThread(threadId: string): Submission | undefined {
    return [...this.submissionMap.values()].find((s) => s.threadId === threadId);
  }

  addSubmission(s: Submission): void {
    this.submissionMap.set(s.id, s);
  }

  /** Builds a listing from `input` and puts it online. Throws on an unknown key or duplicate id. */
  add(input: ListingInput = {}): SandboxListing {
    const listing = this.build(input);
    if (this.listingMap.has(listing.id)) throw new Error(`listing ${listing.id} already exists`);
    this.listingMap.set(listing.id, listing);
    return listing;
  }

  private build(input: ListingInput): SandboxListing {
    const now = this.now();
    if (input.key) {
      const entry = CATALOGUE.find((e) => e.key === input.key);
      if (!entry) throw new Error(`no catalogue listing with key "${input.key}"`);
      if (this.byKey(entry.key)) throw new Error(`catalogue listing "${entry.key}" is already online`);
      const { key: _key, ...rest } = input;
      return this.merge(fromCatalogue(entry, now, this.catalogueDuplicateId(entry)), rest);
    }
    if (input.duplicateOf) {
      const original = this.listingMap.get(input.duplicateOf) ?? this.byKey(input.duplicateOf);
      if (!original) throw new Error(`no listing "${input.duplicateOf}" to copy`);
      const n = this.next('generated');
      const { duplicateOf: _d, ...rest } = input;
      return this.merge(
        duplicateListing(
          original,
          this.newId(rest.source ?? other(original.source)),
          `gen-${n}`,
          now,
          rngFor(this.seed, `dup:${n}`),
        ),
        rest,
      );
    }
    const n = this.next('generated');
    const source = input.source ?? 'huisje';
    const base = generateListing({
      id: input.id ?? this.newId(source),
      key: `gen-${n}`,
      source,
      city: input.city ?? 'Delft',
      type: input.type,
      scenario: input.scenario,
      language: input.language,
      now,
      rng: rngFor(this.seed, `listing:${n}`),
      taken: (street, number) =>
        this.listings({ includeRemoved: true }).some((l) => l.street === street && l.houseNumber === number),
    });
    const { scenario: _s, ...rest } = input;
    return this.merge(base, rest);
  }

  /** The id of the catalogue copy this entry duplicates, when that copy is online. */
  private catalogueDuplicateId(entry: CatalogueEntry): string | undefined {
    return entry.duplicateOf ? this.byKey(entry.duplicateOf)?.id : undefined;
  }

  private newId(source: SourceName): string {
    return source === 'huisje' ? `hj-${this.next('hj', 1501)}` : `dg-${this.next('dg', 2501)}`;
  }

  /** Applies explicit fields over a built listing, keeping the address text consistent. */
  private merge(base: SandboxListing, input: ListingInput): SandboxListing {
    const out: SandboxListing = { ...base };
    const set = <K extends keyof SandboxListing>(k: K, v: SandboxListing[K] | undefined) => {
      if (v !== undefined) out[k] = v;
    };
    const addressChanged =
      input.street !== undefined || input.houseNumber !== undefined || input.addition !== undefined;
    set('id', input.id);
    set('source', input.source);
    set('street', input.street);
    set('houseNumber', input.houseNumber);
    if (input.addition !== undefined) out.addition = input.addition || undefined;
    set('postcode', input.postcode);
    set('city', input.city);
    set('lat', input.lat);
    set('lon', input.lon);
    set('priceEur', input.priceEur);
    set('priceBasis', input.priceBasis);
    set('serviceCostsEur', input.serviceCostsEur);
    set('depositEur', input.depositEur);
    set('sizeM2', input.sizeM2);
    set('rooms', input.rooms);
    set('bedrooms', input.bedrooms);
    set('type', input.type);
    set('furnishing', input.furnishing);
    set('energyLabel', input.energyLabel);
    set('availableFrom', input.availableFrom);
    set('publishedAt', input.publishedAt);
    set('language', input.language);
    set('description', input.description);
    set('landlord', input.landlord);
    set('status', input.status);
    if (input.script)
      out.script = input.script.filter((k): k is ReplyKind => (REPLY_KINDS as readonly string[]).includes(k));
    out.addressText =
      input.addressText ??
      (addressChanged ? addressSpellings(out.street, out.houseNumber, out.addition)[0]! : out.addressText);
    out.title =
      input.title ?? (addressChanged || input.type || input.addressText ? titleFor(out) : out.title);
    if (out.source === 'gracht' && out.landlord.kind !== 'makelaar') {
      out.landlord = { name: AGENTS[0]!, email: GRACHT_EMAIL, kind: 'makelaar' };
    }
    return out;
  }
}

const other = (s: SourceName): SourceName => (s === 'huisje' ? 'gracht' : 'huisje');

/** Huisje titles name the type and street; De Gracht titles are the address as written. */
function titleFor(
  l: Pick<SandboxListing, 'source' | 'type' | 'street' | 'addressText' | 'language'>,
): string {
  if (l.source === 'gracht') return l.addressText;
  const [nl, en] = TYPE_WORDS[l.type];
  return l.language === 'en' ? `${cap(en)} ${l.street}` : `${cap(nl)} ${l.street}`;
}

function fromCatalogue(e: CatalogueEntry, now: Date, duplicateId: string | undefined): SandboxListing {
  const availableFrom = ymd(localDay(now, e.availableInDays));
  const listing: SandboxListing = {
    id: e.id,
    key: e.key,
    source: e.source,
    title: e.title ?? '',
    addressText: e.addressText,
    street: e.street,
    houseNumber: e.houseNumber,
    postcode: e.postcode,
    city: e.city,
    lat: e.lat,
    lon: e.lon,
    priceEur: e.priceEur,
    priceBasis: e.priceBasis,
    sizeM2: e.sizeM2,
    rooms: e.rooms,
    bedrooms: e.bedrooms,
    type: e.type,
    furnishing: e.furnishing,
    availableFrom,
    publishedAt: new Date(now.getTime() - e.publishedHoursAgo * 3_600_000).toISOString(),
    language: e.language,
    description: e.description.replaceAll('{available}', longDate(availableFrom, e.language)),
    landlord: { ...e.landlord },
    status: e.status ?? 'available',
    removed: false,
    scenarios: [...(e.scenarios ?? [])],
    script: [...e.script],
  };
  if (e.addition) listing.addition = e.addition;
  if (e.serviceCostsEur !== undefined) listing.serviceCostsEur = e.serviceCostsEur;
  if (e.depositEur !== undefined) listing.depositEur = e.depositEur;
  if (e.energyLabel) listing.energyLabel = e.energyLabel;
  if (duplicateId) listing.duplicateOf = duplicateId;
  if (!listing.title) listing.title = titleFor(listing);
  return listing;
}

/* ---------- generated listings ---------- */

interface GenerateInput {
  id: string;
  key: string;
  source: SourceName;
  city: string;
  type?: PropertyType;
  scenario?: Scenario;
  language?: Lang;
  now: Date;
  rng: Rng;
  taken(street: string, number: string): boolean;
}

const SIZE: Record<PropertyType, [number, number]> = {
  apartment: [42, 68],
  studio: [24, 34],
  room: [12, 20],
  house: [85, 120],
  other: [30, 60],
};
const PRICE: Record<PropertyType, [number, number]> = {
  apartment: [1025, 1250],
  studio: [800, 975],
  room: [500, 675],
  house: [1450, 1900],
  other: [900, 1200],
};

const step25 = (rng: Rng, [lo, hi]: [number, number]) => lo + 25 * rng.int(0, Math.floor((hi - lo) / 25));

const SCAM_TEXT =
  'Lovely furnished apartment in the centre, all bills included. I am currently working abroad, so I cannot show the apartment myself. ' +
  'Please transfer the deposit before the viewing and I will send you the keys by post. Contact me only via WhatsApp.';

/** A plausible listing: an upholstered two room apartment in Delft unless told otherwise, priced to pass a 1400 budget. */
export function generateListing(g: GenerateInput): SandboxListing {
  const { rng } = g;
  const place = placeFor(g.city);
  const scam = g.scenario === 'scam';
  const type: PropertyType = g.type ?? (g.scenario === 'no_registration' ? 'room' : 'apartment');
  const language: Lang = g.language ?? (scam ? 'en' : 'nl');
  const street = rng.pick(place.streets);
  let number = rng.int(2, 160);
  while (g.taken(street, String(number))) number++;
  const addition = rng.chance(0.2) ? rng.pick(['A', 'B', 'C']) : undefined;
  const postcode = `${rng.int(place.pc4[0], place.pc4[1])} ${rng.pick(POSTCODE_LETTERS)}`;
  const sizeM2 = scam ? rng.int(50, 60) : rng.int(...SIZE[type]);
  const priceEur = scam ? step25(rng, [395, 495]) : step25(rng, PRICE[type]);
  const shared = type === 'room' || type === 'studio' || scam;
  const priceBasis: 'excl' | 'incl' = shared ? 'incl' : 'excl';
  const furnishing: Exclude<Furnishing, 'unknown'> = scam
    ? 'furnished'
    : type === 'room'
      ? 'furnished'
      : rng.pick(['upholstered', 'upholstered', 'unfurnished', 'furnished'] as const);
  const rooms = type === 'room' || type === 'studio' ? 1 : type === 'house' ? rng.int(4, 5) : rng.int(2, 3);
  const bedrooms = type === 'studio' ? 0 : type === 'room' ? 1 : rooms - 1;
  const availableFrom = ymd(localDay(g.now, scam ? 0 : rng.int(7, 40)));
  const [typeNl, typeEn] = TYPE_WORDS[type];
  const [furnNl, furnEn] = FURNISHING_WORDS[furnishing];

  let description: string;
  if (scam) description = SCAM_TEXT;
  else if (language === 'en') {
    description =
      `${furnEn} ${typeEn} of ${sizeM2} m² in ${place.city}, a short bike ride from the centre. ` +
      (bedrooms > 0 && type !== 'room' ? `${bedrooms} bedroom${bedrooms > 1 ? 's' : ''}. ` : '') +
      `Available from ${longDate(availableFrom, 'en')}. ` +
      (priceBasis === 'incl' ? 'Rent includes service costs and utilities.' : 'Rent excludes service costs.');
  } else {
    description =
      `${furnNl} ${typeNl} van ${sizeM2} m² in ${place.city}, op fietsafstand van het centrum. ` +
      (bedrooms > 0 && type !== 'room' ? `${bedrooms} slaapkamer${bedrooms > 1 ? 's' : ''}. ` : '') +
      `Beschikbaar per ${longDate(availableFrom, 'nl')}. ` +
      (priceBasis === 'incl'
        ? 'Huur inclusief servicekosten en energie.'
        : 'Huurprijs exclusief servicekosten.');
  }
  if (g.scenario === 'no_students')
    description +=
      language === 'en'
        ? ' No students. Income requirement 3x the base rent.'
        : ' Geen studenten. Inkomenseis 3x de kale huur.';
  if (g.scenario === 'no_registration')
    description +=
      language === 'en'
        ? ' Registration at this address is not possible.'
        : ' Inschrijven op dit adres is niet mogelijk.';

  const landlord: Landlord =
    g.source === 'gracht'
      ? { name: rng.pick(AGENTS), email: GRACHT_EMAIL, kind: 'makelaar' }
      : scam
        ? { name: 'Daniel Parker', email: 'd.parker.rentals@mailbox.example', kind: 'particulier' }
        : privateLandlord(...rng.pick(PRIVATE_LANDLORDS));

  const listing: SandboxListing = {
    id: g.id,
    key: g.key,
    source: g.source,
    title: '',
    addressText: addressSpellings(street, String(number), addition)[0]!,
    street,
    houseNumber: String(number),
    postcode,
    city: place.city,
    lat: Math.round((place.lat + (rng.next() - 0.5) * 0.02) * 10_000) / 10_000,
    lon: Math.round((place.lon + (rng.next() - 0.5) * 0.03) * 10_000) / 10_000,
    priceEur,
    priceBasis,
    sizeM2,
    rooms,
    bedrooms,
    type,
    furnishing,
    energyLabel: rng.pick(['A', 'A', 'B', 'B', 'C', 'D']),
    availableFrom,
    publishedAt: g.now.toISOString(),
    language,
    description,
    landlord,
    status: 'available',
    removed: false,
    scenarios: g.scenario ? [g.scenario] : [],
    script: scam ? ['payment_request'] : ['viewing_slots'],
  };
  if (addition) listing.addition = addition;
  if (priceBasis === 'excl') listing.serviceCostsEur = 5 * rng.int(8, 16);
  if (!scam) listing.depositEur = listing.priceEur * (g.source === 'gracht' ? 2 : 1);
  listing.title = titleFor(listing);
  return listing;
}

/** The same home on the other source: same facts, the address written another way, the agency's own wording. */
function duplicateListing(
  original: SandboxListing,
  id: string,
  key: string,
  now: Date,
  rng: Rng,
): SandboxListing {
  const source = other(original.source);
  const spellings = addressSpellings(original.street, original.houseNumber, original.addition).filter(
    (s) => s !== original.addressText,
  );
  const addressText = spellings.length ? rng.pick(spellings) : original.addressText;
  const lang = original.language;
  const intro =
    source === 'gracht'
      ? lang === 'en'
        ? `Makelaardij De Gracht offers this home at ${addressText} for rent. `
        : `Makelaardij De Gracht biedt deze woning aan ${addressText} te huur aan. `
      : '';
  const copy: SandboxListing = {
    ...original,
    id,
    key,
    source,
    addressText,
    publishedAt: now.toISOString(),
    description: intro + original.description,
    landlord:
      source === 'gracht'
        ? { name: rng.pick(AGENTS), email: GRACHT_EMAIL, kind: 'makelaar' }
        : privateLandlord(...rng.pick(PRIVATE_LANDLORDS)),
    status: 'available',
    removed: false,
    scenarios: [...original.scenarios],
    script: [...original.script],
    duplicateOf: original.id,
  };
  copy.title = titleFor(copy);
  return copy;
}

/** Catalogue entries not online yet, in file order: what `drip` publishes next. */
export function heldCatalogue(world: World): CatalogueEntry[] {
  return CATALOGUE.filter((e) => !world.byKey(e.key));
}

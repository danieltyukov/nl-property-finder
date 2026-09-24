import { describe, expect, test } from 'vitest';
import { ConfigSchema, ProfileSchema, type Listing, type RawListing, type SourceAdapter } from '@nlpf/core';
import {
  OGONLINE_LIST_PATH,
  createOgonlineAdapter,
  ogonlineBasis,
  ogonlineObjectId,
  salutationOf,
  type OgonlineAgencyDef,
} from '../../src/generic/ogonline.js';
import { OGONLINE_AGENCIES } from '../../src/instances/ogonline-agencies.js';
import { fixtureContext } from '../../src/testing.js';

const NOW = new Date('2026-09-24T08:00:00Z');

const agency = (id: string): OgonlineAgencyDef => {
  const def = OGONLINE_AGENCIES.find((a) => a.id === id);
  if (!def) throw new Error(`no seed ${id}`);
  return def;
};

async function searchFixture(adapter: SourceAdapter, file: string, config?: Record<string, unknown>): Promise<RawListing[]> {
  const ctx = fixtureContext({ sourceId: adapter.id, routes: { [OGONLINE_LIST_PATH]: file }, now: NOW, config });
  const [req] = adapter.buildSearches(ctx.searches, ctx.source);
  return adapter.search(req!, ctx);
}

const asListing = (raw: RawListing): Listing => ({
  ...raw,
  id: `${raw.sourceId}:${raw.externalId}`,
  propertyId: null,
  firstSeenAt: '2026-09-24T08:00:00Z',
  lastSeenAt: '2026-09-24T08:00:00Z',
  state: 'active',
  via: 'poll',
});

const withMax = (priceMaxEur: number) => ({
  searches: [
    {
      id: 'main',
      name: 'Main',
      regions: [
        { name: 'Delft', municipalities: ['Delft'] },
        { name: 'Rotterdam', municipalities: ['Rotterdam'] },
        { name: 'Den Haag', municipalities: ['Den Haag'] },
      ],
      priceMaxEur,
    },
  ],
});

describe('OGonline agency adapter', () => {
  test('capabilities: no login, terms unknown, form or email per agency', () => {
    const form = createOgonlineAdapter(agency('verra'));
    expect(form.id).toBe('ogonline:verra');
    expect(form.capabilities).toEqual({ search: 'json', detail: false, contact: 'form', login: 'none', terms: 'unknown' });
    expect(typeof form.contact).toBe('function');
    expect(form.checkSession).toBeUndefined();
    const email = createOgonlineAdapter(agency('atrium'));
    expect(email.capabilities.contact).toBe('email');
    expect(email.contact).toBeUndefined();
  });

  test('search keeps available rentals and maps them', async () => {
    const adapter = createOgonlineAdapter(agency('verra'));
    const listings = await searchFixture(adapter, 'ogonline-verra/listings.json');
    expect(listings.map((l) => l.title)).toEqual([
      "'s-Gravenweg 659 U",
      "'s-Gravenweg 659 K",
      'Marcelisstraat 69',
      'Gevers Deynootstraat 94 A',
      'Industriestraat 232',
      'Rijksstraatweg 725',
      'Parkweg 322',
    ]);
    const [first] = listings;
    expect(first).toMatchObject({
      sourceId: 'ogonline:verra',
      externalId: '6996d72c12904169fbc0939f',
      url: 'https://www.verra.nl/nl/woningaanbod/woning/rotterdam/%27s-gravenweg-659-u/6996d72c12904169fbc0939f',
      contactUrl: 'https://www.verra.nl/nl/woningaanbod/woning/rotterdam/%27s-gravenweg-659-u/6996d72c12904169fbc0939f',
      priceEur: 2700,
      priceBasis: 'excl',
      sizeM2: 64,
      rooms: 3,
      bedrooms: 2,
      type: 'apartment',
      furnishing: 'furnished',
      address: { street: "'s-Gravenweg", houseNumber: '659', addition: 'U', postcode: '3065 SC', city: 'Rotterdam' },
      agent: { name: 'Verra Makelaars', url: 'https://www.verra.nl' },
      contact: 'form',
      language: 'nl',
      publishedAt: '2026-02-13T14:53:26.000Z',
      extra: { platform: 'ogonline', agency: 'verra', objectId: '6996d72c12904169fbc0939f' },
    });
    expect(first?.availableFrom).toBeUndefined();
    expect(first?.images?.[0]).toMatch(/^https:\/\/media02\.ogonline\.nl\//);
    const byTitle = Object.fromEntries(listings.map((l) => [l.title, l]));
    expect(byTitle['Industriestraat 232']).toMatchObject({ priceEur: 2295, priceBasis: 'incl', availableFrom: '2026-10-01', address: { city: 'Delft' } });
    expect(byTitle['Gevers Deynootstraat 94 A']?.availableFrom).toBe('2026-09-24');
    expect(byTitle['Marcelisstraat 69']?.type).toBe('house');
  });

  test('search skips parking, homes abroad and listings rented under reservation; reads combined sale and rent prices', async () => {
    const adapter = createOgonlineAdapter({ ...agency('bjornd'), regions: ['delft', 'den haag'] });
    const listings = await searchFixture(adapter, 'ogonline-edge-cases/listings.json');
    expect(listings.map((l) => l.title)).toEqual([
      'Gravin Margarethalaan 15 B',
      'De Vlouw 1 C 5',
      'Arthur van Schendelplein 169',
      'Plesmanduin Short Stay',
    ]);
    expect(listings[0]).toMatchObject({ priceEur: 6500, priceBasis: 'excl', type: 'house' });
    expect(listings[3]?.sizeM2).toBeUndefined();
    expect(listings[1]?.url).toBe('https://www.bjornd.nl/nl/woningaanbod/details/de-vlouw-1-c-5/699557cfd4b7c17fed79a57a');
  });

  test('email agencies carry the address and no form URL', async () => {
    const adapter = createOgonlineAdapter({ ...agency('atrium'), homepage: 'https://www.verra.nl' });
    const [first] = await searchFixture(adapter, 'ogonline-verra/listings.json');
    expect(first).toMatchObject({ contact: 'email', agent: { email: 'info@atrium-makelaars.nl' } });
    expect(first?.contactUrl).toBeUndefined();
  });

  test('buildSearches: one GET per poll that carries the filters; search applies them', async () => {
    const adapter = createOgonlineAdapter(agency('verra'));
    const config = ConfigSchema.parse(withMax(1400));
    expect(adapter.buildSearches(config.searches, { enabled: true, searchUrls: [], options: {} })).toEqual([
      {
        key: 'list',
        label: 'Verra Makelaars: rentals',
        url: 'https://www.verra.nl/nl/realtime-listings/consumer',
        params: { municipalities: 'delft,den haag,rotterdam', maxRentEur: 1400 },
      },
    ]);
    // Wassenaar is a municipality Verra rents in but no search wants; Voorburg
    // is a place name, not a municipality, so it is left for the pipeline.
    const wide = await searchFixture(adapter, 'ogonline-verra/listings.json', withMax(4000));
    expect(wide.map((l) => l.address.city)).toEqual(['Rotterdam', 'Rotterdam', 'Den Haag', 'Den Haag', 'Delft', 'Voorburg']);
    const cheap = await searchFixture(adapter, 'ogonline-verra/listings.json', withMax(2800));
    expect(cheap.map((l) => l.title)).toEqual(["'s-Gravenweg 659 U", 'Gevers Deynootstraat 94 A', 'Industriestraat 232']);
    const ctx = fixtureContext({ routes: { [OGONLINE_LIST_PATH]: 'ogonline-verra/listings.json' }, now: NOW });
    await adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx);
    expect(ctx.requests).toEqual([expect.objectContaining({ method: 'GET', url: 'https://www.verra.nl/nl/realtime-listings/consumer' })]);
  });

  test('isAvailable reads the list again: gone or rented is false', async () => {
    const adapter = createOgonlineAdapter(agency('verra'));
    const [first] = await searchFixture(adapter, 'ogonline-verra/listings.json');
    const listing = asListing(first!);
    const up = fixtureContext({ routes: { [OGONLINE_LIST_PATH]: 'ogonline-verra/listings.json' }, now: NOW });
    expect(await adapter.isAvailable!(listing, up)).toBe(true);
    const rented = fixtureContext({
      routes: [{ match: OGONLINE_LIST_PATH, body: [{ url: new URL(listing.url).pathname, isRentals: true, status: 'Verhuurd' }] }],
      now: NOW,
    });
    expect(await adapter.isAvailable!(listing, rented)).toBe(false);
    const gone = fixtureContext({ routes: [{ match: OGONLINE_LIST_PATH, body: [] }], now: NOW });
    expect(await adapter.isAvailable!(listing, gone)).toBe(false);
    const missing = fixtureContext({ routes: [{ match: OGONLINE_LIST_PATH, status: 404, body: 'not found' }], now: NOW });
    expect(await adapter.isAvailable!(listing, missing)).toBe(false);
  });

  test('a page instead of the list fails loudly', async () => {
    const adapter = createOgonlineAdapter(agency('verra'));
    const ctx = fixtureContext({ routes: [{ match: OGONLINE_LIST_PATH, body: { message: 'moved' } }], now: NOW });
    await expect(adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx)).rejects.toThrow(/did not answer with a list/);
  });
});

describe('OGonline seed list', () => {
  test('15 to 40 verified Randstad agencies with lowercase municipalities', () => {
    expect(OGONLINE_AGENCIES.length).toBeGreaterThanOrEqual(15);
    expect(OGONLINE_AGENCIES.length).toBeLessThanOrEqual(40);
    const ids = OGONLINE_AGENCIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of OGONLINE_AGENCIES) {
      expect(a.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(a.homepage).toMatch(/^https:\/\/[^/]+$/);
      expect(a.regions.length).toBeGreaterThan(0);
      for (const r of a.regions) expect(r).toBe(r.toLowerCase());
      expect(a.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (a.contact === 'email') expect(a.email).toMatch(/@/);
    }
    const covered = new Set(OGONLINE_AGENCIES.flatMap((a) => a.regions));
    for (const city of ['delft', 'rotterdam', 'den haag', 'leiden', 'utrecht', 'amsterdam']) expect(covered.has(city)).toBe(true);
  });
});

describe('OGonline helpers', () => {
  test('price basis from the price text', () => {
    expect(ogonlineBasis('&euro; 1.795 p.m. ex.')).toBe('excl');
    expect(ogonlineBasis('&euro; 2.295 p.m. inc.')).toBe('incl');
    expect(ogonlineBasis('&euro; 1.975.000 k.k. &mdash; &euro; 6.500 p.m. ex.')).toBe('excl');
    expect(ogonlineBasis('Prijs op aanvraag')).toBe('unknown');
  });

  test('object ids from listing URLs', () => {
    expect(ogonlineObjectId('https://www.bjornd.nl/nl/woningaanbod/details/de-vlouw-1-c-5/699557cfd4b7c17fed79a57a')).toBe('699557cfd4b7c17fed79a57a');
    expect(ogonlineObjectId('https://www.example.test/nl/aanbod/woning/')).toBeUndefined();
  });

  test('salutation from profile facts', () => {
    const profile = (facts: Record<string, string>) => ProfileSchema.parse({ facts });
    expect(salutationOf(profile({ salutation: 'Dhr.' }))).toBe('male');
    expect(salutationOf(profile({ aanhef: 'mevrouw' }))).toBe('female');
    expect(salutationOf(profile({ gender: 'Female' }))).toBe('female');
    expect(salutationOf(profile({}))).toBeUndefined();
  });
});

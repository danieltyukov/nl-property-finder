import { describe, expect, test } from 'vitest';
import { ConfigSchema, type Listing, type RawListing } from '@nlpf/core';
import { vesteda } from '../../src/adapters/vesteda.js';
import { fixtureContext, readFixture, type FixtureContextOptions } from '../../src/testing.js';

const config = ConfigSchema.parse({
  searches: [
    {
      id: 'main',
      name: 'Main',
      regions: [
        { name: 'Delft', municipalities: ['delft'] },
        { name: 'Rotterdam', municipalities: ['rotterdam'] },
        { name: 'Den Haag', municipalities: ['den haag'] },
      ],
      priceMaxEur: 1400,
    },
  ],
});

const API = 'https://www.vesteda.com/api/units/search/facet';

function ctxFor(routes: FixtureContextOptions['routes']) {
  return fixtureContext({ sourceId: 'vesteda', config, routes, now: new Date('2026-09-24T12:00:00Z') });
}

async function searchCity(
  m: string,
  file: string,
): Promise<{ listings: RawListing[]; body: Record<string, unknown> }> {
  const ctx = ctxFor([{ match: API, method: 'POST', file }]);
  const req = vesteda.buildSearches(ctx.searches, ctx.source).find((r) => r.params?.municipality === m);
  const listings = await vesteda.search(req!, ctx);
  return { listings, body: JSON.parse(ctx.requests[0]?.body ?? '{}') as Record<string, unknown> };
}

describe('vesteda adapter', () => {
  test('declares a JSON source whose reactions need a Vesteda account', () => {
    expect(vesteda.id).toBe('vesteda');
    expect(vesteda.regions).toBe('nl');
    expect(vesteda.defaultIntervalSec).toBe(60);
    expect(vesteda.capabilities).toEqual({
      search: 'json',
      detail: true,
      contact: 'form',
      login: 'required',
      terms: 'forbids',
    });
    expect(vesteda.loginUrl).toBe('https://hurenbij.vesteda.com/login/');
  });

  test('buildSearches sends each municipality with its centre, radius and the price range', async () => {
    const reqs = vesteda.buildSearches(config.searches, { enabled: true, searchUrls: [], options: {} });
    expect(reqs.map((r) => r.params?.place)).toEqual(['Delft', 'Rotterdam', 'Den Haag']);
    expect(reqs[0]?.params).toMatchObject({
      latitude: 52.0116,
      longitude: 4.3571,
      radius: 5,
      priceFrom: 500,
      priceTo: 1400,
    });
    const { body } = await searchCity('rotterdam', 'vesteda/search-rotterdam.json');
    expect(body).toMatchObject({
      place: 'Rotterdam',
      latitude: 51.9225,
      longitude: 4.4792,
      placeType: 1,
      radius: 10,
      sorting: 1,
      priceFrom: 500,
      priceTo: 1400,
      language: 'nl',
    });
  });

  test('searches for rooms only, or rent caps below 500, ask Vesteda nothing', () => {
    const cfg = ConfigSchema.parse({
      searches: [
        { id: 'r', name: 'Rooms', regions: [{ name: 'Delft', municipalities: ['delft'] }], types: ['room'] },
        { id: 'c', name: 'Cheap', regions: [{ name: 'Delft', municipalities: ['delft'] }], priceMaxEur: 450 },
      ],
    });
    expect(vesteda.buildSearches(cfg.searches, { enabled: true, searchUrls: [], options: {} })).toEqual([]);
  });

  test('search reads grouped results and keeps only units that are for rent', async () => {
    const { listings } = await searchCity('den haag', 'vesteda/search-den-haag.json');
    expect(listings.map((l) => l.externalId)).toEqual(['182105', '115']);
    expect(listings[0]).toMatchObject({
      sourceId: 'vesteda',
      externalId: '182105',
      title: 'Aaltje Noordewierstraat 197 D',
      priceEur: 1228.07,
      priceBasis: 'excl',
      sizeM2: 65,
      bedrooms: 2,
      type: 'apartment',
      address: {
        street: 'Aaltje Noordewierstraat',
        houseNumber: '197',
        addition: 'D',
        city: "'s-Gravenhage",
      },
      agent: { name: 'Vesteda' },
      contact: 'form',
      language: 'nl',
      extra: { status: 'for rent', recency: 'week' },
    });
    expect(listings[0]?.url).toMatch(/^https:\/\/www\.vesteda\.com\/nl\//);
    expect(listings[0]?.contactUrl).toBe(listings[0]?.url);
  });

  test('rented, reserved and rented-under-reservation units are skipped', async () => {
    const { listings } = await searchCity('rotterdam', 'vesteda/search-rotterdam.json');
    expect(listings.map((l) => l.externalId)).toEqual(['148304']);
    expect(listings[0]).toMatchObject({
      address: { postcode: expect.stringMatching(/^\d{4} [A-Z]{2}$/), city: 'Rotterdam' },
    });
  });

  test('a plain list of units (relevance sorting) is read too', async () => {
    const { listings } = await searchCity('delft', 'vesteda/search-delft.json');
    expect(listings.map((l) => l.externalId)).toEqual(['115']);
    expect(listings[0]?.address.city).toBe('Rijswijk');
    expect(listings[0]?.extra?.recency).toBeUndefined();
  });

  test('detail adds service costs, availability, energy label and the income requirement', async () => {
    const { listings } = await searchCity('rotterdam', 'vesteda/search-rotterdam.json');
    const unit = listings[0]!;
    const full = await vesteda.detail!(
      unit,
      ctxFor({
        '/nl/huurwoningen-rotterdam/de-kuil/albertina-sisulupad-172-rotterdam-148304': 'vesteda/unit.html',
      }),
    );
    expect(full.serviceCostsEur).toBe(92);
    expect(full.availableFrom).toBe('2026-09-24');
    expect(full.energyLabel).toBe('A++');
    expect(full.extra).toMatchObject({
      minIncomeEur: 4081,
      minIncomeTwoEarnersEur: 4665,
      deposit: '1 of 2 maand(en) borg',
      requirements: { minIncomeEur: 4081, incomeMultiple: 3.5 },
    });
  });

  test('isAvailable is true while the unit page says it is for rent', async () => {
    const { listings } = await searchCity('rotterdam', 'vesteda/search-rotterdam.json');
    const listing: Listing = {
      ...listings[0]!,
      id: 'vesteda:148304',
      propertyId: null,
      firstSeenAt: '2026-09-24T10:00:00Z',
      lastSeenAt: '2026-09-24T10:00:00Z',
      state: 'active',
      via: 'poll',
    };
    expect(await vesteda.isAvailable!(listing, ctxFor({ '148304': 'vesteda/unit.html' }))).toBe(true);
    const rented = readFixture('vesteda/unit.html').replace(
      'Deze woning is te huur.',
      'Deze woning is verhuurd.',
    );
    expect(
      await vesteda.isAvailable!(
        listing,
        ctxFor([{ match: '148304', body: rented, headers: { 'content-type': 'text/html' } }]),
      ),
    ).toBe(false);
    expect(await vesteda.isAvailable!(listing, ctxFor([{ match: '148304', status: 404, body: '' }]))).toBe(
      false,
    );
  });

  test('has no alert-email parser (Vesteda alerts need an account and were not seen)', () => {
    expect(vesteda.parseAlertEmail).toBeUndefined();
  });
});

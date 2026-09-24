import { describe, expect, test } from 'vitest';
import { ConfigSchema, type InboundMessage, type Listing, type RawListing } from '@nlpf/core';
import { parseAlertEmail as mailPackageAlert } from '@nlpf/mail';
import { assignedJson, housinganywhere, housingAnywhereCity, unitTypeId } from '../../src/adapters/housinganywhere.js';
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

const ALGOLIA = 'y8l112mibf-dsn.algolia.net/1/indexes/*/queries';

function ctxFor(routes: FixtureContextOptions['routes']) {
  return fixtureContext({ sourceId: 'housinganywhere', config, routes, now: new Date('2026-09-24T12:00:00Z') });
}

async function search(): Promise<{ listings: RawListing[]; body: Record<string, unknown> }> {
  const ctx = ctxFor([{ match: ALGOLIA, method: 'POST', file: 'housinganywhere/search.json' }]);
  const [req] = housinganywhere.buildSearches(ctx.searches, ctx.source);
  const listings = await housinganywhere.search(req!, ctx);
  return { listings, body: JSON.parse(ctx.requests[0]?.body ?? '{}') as Record<string, unknown> };
}

const asListing = (raw: RawListing): Listing => ({
  ...raw,
  id: `housinganywhere:${raw.externalId}`,
  propertyId: null,
  firstSeenAt: '2026-09-24T10:00:00Z',
  lastSeenAt: '2026-09-24T10:00:00Z',
  state: 'active',
  via: 'poll',
});

describe('housinganywhere adapter', () => {
  test('declares a JSON source whose messages need a login and a subscription', () => {
    expect(housinganywhere.id).toBe('housinganywhere');
    expect(housinganywhere.regions).toBe('nl');
    expect(housinganywhere.defaultIntervalSec).toBe(60);
    expect(housinganywhere.capabilities).toEqual({
      search: 'json',
      detail: true,
      contact: 'message',
      login: 'required',
      paid: { feature: 'contact', plan: 'housinganywhere-plus' },
      terms: 'forbids',
      browser: 'headless',
    });
    expect(housinganywhere.loginUrl).toBe('https://housinganywhere.com/oauth/signin');
  });

  test('buildSearches puts the cities, rent cap and types into one Algolia filter on the newest-first index', async () => {
    const reqs = housinganywhere.buildSearches(config.searches, { enabled: true, searchUrls: [], options: {} });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.params).toEqual({
      index: 'production_listings_most_recent',
      filters: 'isSearchable:true AND exclusivityPartnerIDs:0 AND (city:"Delft" OR city:"Rotterdam" OR city:"The Hague") AND priceEUR <= 1400',
      hitsPerPage: 40,
    });
    const { body } = await search();
    const [first] = body.requests as Record<string, unknown>[];
    expect(first).toMatchObject({ indexName: 'production_listings_most_recent', query: '', page: 0, filters: reqs[0]?.params?.filters });
    expect(first?.attributesToRetrieve).toContain('path');
  });

  test('types become propertyType filters and identical searches share one request', () => {
    const cfg = ConfigSchema.parse({
      searches: [
        { id: 'a', name: 'A', regions: [{ name: 'Delft', municipalities: ['delft'] }], priceMaxEur: 800, types: ['room'] },
        { id: 'b', name: 'B', regions: [{ name: 'Delft', municipalities: ['Delft'] }], priceMaxEur: 800, types: ['room'] },
        { id: 'c', name: 'C', regions: [], priceMinEur: 500, types: ['studio', 'apartment'] },
      ],
    });
    const reqs = housinganywhere.buildSearches(cfg.searches, { enabled: true, searchUrls: [], options: {} });
    expect(reqs.map((r) => r.params?.filters)).toEqual([
      'isSearchable:true AND exclusivityPartnerIDs:0 AND (city:"Delft") AND priceEUR <= 800 AND (propertyType:PRIVATE_ROOM OR propertyType:SHARED_ROOM)',
      'isSearchable:true AND exclusivityPartnerIDs:0 AND country:Netherlands AND priceEUR >= 500 AND (propertyType:STUDIO OR propertyType:APARTMENT)',
    ]);
  });

  test('search maps hits to listings with ut ids, absolute URLs and Dutch city names', async () => {
    const { listings } = await search();
    expect(listings).toHaveLength(25);
    expect(listings[0]).toMatchObject({
      sourceId: 'housinganywhere',
      externalId: 'ut1739453',
      url: 'https://housinganywhere.com/room/ut1739453/nl/Rotterdam/insulindestraat',
      title: 'Apartment in Insulindestraat, Rotterdam',
      priceEur: 1400,
      priceBasis: 'excl',
      serviceCostsEur: 200,
      sizeM2: 65,
      bedrooms: 1,
      type: 'apartment',
      furnishing: 'unfurnished',
      address: { street: 'Insulindestraat', city: 'Rotterdam', neighbourhood: 'Noord' },
      availableFrom: '2026-11-09',
      agent: { name: 'Landlord (placeholder)' },
      contact: 'message',
      publishedAt: '2026-09-10T00:00:00.000Z',
      language: 'en',
      extra: { landlordType: 'rental-company', minimumStayMonths: 12, registrationPossible: true },
    });
    const hague = listings.find((l) => l.externalId === 'ut1728230');
    expect(hague).toMatchObject({ url: 'https://housinganywhere.com/room/ut1728230/nl/The%20Hague/oranjelaan', address: { city: 'Den Haag' }, type: 'room', priceBasis: 'incl' });
    // A room's total size is the whole house, so it is not the room size.
    expect(listings.find((l) => l.externalId === 'ut1737362')).toMatchObject({ type: 'room', extra: { houseSizeM2: 223 } });
    expect(listings.find((l) => l.externalId === 'ut1737362')?.sizeM2).toBeUndefined();
    expect(listings.find((l) => l.externalId === 'ut1721733')).toMatchObject({ type: 'studio', sizeM2: 37, address: { city: 'Delft' } });
    for (const l of listings) {
      expect(l.externalId).toMatch(/^ut\d+$/);
      expect(l.url).toMatch(/^https:\/\/housinganywhere\.com\/room\/ut\d+\//);
      expect(l.priceEur).toBeLessThanOrEqual(1400);
    }
  });

  test('hits that are no longer searchable are skipped', async () => {
    const data = JSON.parse(readFixture('housinganywhere/search.json')) as { results: { hits: Record<string, unknown>[] }[] };
    data.results[0]!.hits[0]!.isSearchable = false;
    const ctx = ctxFor([{ match: ALGOLIA, method: 'POST', body: data }]);
    const [req] = housinganywhere.buildSearches(ctx.searches, ctx.source);
    const listings = await housinganywhere.search(req!, ctx);
    expect(listings.map((l) => l.externalId)).not.toContain('ut1739453');
    expect(listings).toHaveLength(24);
  });

  test('detail adds postcode, deposit and how many tenants already contacted the landlord', async () => {
    const { listings } = await search();
    const studio = listings.find((l) => l.externalId === 'ut1721733')!;
    const full = await housinganywhere.detail!(studio, ctxFor({ '/room/ut1721733/nl/Delft/nieuwe-gracht': 'housinganywhere/detail.html' }));
    expect(full.address).toMatchObject({ postcode: '2611 DV', city: 'Delft' });
    expect(full.depositEur).toBe(2100);
    expect(full.serviceCostsEur).toBe(217);
    expect(full.description).toContain('De studio (bouwjaar 2020)');
    expect(full.extra).toMatchObject({ reactions: 0, proposals: 0, feeRule: 'NL subscriptions' });
    expect(full.agent?.name).toBe('Landlord (placeholder)');
  });

  test('isAvailable asks Algolia whether the unit is still searchable', async () => {
    const { listings } = await search();
    const listing = asListing(listings[0]!);
    const ctx = ctxFor([{ match: ALGOLIA, method: 'POST', body: { results: [{ hits: [{ objectID: 'x' }], nbHits: 1 }] } }]);
    expect(await housinganywhere.isAvailable!(listing, ctx)).toBe(true);
    expect(JSON.parse(ctx.requests[0]?.body ?? '{}').requests[0].filters).toBe('unitTypeInternalID:1739453 AND isSearchable:true');
    expect(await housinganywhere.isAvailable!(listing, ctxFor([{ match: ALGOLIA, method: 'POST', body: { results: [{ hits: [], nbHits: 0 }] } }]))).toBe(false);
  });

  test('parseAlertEmail reads the saved-search email with the same ids as the mail package', () => {
    const mail = JSON.parse(readFixture('housinganywhere/alert.json')) as InboundMessage;
    const listings = housinganywhere.parseAlertEmail!(mail);
    expect(listings.map((l) => [l.externalId, l.title, l.priceEur, l.address.city])).toEqual([
      ['ut1848326', 'Private room in Phoenixstraat', 750, 'Delft'],
      ['ut1852210', 'Studio in Witte de Withstraat', 1150, 'Rotterdam'],
      ['ut1850001', 'Apartment in Prinsegracht', 1450, 'Den Haag'],
    ]);
    expect(listings[0]).toMatchObject({
      url: 'https://housinganywhere.com/room/ut1848326/nl/Delft/phoenixstraat',
      sizeM2: 16,
      type: 'room',
      furnishing: 'furnished',
      availableFrom: '2026-10-01',
      address: { street: 'Phoenixstraat' },
      contact: 'message',
      extra: { via: 'alert', alertMessageId: mail.id },
    });
    expect(listings[2]).toMatchObject({ type: 'apartment', bedrooms: 2, furnishing: 'unfurnished' });
    const fromMail = mailPackageAlert(mail);
    expect(fromMail?.sourceId).toBe('housinganywhere');
    expect(fromMail?.listings.map((l) => l.externalId)).toEqual(listings.map((l) => l.externalId));
    expect(housinganywhere.parseAlertEmail!({ ...mail, from: { address: 'x@example.com' } })).toEqual([]);
  });

  test('helpers: city names, ut ids and preloaded state', () => {
    expect(housingAnywhereCity('den haag')).toBe('The Hague');
    expect(housingAnywhereCity('delft')).toBe('Delft');
    expect(unitTypeId('/room/ut1739453/nl/Rotterdam/insulindestraat')).toBe('ut1739453');
    expect(unitTypeId('/s/Delft--Netherlands')).toBeUndefined();
    expect(assignedJson('<script>window.__X__= ({"a":"}{","b":{"c":1}});window.__Y__={}</script>', '__X__')).toEqual({ a: '}{', b: { c: 1 } });
  });
});

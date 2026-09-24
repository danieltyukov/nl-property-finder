import { describe, expect, test } from 'vitest';
import { ConfigSchema, type InboundMessage, type Listing, type RawListing } from '@nlpf/core';
import { parseAlertEmail as mailPackageAlert } from '@nlpf/mail';
import {
  createKamernetAdapter,
  kamernet,
  kamernetPriceId,
  kamernetSizeId,
} from '../../src/adapters/kamernet.js';
import { fixtureContext, readFixture } from '../../src/testing.js';

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

const API = 'https://kamernet.nl/services/api/listing/findlistings';

function ctxFor(routes: Parameters<typeof fixtureContext>[0]['routes']) {
  return fixtureContext({ sourceId: 'kamernet', config, routes, now: new Date('2026-09-24T12:00:00Z') });
}

async function searchDelft(): Promise<RawListing[]> {
  const ctx = ctxFor([{ match: '/findlistings', method: 'POST', file: 'kamernet/search-delft.json' }]);
  const req = kamernet.buildSearches(ctx.searches, ctx.source).find((r) => r.params?.citySlug === 'delft');
  return kamernet.search(req!, ctx);
}

const asListing = (raw: RawListing): Listing => ({
  ...raw,
  id: `kamernet:${raw.externalId}`,
  propertyId: null,
  firstSeenAt: '2026-09-24T10:00:00Z',
  lastSeenAt: '2026-09-24T10:00:00Z',
  state: 'active',
  via: 'poll',
});

describe('kamernet adapter', () => {
  test('declares a JSON source that needs a login and Premium to message', () => {
    expect(kamernet.id).toBe('kamernet');
    expect(kamernet.regions).toBe('nl');
    expect(kamernet.defaultIntervalSec).toBe(60);
    expect(kamernet.capabilities).toEqual({
      search: 'json',
      detail: true,
      contact: 'message',
      login: 'required',
      paid: { feature: 'contact', plan: 'kamernet-premium' },
      terms: 'forbids',
      browser: 'headed',
    });
    expect(kamernet.loginUrl).toBe('https://kamernet.nl/oauth/signin');
  });

  test('buildSearches asks Kamernet for each municipality with its own price ladder id', () => {
    const reqs = kamernet.buildSearches(
      config.searches,
      ConfigSchema.parse({}).sources.kamernet ?? { enabled: true, searchUrls: [], options: {} },
    );
    expect(reqs.map((r) => r.params?.citySlug)).toEqual(['delft', 'rotterdam', 'den-haag']);
    for (const r of reqs) {
      expect(r.url).toBe(API);
      expect(r.params).toMatchObject({
        radiusId: 1,
        maxRentalPriceId: 14,
        surfaceMinimumId: 0,
        listingTypeIds: '',
      });
    }
    expect(reqs[2]?.params?.cityName).toBe('Den Haag');
    expect(new Set(reqs.map((r) => r.key)).size).toBe(3);
  });

  test('the request body carries the filters and sorts newest first', async () => {
    const ctx = ctxFor([{ match: '/findlistings', method: 'POST', file: 'kamernet/search-rotterdam.json' }]);
    const req = kamernet
      .buildSearches(ctx.searches, ctx.source)
      .find((r) => r.params?.citySlug === 'rotterdam');
    await kamernet.search(req!, ctx);
    const sent = JSON.parse(ctx.requests[0]?.body ?? '{}');
    expect(ctx.requests[0]).toMatchObject({ url: API, method: 'POST' });
    expect(sent).toMatchObject({
      location: { name: 'Rotterdam', cityName: 'Rotterdam', citySlug: 'rotterdam' },
      citySlug: 'rotterdam',
      radiusId: 1,
      maxRentalPriceId: 14,
      listingTypeIds: [],
      listingSortOptionId: 1,
      pageNo: 1,
    });
  });

  test('two searches with the same filters share one request; different ones get their own', () => {
    const cfg = ConfigSchema.parse({
      searches: [
        {
          id: 'a',
          name: 'A',
          regions: [{ name: 'Delft', municipalities: ['Delft'] }],
          priceMaxEur: 800,
          types: ['room'],
          sizeMinM2: 15,
        },
        {
          id: 'b',
          name: 'B',
          regions: [{ name: 'Delft', municipalities: ['delft'] }],
          priceMaxEur: 800,
          types: ['room'],
          sizeMinM2: 15,
        },
        {
          id: 'c',
          name: 'C',
          regions: [{ name: "'s-Gravenhage", municipalities: [] }],
          priceMaxEur: 1450,
          types: ['studio', 'apartment'],
        },
      ],
    });
    const reqs = kamernet.buildSearches(cfg.searches, { enabled: true, searchUrls: [], options: {} });
    expect(reqs).toHaveLength(2);
    expect(reqs[0]?.params).toMatchObject({
      citySlug: 'delft',
      maxRentalPriceId: 8,
      surfaceMinimumId: 6,
      listingTypeIds: '1,16',
    });
    expect(reqs[1]?.params).toMatchObject({
      citySlug: 'den-haag',
      maxRentalPriceId: 15,
      listingTypeIds: '2,4',
    });
  });

  test('price and size ladders never cut off homes under the limit', () => {
    expect(kamernetPriceId(undefined)).toBe(0);
    expect(kamernetPriceId(1400)).toBe(14);
    expect(kamernetPriceId(1401)).toBe(15);
    expect(kamernetPriceId(1600)).toBe(16);
    expect(kamernetPriceId(2000)).toBe(17);
    expect(kamernetSizeId(15)).toBe(6);
    expect(kamernetSizeId(5)).toBe(0);
  });

  test('search maps listings to absolute detail URLs with price, size, type and furnishing', async () => {
    const listings = await searchDelft();
    expect(listings).toHaveLength(20);
    const room = listings.find((l) => l.externalId === '2407978');
    expect(room).toEqual({
      sourceId: 'kamernet',
      externalId: '2407978',
      url: 'https://kamernet.nl/huren/kamer-delft/louis-couperuslaan/kamer-2407978',
      title: 'Kamer Louis Couperuslaan',
      priceEur: 448,
      priceBasis: 'excl',
      sizeM2: 14,
      type: 'room',
      furnishing: 'furnished',
      address: { street: 'Louis Couperuslaan', city: 'Delft' },
      availableFrom: '2026-10-19',
      images: ['https://resources.kamernet.nl/image/ee339861-d13a-4f6f-81b0-1d793f13772b'],
      contact: 'message',
      contactUrl: 'https://kamernet.nl/en/start-conversation/2407978',
      extra: {},
    });
    const incl = listings.find((l) => l.externalId === '2407683');
    expect(incl).toMatchObject({
      priceEur: 550,
      priceBasis: 'incl',
      extra: { availableUntil: '2027-04-01' },
    });
    expect(listings.find((l) => l.externalId === '2407512')?.furnishing).toBe('unfurnished');
    expect(listings.find((l) => l.externalId === '2407035')?.furnishing).toBe('upholstered');
    for (const l of listings) expect(l.url.startsWith('https://kamernet.nl/huren/')).toBe(true);
  });

  test('isReactForFree listings are free to message; the others carry the Premium requirement', async () => {
    const listings = await searchDelft();
    const free = listings.filter((l) => l.extra?.reactForFree === true);
    expect(free.map((l) => l.externalId)).toEqual(['2406226', '2406224']);
    for (const l of free) {
      expect(l.contact).toBe('message');
      expect(l.extra).toMatchObject({ reactForFree: true, isReactForFree: true, topAdvert: true });
    }
    const paid = listings.filter((l) => !l.extra?.reactForFree);
    expect(paid.length).toBe(18);
    for (const l of paid) {
      expect(l.contact).toBe('message');
      expect(l.extra?.isReactForFree).toBeUndefined();
    }
    // Without a free flag, the source's paid capability applies to the listing.
    expect(kamernet.capabilities.paid).toEqual({ feature: 'contact', plan: 'kamernet-premium' });
  });

  test('detail adds postcode, house number, description and publication date', async () => {
    const [room] = (await searchDelft()).filter((l) => l.externalId === '2407978');
    const ctx = ctxFor({ '/huren/kamer-delft/louis-couperuslaan/kamer-2407978': 'kamernet/detail.html' });
    const full = await kamernet.detail!(room!, ctx);
    expect(full.address).toMatchObject({
      street: 'Louis Couperuslaan',
      houseNumber: '85',
      postcode: '2624 WS',
      city: 'Delft',
    });
    expect(full.description).toContain('indefinite contract');
    expect(full.publishedAt).toBe('2026-09-24T10:18:31.000Z');
    expect(full.agent?.name).toBe('Landlord (placeholder)');
    expect(full.images?.[0]).toMatch(/^https:\/\/resources\.kamernet\.nl\/image\//);
    expect(full.extra).toMatchObject({
      petsAllowed: false,
      smokingAllowed: false,
      viewingDate: '2026-10-01',
    });
  });

  test('isAvailable reads the detail page and treats a missing or inactive listing as gone', async () => {
    const [room] = (await searchDelft()).filter((l) => l.externalId === '2407978');
    const listing = asListing(room!);
    expect(await kamernet.isAvailable!(listing, ctxFor({ 'kamer-2407978': 'kamernet/detail.html' }))).toBe(
      true,
    );
    const inactive = readFixture('kamernet/detail.html').replace(/"isActive":\s*true/, '"isActive": false');
    expect(
      await kamernet.isAvailable!(
        listing,
        ctxFor([{ match: 'kamer-2407978', body: inactive, headers: { 'content-type': 'text/html' } }]),
      ),
    ).toBe(false);
    expect(
      await kamernet.isAvailable!(
        listing,
        ctxFor([{ match: 'kamer-2407978', status: 404, body: 'not found' }]),
      ),
    ).toBe(false);
  });

  test('parseAlertEmail reads the saved-search email with the same ids as the mail package', () => {
    const mail = JSON.parse(readFixture('kamernet/alert.json')) as InboundMessage;
    const listings = kamernet.parseAlertEmail!(mail);
    expect(listings.map((l) => [l.externalId, l.title, l.priceEur, l.address.city])).toEqual([
      ['2407683', 'Kamer Van der Heimstraat', 625, 'Delft'],
      ['2411022', 'Studio Voorstraat', 890, 'Delft'],
      ['2412345', 'Appartement West-Kruiskade', 1150, 'Rotterdam'],
    ]);
    expect(listings[0]).toMatchObject({
      sourceId: 'kamernet',
      url: 'https://kamernet.nl/huren/kamer-delft/van-der-heimstraat/kamer-2407683',
      priceBasis: 'incl',
      sizeM2: 14,
      type: 'room',
      furnishing: 'furnished',
      availableFrom: '2026-10-01',
      contact: 'message',
      extra: { via: 'alert', alertMessageId: mail.id },
    });
    expect(listings[2]).toMatchObject({
      type: 'apartment',
      furnishing: 'unfurnished',
      priceBasis: 'excl',
      availableFrom: '2026-09-23',
    });
    const fromMail = mailPackageAlert(mail);
    expect(fromMail?.sourceId).toBe('kamernet');
    expect(fromMail?.listings.map((l) => l.externalId)).toEqual(listings.map((l) => l.externalId));
    expect(kamernet.alertSenders).toContain('noreply@kamernet.nl');
  });

  test('parseAlertEmail ignores mail from other senders', () => {
    const mail = JSON.parse(readFixture('kamernet/alert.json')) as InboundMessage;
    expect(kamernet.parseAlertEmail!({ ...mail, from: { address: 'someone@example.com' } })).toEqual([]);
  });

  test('a local base URL is used for every request', () => {
    const local = createKamernetAdapter({ baseUrl: 'http://127.0.0.1:9999' });
    const [req] = local.buildSearches(config.searches, { enabled: true, searchUrls: [], options: {} });
    expect(req?.url).toBe('http://127.0.0.1:9999/services/api/listing/findlistings');
  });
});

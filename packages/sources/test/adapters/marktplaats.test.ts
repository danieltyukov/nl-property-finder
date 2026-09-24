import { describe, expect, test } from 'vitest';
import { ConfigSchema, type InboundMessage, type Listing, type RawListing } from '@nlpf/core';
import { parseAlertEmail as mailPackageAlert } from '@nlpf/mail';
import { isHomeOffer, marktplaats } from '../../src/adapters/marktplaats.js';
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

const NOW = new Date('2026-09-24T12:00:00Z');

function ctxFor(routes: FixtureContextOptions['routes']) {
  return fixtureContext({ sourceId: 'marktplaats', config, routes, now: NOW });
}

async function searchCity(slug: 'delft' | 'rotterdam' | 'den haag', file: string): Promise<RawListing[]> {
  const ctx = ctxFor({ '/lrp/api/search': file });
  const req = marktplaats
    .buildSearches(ctx.searches, ctx.source)
    .find((r) => r.params?.municipality === slug);
  return marktplaats.search(req!, ctx);
}

const asListing = (raw: RawListing): Listing => ({
  ...raw,
  id: `marktplaats:${raw.externalId}`,
  propertyId: null,
  firstSeenAt: '2026-09-24T10:00:00Z',
  lastSeenAt: '2026-09-24T10:00:00Z',
  state: 'active',
  via: 'poll',
});

describe('marktplaats adapter', () => {
  test('declares a JSON source with in-app chat behind a login', () => {
    expect(marktplaats.id).toBe('marktplaats');
    expect(marktplaats.regions).toBe('nl');
    expect(marktplaats.defaultIntervalSec).toBe(60);
    expect(marktplaats.capabilities).toEqual({
      search: 'json',
      detail: true,
      contact: 'message',
      login: 'required',
      terms: 'forbids',
    });
    // Chat is not automated: without a contact() the router hands these homes to the user.
    expect(marktplaats.contact).toBeUndefined();
  });

  test('buildSearches asks per municipality with postcode, radius, rental categories and a server-side price range', () => {
    const reqs = marktplaats.buildSearches(config.searches, { enabled: true, searchUrls: [], options: {} });
    expect(reqs.map((r) => r.params?.municipality)).toEqual(['delft', 'rotterdam', 'den haag']);
    const delft = new URL(reqs[0]!.url!);
    expect(delft.pathname).toBe('/lrp/api/search');
    expect(delft.searchParams.get('l1CategoryId')).toBe('1032');
    expect(delft.searchParams.getAll('l2CategoryIds[]')).toEqual(['2143', '2147', '2771']);
    expect(delft.searchParams.get('postcode')).toBe('2611BC');
    expect(delft.searchParams.get('distanceMeters')).toBe('5000');
    expect(delft.searchParams.get('attributeRanges[]')).toBe('PriceCents:0:140000');
    expect(delft.searchParams.get('sortBy')).toBe('SORT_INDEX');
    expect(delft.searchParams.get('sortOrder')).toBe('DECREASING');
    expect(new URL(reqs[1]!.url!).searchParams.get('postcode')).toBe('3011AD');
    expect(new URL(reqs[2]!.url!).searchParams.get('postcode')).toBe('2511CV');
    expect(new Set(reqs.map((r) => r.key)).size).toBe(3);
  });

  test('a municipality without a known postcode is looked up once and then searched around it', async () => {
    const cfg = ConfigSchema.parse({
      searches: [
        { id: 'l', name: 'L', regions: [{ name: 'Leiden', municipalities: ['leiden'] }], types: ['room'] },
      ],
    });
    const [req] = marktplaats.buildSearches(cfg.searches, { enabled: true, searchUrls: [], options: {} });
    expect(req?.url).toBeUndefined();
    const ctx = fixtureContext({
      sourceId: 'marktplaats',
      config: cfg,
      now: NOW,
      routes: [
        {
          match: 'api.pdok.nl',
          body: { response: { docs: [{ postcode: '2314ET', centroide_ll: 'POINT(4.519 52.156)' }] } },
        },
        { match: '/lrp/api/search', file: 'marktplaats/search-delft.json' },
      ],
    });
    await marktplaats.search(req!, ctx);
    const url = new URL(ctx.requests.at(-1)!.url);
    expect(url.searchParams.get('postcode')).toBe('2314ET');
    expect(url.searchParams.getAll('l2CategoryIds[]')).toEqual(['2147', '2771']);
    expect(url.searchParams.has('attributeRanges[]')).toBe(false);
  });

  test('search keeps room offers and drops furniture, wanted ads and reserved items', async () => {
    const listings = await searchCity('delft', 'marktplaats/search-delft.json');
    expect(listings.map((l) => l.title)).toEqual([
      'Room for rent in Nootdorp',
      'Kamer huren in Delft',
      'Kamer te huur in delft',
      'kamer te huur 500 in rijswijk',
      'kamer huren',
    ]);
    expect(listings[0]).toMatchObject({
      sourceId: 'marktplaats',
      externalId: 'm2445192348',
      url: 'https://www.marktplaats.nl/v/huizen-en-kamers/kamers-te-huur/m2445192348-room-for-rent-in-nootdorp',
      priceEur: 750,
      type: 'room',
      address: { city: 'Delft' },
      agent: { name: 'Landlord (placeholder)' },
      contact: 'message',
      contactUrl:
        'https://www.marktplaats.nl/v/huizen-en-kamers/kamers-te-huur/m2445192348-room-for-rent-in-nootdorp',
      publishedAt: '2026-09-23T22:00:00.000Z',
      language: 'en',
      extra: { sellerVerified: false, priceType: 'FIXED', category: 2771 },
    });
    // "Bieden" with no amount has no price.
    expect(listings[1]?.priceEur).toBeUndefined();
  });

  test('search in a big city skips non-homes and keeps real rooms', async () => {
    const listings = await searchCity('den haag', 'marktplaats/search-den-haag.json');
    const titles = listings.map((l) => l.title);
    expect(titles).toContain('For rent: shared house near Den Haag Holland Spoor');
    expect(titles).toContain('Kamer met balkon');
    for (const junk of [
      'IKEA desk and chair',
      'Loungebank',
      'Postadres/ briefadres aangeboden Den haag',
      "I'm looking for a room",
      'Kamer gezocht  omgeving Delft/Den Haag.',
      'Vakantie woning',
      'TE HUUR PRAKTIJKRUIMTE',
    ]) {
      expect(titles).not.toContain(junk);
    }
    const reserved = await searchCity('rotterdam', 'marktplaats/search-rotterdam.json');
    expect(reserved.map((l) => l.externalId)).not.toContain('m2440758925');
    for (const l of [...listings, ...reserved]) {
      expect(l.externalId).toMatch(/^m\d+$/);
      expect(l.url.startsWith('https://www.marktplaats.nl/v/huizen-en-kamers/')).toBe(true);
      if (l.priceEur !== undefined) expect(l.priceEur).toBeGreaterThanOrEqual(100);
    }
  });

  test('isHomeOffer tells rooms from furniture and wanted ads', () => {
    expect(isHomeOffer('Kamer te huur')).toBe(true);
    expect(isHomeOffer('Roommate gezocht (indoor kelderkamer)', 'Kamer te huur voor een student')).toBe(true);
    expect(isHomeOffer('kamer gezocht Rotterdam zuid')).toBe(false);
    expect(isHomeOffer('Stapelbed')).toBe(false);
    expect(isHomeOffer('Bedrijfsruimte/Kantoor/Winkel te huur')).toBe(false);
    expect(isHomeOffer('woonkamer set')).toBe(false);
  });

  test('detail reads the seller type for the scam guard and the full description', async () => {
    const [room] = (await searchCity('rotterdam', 'marktplaats/search-rotterdam.json')).filter(
      (l) => l.externalId === 'm2441586539',
    );
    const ctx = ctxFor({
      '/v/huizen-en-kamers/kamers-te-huur/m2441586539-kamer-te-huur': 'marktplaats/item.html',
    });
    const full = await marktplaats.detail!(room!, ctx);
    expect(full.description).toBe('Alleen vrouwen vanaf 30 jaar. Is vanaf vandaag beschikbaar');
    expect(full.publishedAt).toBe('2026-09-11T16:09:59.000Z');
    expect(full.extra).toMatchObject({
      sellerType: 'TRADER',
      sellerAccountType: 'Regular',
      privateLandlord: false,
      sellerAbroad: false,
      sellerActiveYears: 2,
      views: 560,
      favorites: 9,
    });
    const consumer = readFixture('marktplaats/item.html').replace(
      '"sellerType": "TRADER"',
      '"sellerType": "CONSUMER"',
    );
    const asConsumer = await marktplaats.detail!(
      room!,
      ctxFor([{ match: 'm2441586539', body: consumer, headers: { 'content-type': 'text/html' } }]),
    );
    expect(asConsumer.extra?.privateLandlord).toBe(true);
  });

  test('isAvailable is false for reserved or removed ads', async () => {
    const [room] = (await searchCity('rotterdam', 'marktplaats/search-rotterdam.json')).filter(
      (l) => l.externalId === 'm2441586539',
    );
    const listing = asListing(room!);
    expect(await marktplaats.isAvailable!(listing, ctxFor({ m2441586539: 'marktplaats/item.html' }))).toBe(
      true,
    );
    const reserved = readFixture('marktplaats/item.html').replace(
      '"isReserved": false',
      '"isReserved": true',
    );
    expect(
      await marktplaats.isAvailable!(
        listing,
        ctxFor([{ match: 'm2441586539', body: reserved, headers: { 'content-type': 'text/html' } }]),
      ),
    ).toBe(false);
    expect(
      await marktplaats.isAvailable!(listing, ctxFor([{ match: 'm2441586539', status: 404, body: '' }])),
    ).toBe(false);
  });

  test('parseAlertEmail reads the saved-search email with the same ids as the mail package', () => {
    const mail = JSON.parse(readFixture('marktplaats/alert.json')) as InboundMessage;
    const listings = marktplaats.parseAlertEmail!(mail);
    expect(listings.map((l) => [l.externalId, l.title, l.priceEur, l.address.city])).toEqual([
      ['m2198765432', 'Ruime kamer in Delft centrum', 675, 'Delft'],
      ['m2198700011', 'Studio te huur Rotterdam Noord, 25 m2', 950, 'Rotterdam'],
      ['m2198711122', 'Appartement 2 kamers', undefined, 'Den Haag'],
    ]);
    expect(listings[0]).toMatchObject({
      url: 'https://www.marktplaats.nl/v/huizen-en-kamers/kamers-te-huur/m2198765432-ruime-kamer-in-delft-centrum',
      type: 'room',
      contact: 'message',
      publishedAt: '2026-09-22T22:00:00.000Z',
      extra: { via: 'alert', alertMessageId: mail.id },
    });
    expect(listings[1]).toMatchObject({ type: 'studio', sizeM2: 25 });
    expect(listings[2]).toMatchObject({ type: 'apartment', publishedAt: '2026-09-21T22:00:00.000Z' });
    const fromMail = mailPackageAlert(mail);
    expect(fromMail?.sourceId).toBe('marktplaats');
    expect(fromMail?.listings.map((l) => l.externalId)).toEqual(listings.map((l) => l.externalId));
    expect(marktplaats.parseAlertEmail!({ ...mail, from: { address: 'x@example.com' } })).toEqual([]);
  });
});

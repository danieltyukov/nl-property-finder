import { describe, expect, test } from 'vitest';
import type { Page } from 'playwright-core';
import {
  ConfigSchema,
  type BrowserSession,
  type InboundMessage,
  type Listing,
  type RawListing,
} from '@nlpf/core';
import { parseAlertEmail as mailPackageAlert } from '@nlpf/mail';
import { createFundaAdapter, funda, fundaTinyId, reviveNuxt } from '../../src/adapters/funda.js';
import { SourceBlockedError } from '../../src/runtime/errors.js';
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

function ctxFor(routes: FixtureContextOptions['routes'], extra: Partial<FixtureContextOptions> = {}) {
  return fixtureContext({ sourceId: 'funda', config, routes, now: NOW, ...extra });
}

/** A browser session whose page serves one fixture, to exercise the browser fallback without Chromium. */
function fakeBrowser(file: string, opened: string[]): FixtureContextOptions['browser'] {
  return async (): Promise<BrowserSession> => {
    let current = '';
    const page = {
      goto: async (url: string) => {
        current = url;
        opened.push(url);
        return { status: () => 200 };
      },
      content: async () => readFixture(file),
      url: () => current,
    } as unknown as Page;
    return { page, close: async () => undefined };
  };
}

async function searchDelft(): Promise<RawListing[]> {
  const ctx = ctxFor({ '/zoeken/huur': 'funda/search-delft.html' });
  const [req] = funda.buildSearches(
    ConfigSchema.parse({
      searches: [
        { id: 'd', name: 'D', regions: [{ name: 'Delft', municipalities: ['delft'] }], priceMaxEur: 1400 },
      ],
    }).searches,
    ctx.source,
  );
  return funda.search(req!, ctx);
}

const asListing = (raw: RawListing): Listing => ({
  ...raw,
  id: `funda:${raw.externalId}`,
  propertyId: null,
  firstSeenAt: '2026-09-24T10:00:00Z',
  lastSeenAt: '2026-09-24T10:00:00Z',
  state: 'active',
  via: 'poll',
});

describe('funda adapter', () => {
  test('declares an HTML source with a guest contact form', () => {
    expect(funda.id).toBe('funda');
    expect(funda.regions).toBe('nl');
    expect(funda.defaultIntervalSec).toBe(60);
    expect(funda.capabilities).toEqual({
      search: 'html',
      detail: true,
      contact: 'form',
      login: 'none',
      terms: 'forbids',
      browser: 'headless',
    });
    expect(funda.capabilities.paid).toBeUndefined();
    expect(typeof funda.contact).toBe('function');
  });

  test('buildSearches puts every municipality, the rent cap and availability into one newest-first search', () => {
    const reqs = funda.buildSearches(config.searches, { enabled: true, searchUrls: [], options: {} });
    expect(reqs).toHaveLength(1);
    const url = new URL(reqs[0]!.url!);
    expect(url.origin + url.pathname).toBe('https://www.funda.nl/zoeken/huur');
    expect(JSON.parse(url.searchParams.get('selected_area')!)).toEqual(['delft', 'rotterdam', 'den-haag']);
    expect(JSON.parse(url.searchParams.get('price')!)).toBe('0-1400');
    expect(JSON.parse(url.searchParams.get('availability')!)).toEqual(['available']);
    expect(JSON.parse(url.searchParams.get('sort')!)).toBe('date_down');
    // Without object_type Funda also returns parking spaces and storage.
    expect(JSON.parse(url.searchParams.get('object_type')!)).toEqual(['apartment', 'house']);
  });

  test('parking spaces and storage are never listings', async () => {
    // The Nuxt payload stores the string "apartment" once and every listing refers to it.
    const html = readFixture('funda/search-delft.html').replace('"apartment"', '"parking"');
    const ctx = ctxFor([{ match: '/zoeken/huur', body: html, headers: { 'content-type': 'text/html' } }]);
    expect(
      await funda.search({ key: 'x', label: 'x', url: 'https://www.funda.nl/zoeken/huur?p=1' }, ctx),
    ).toEqual([]);
  });

  test('types and minimum size become object_type and floor_area; identical searches are one request', () => {
    const cfg = ConfigSchema.parse({
      searches: [
        {
          id: 'a',
          name: 'A',
          regions: [{ name: "'s-Gravenhage", municipalities: [] }],
          priceMaxEur: 1100,
          types: ['studio', 'apartment'],
          sizeMinM2: 30,
        },
        {
          id: 'b',
          name: 'B',
          regions: [{ name: 'Den Haag', municipalities: ['Den Haag'] }],
          priceMaxEur: 1100,
          types: ['apartment', 'studio'],
          sizeMinM2: 30,
        },
        { id: 'c', name: 'C', regions: [], types: ['house'] },
      ],
    });
    const reqs = funda.buildSearches(cfg.searches, { enabled: true, searchUrls: [], options: {} });
    expect(reqs).toHaveLength(2);
    const a = new URL(reqs[0]!.url!).searchParams;
    expect(JSON.parse(a.get('selected_area')!)).toEqual(['den-haag']);
    expect(JSON.parse(a.get('object_type')!)).toEqual(['apartment']);
    expect(JSON.parse(a.get('floor_area')!)).toBe('30-');
    const c = new URL(reqs[1]!.url!).searchParams;
    expect(JSON.parse(c.get('selected_area')!)).toEqual(['nl']);
    expect(JSON.parse(c.get('object_type')!)).toEqual(['house']);
    expect(c.has('price')).toBe(false);
  });

  test('search reads the Nuxt data: address, rent, size, rooms, agent and the contact form link', async () => {
    const listings = await searchDelft();
    expect(listings).toHaveLength(10);
    expect(listings[0]).toMatchObject({
      sourceId: 'funda',
      externalId: '44509846',
      url: 'https://www.funda.nl/detail/huur/delft/appartement-pierre-van-hauwelaan-54/44509846/',
      title: 'Pierre van Hauwelaan 54',
      priceEur: 1131,
      sizeM2: 41,
      rooms: 1,
      type: 'apartment',
      address: {
        street: 'Pierre van Hauwelaan',
        houseNumber: '54',
        postcode: '2625 WL',
        city: 'Delft',
        neighbourhood: 'Juniusbuurt',
      },
      agent: { name: 'MVGM Wonen', url: 'https://www.funda.nl/makelaar/70043-mvgm-wonen/' },
      contact: 'form',
      contactUrl: 'https://www.funda.nl/makelaar-contact/?listingId=8154483',
      publishedAt: '2026-09-18T11:18:54.312Z',
      language: 'nl',
      extra: { globalId: 8154483 },
    });
    expect(listings[0]?.images?.[0]).toMatch(/^https:\/\/cloud\.funda\.nl\/tiara-media\//);
    for (const l of listings) {
      expect(l.url).toMatch(/^https:\/\/www\.funda\.nl\/detail\/huur\/delft\//);
      expect(l.priceEur).toBeLessThanOrEqual(1400);
      expect(l.address.city).toBe('Delft');
    }
  });

  test('homes rented under reservation are skipped', async () => {
    const ids = (await searchDelft()).map((l) => l.externalId);
    // Brabantse Turfmarkt 76 H and Duke Ellingtonstraat 80 are "verhuurd onder voorbehoud" in the fixture.
    expect(ids).not.toContain('44584847');
    expect(ids).not.toContain('44581134');
  });

  test('one request covers several areas, with house number additions kept', async () => {
    const ctx = ctxFor({ '/zoeken/huur': 'funda/search-rotterdam-den-haag.html' });
    const listings = await funda.search(
      {
        key: 'x',
        label: 'x',
        url: 'https://www.funda.nl/zoeken/huur?selected_area=%5B%22rotterdam%22%2C%22den-haag%22%5D',
      },
      ctx,
    );
    expect(listings.length).toBe(15);
    expect(new Set(listings.map((l) => l.address.city))).toEqual(new Set(['Rotterdam', 'Den Haag']));
    expect(listings.find((l) => l.externalId === '44597374')).toMatchObject({
      title: 'Schiedamsedijk 6 C',
      address: { houseNumber: '6', addition: 'C' },
    });
    expect(listings.find((l) => l.externalId === '44598154')?.type).toBe('house');
  });

  test('without Nuxt data the cards are read instead, still skipping rented homes', async () => {
    const html = readFixture('funda/search-delft.html').replace(
      /<script[^>]*id="__NUXT_DATA__"[^>]*>[\s\S]*?<\/script>/,
      '',
    );
    const ctx = ctxFor([{ match: '/zoeken/huur', body: html, headers: { 'content-type': 'text/html' } }]);
    const listings = await funda.search(
      { key: 'x', label: 'x', url: 'https://www.funda.nl/zoeken/huur?x=1' },
      ctx,
    );
    expect(listings).toHaveLength(10);
    expect(listings[0]).toMatchObject({
      externalId: '44509846',
      title: 'Pierre van Hauwelaan 54',
      priceEur: 1131,
      sizeM2: 41,
      address: { street: 'Pierre van Hauwelaan', houseNumber: '54', postcode: '2625 WL', city: 'Delft' },
    });
  });

  test('when Akamai refuses the plain request the page is read in the browser, and the browser stays in use', async () => {
    const opened: string[] = [];
    const adapter = createFundaAdapter();
    const ctx = ctxFor(
      { '/zoeken/huur': 'funda/akamai-interstitial.html' },
      { browser: fakeBrowser('funda/search-delft.html', opened) },
    );
    const req = {
      key: 'x',
      label: 'x',
      url: 'https://www.funda.nl/zoeken/huur?selected_area=%5B%22delft%22%5D',
    };
    expect(await adapter.search(req, ctx)).toHaveLength(10);
    expect(await adapter.search(req, ctx)).toHaveLength(10);
    expect(ctx.requests).toHaveLength(1);
    expect(opened).toHaveLength(2);
  });

  test('a bot check in the browser too is reported as blocked', async () => {
    const ctx = ctxFor(
      { '/zoeken/huur': 'funda/akamai-interstitial.html' },
      { browser: fakeBrowser('funda/akamai-interstitial.html', []) },
    );
    await expect(
      createFundaAdapter().search({ key: 'x', label: 'x', url: 'https://www.funda.nl/zoeken/huur?a=1' }, ctx),
    ).rejects.toBeInstanceOf(SourceBlockedError);
  });

  test('detail adds the description, availability, coordinates and photos', async () => {
    const [first] = await searchDelft();
    const ctx = ctxFor({
      '/detail/huur/delft/appartement-pierre-van-hauwelaan-54/44509846/': 'funda/detail.html',
    });
    const full = await funda.detail!(first!, ctx);
    expect(full.description).toMatch(/^Nu te huur: dit fraaie appartement/);
    expect(full.availableFrom).toBe('2026-09-24');
    expect(full.address).toMatchObject({ lat: 51.995857, lon: 4.346027, postcode: '2625 WL' });
    expect(full.images?.[0]).toBe('https://cloud.funda.nl/valentina_media/234/870/335.jpg');
    expect(full.extra).toMatchObject({
      globalId: 8154483,
      contract: 'Onbepaalde tijd',
      views: 881,
      saves: 32,
    });
  });

  test('isAvailable asks the summary API by global id', async () => {
    const [first] = await searchDelft();
    const listing = asListing(first!);
    const api = 'https://listing-detail-summary.funda.io/api/v1/listing/nl/8154483';
    expect(await funda.isAvailable!(listing, ctxFor({ [api]: 'funda/summary.json' }))).toBe(true);
    const rented = readFixture('funda/summary.json').replace(
      '"isSoldOrRented": false',
      '"isSoldOrRented": true',
    );
    expect(await funda.isAvailable!(listing, ctxFor([{ match: api, body: rented }]))).toBe(false);
    expect(await funda.isAvailable!(listing, ctxFor([{ match: api, status: 404, body: '' }]))).toBe(false);
  });

  test('parseAlertEmail reads the saved-search email with the same ids as the mail package', () => {
    const mail = JSON.parse(readFixture('funda/alert.json')) as InboundMessage;
    const listings = funda.parseAlertEmail!(mail);
    expect(listings.map((l) => [l.externalId, l.title, l.priceEur, l.address.city])).toEqual([
      ['43123456', 'Oude Delft 12 A', 1495, 'Delft'],
      ['43127890', 'Westvest 95', 1850, 'Delft'],
      ['43129999', 'Mathenesserlaan 120 B', 1250, 'Rotterdam'],
    ]);
    expect(listings[0]).toMatchObject({
      url: 'https://www.funda.nl/detail/huur/delft/appartement-oude-delft-12-a/43123456/',
      sizeM2: 52,
      rooms: 2,
      type: 'apartment',
      energyLabel: 'C',
      address: { street: 'Oude Delft', houseNumber: '12', addition: 'A', postcode: '2611 BC' },
      contact: 'form',
      extra: { via: 'alert', alertMessageId: mail.id },
    });
    expect(listings[1]).toMatchObject({ type: 'house', bedrooms: 3 });
    const fromMail = mailPackageAlert(mail);
    expect(fromMail?.sourceId).toBe('funda');
    expect(fromMail?.listings.map((l) => l.externalId)).toEqual(listings.map((l) => l.externalId));
    expect(funda.parseAlertEmail!({ ...mail, from: { address: 'news@example.com' } })).toEqual([]);
  });

  test('tinyIds come from current and older URL shapes', () => {
    expect(fundaTinyId('https://www.funda.nl/detail/huur/delft/appartement-oude-delft-12-a/43123456/')).toBe(
      '43123456',
    );
    expect(fundaTinyId('/huur/rotterdam/appartement-43129999-mathenesserlaan-120-b/')).toBe('43129999');
    expect(fundaTinyId('/zoeken/huur')).toBeUndefined();
  });

  test('reviveNuxt resolves references, wrappers, sets and undefined', () => {
    const payload = [['ShallowReactive', 1], { a: 2, b: 3, c: -1, d: 5 }, 'x', [4, 4], 7, ['Set', 2, 4]];
    expect(reviveNuxt(payload)).toEqual({ a: 'x', b: [7, 7], c: undefined, d: ['x', 7] });
    expect(reviveNuxt('not an array')).toBeUndefined();
  });
});

import { describe, expect, test } from 'vitest';
import type { Listing, RawListing } from '@nlpf/core';
import { kamernl, parseKamerNlSearch } from '../../src/adapters/kamernl.js';
import { fixtureContext, readFixture } from '../../src/testing.js';
import { fakeBrowser } from './fake-page.js';

const now = new Date('2026-09-24T10:00:00Z');
const threeCities = {
  searches: [
    {
      id: 'main',
      name: 'Main',
      regions: [
        { name: 'Delft', municipalities: ['Delft'] },
        { name: 'Rotterdam', municipalities: ['Rotterdam'] },
        { name: 'Den Haag', municipalities: ['Den Haag'] },
      ],
      priceMaxEur: 1400,
    },
  ],
};
const ROOMS_DELFT = 'https://www.kamer.nl/huren/kamer-delft/?sort=-created&max_price=1400';

function ctxWith(routes: Parameters<typeof fakeBrowser>[0], config: Record<string, unknown> = threeCities) {
  const browser = fakeBrowser(routes);
  return { ctx: fixtureContext({ sourceId: 'kamernl', routes: [], config, browser, now }), browser };
}

describe('kamer.nl', () => {
  test('declares the Premium paywall and a headed browser', () => {
    expect(kamernl.capabilities).toMatchObject({
      search: 'browser',
      contact: 'message',
      login: 'required',
      paid: { feature: 'contact', plan: 'kamernl-premium' },
      terms: 'unknown',
      browser: 'headed',
    });
  });

  test('buildSearches asks each category page per town, newest first, with the price bound', () => {
    const { ctx } = ctxWith({});
    const reqs = kamernl.buildSearches(ctx.searches, ctx.source);
    expect(reqs).toHaveLength(12);
    expect(reqs[0]).toMatchObject({ url: ROOMS_DELFT, params: { category: 'kamer', city: 'delft' } });
    expect(reqs.map((r) => r.url)).toContain('https://www.kamer.nl/huren/studio-den-haag/?sort=-created&max_price=1400');
    const rooms = ctxWith({}, { searches: [{ ...threeCities.searches[0], types: ['room'] }] }).ctx;
    expect(kamernl.buildSearches(rooms.searches, rooms.source).map((r) => r.url)).toEqual([
      ROOMS_DELFT,
      'https://www.kamer.nl/huren/kamer-rotterdam/?sort=-created&max_price=1400',
      'https://www.kamer.nl/huren/kamer-den-haag/?sort=-created&max_price=1400',
    ]);
  });

  test('search maps the JSON-LD list and the cards, and leaves out homes outside the town', async () => {
    const { ctx, browser } = ctxWith({ [ROOMS_DELFT]: 'kamernl/search-delft.html' });
    const listings = await kamernl.search(kamernl.buildSearches(ctx.searches, ctx.source)[0]!, ctx);
    expect(browser.sessions).toEqual([{ headed: true }]);
    expect(listings.map((l) => l.externalId)).toEqual(['675658', '675659', '663049', '658725', '666129', '662726']);
    expect(listings[0]).toEqual({
      sourceId: 'kamernl',
      externalId: '675658',
      url: 'https://www.kamer.nl/huren/kamer-delft/julianalaan/675658/',
      title: 'Kamer Julianalaan in Delft',
      priceEur: 535,
      priceBasis: 'unknown',
      sizeM2: 16,
      rooms: 1,
      type: 'room',
      furnishing: 'upholstered',
      availableFrom: '2026-09-24',
      description: expect.stringContaining('Julianalaan van 16 m²'),
      address: { street: 'Julianalaan', city: 'Delft' },
      images: [expect.stringMatching(/^https:\/\/cdn\.kamer\.nl\//)],
      contact: 'message',
      contactUrl: 'https://www.kamer.nl/huren/kamer-delft/julianalaan/675658/reageren/',
      language: 'nl',
    });
    for (const l of listings) {
      expect(l.address.city).toBe('Delft');
      expect(l.priceEur).toBeGreaterThan(0);
    }
  });

  test('without a category the first list on the page is used', () => {
    const all = parseKamerNlSearch(readFixture('kamernl/search-delft.html'), { baseUrl: ROOMS_DELFT, now });
    expect(all).toHaveLength(6);
  });

  test('detail reads the listing JSON-LD', async () => {
    const url = 'https://www.kamer.nl/huren/kamer-delft/julianalaan/675658/';
    const { ctx } = ctxWith({ [url]: 'kamernl/detail-julianalaan.html' });
    const base: RawListing = { sourceId: 'kamernl', externalId: '675658', url, title: 'Kamer Julianalaan in Delft', address: { street: 'Julianalaan', city: 'Delft' }, contact: 'message' };
    const d = await kamernl.detail!(base, ctx);
    expect(d).toMatchObject({
      title: 'Kamer Julianalaan in Delft',
      priceEur: 535,
      sizeM2: 16,
      rooms: 1,
      availableFrom: '2026-09-11',
      furnishing: 'upholstered',
      address: { street: 'Julianalaan', postcode: '2628 BB', city: 'Delft' },
      contact: 'message',
      contactUrl: `${url}reageren/`,
      extra: { petsAllowed: false },
    });
    expect(d.images).toHaveLength(2);
    expect(await kamernl.isAvailable!({ ...d, id: 'kamernl:675658', propertyId: null, firstSeenAt: '', lastSeenAt: '', state: 'active', via: 'poll' } as Listing, ctx)).toBe(true);
    expect(await kamernl.isAvailable!({ ...d, id: 'kamernl:675658', propertyId: null, firstSeenAt: '', lastSeenAt: '', state: 'active', via: 'poll' } as Listing, ctxWith({}).ctx)).toBe(false);
  });

  test('contact reports the paywall without the plan', async () => {
    const { ctx } = ctxWith({});
    const listing = { sourceId: 'kamernl', externalId: '1', url: 'https://www.kamer.nl/huren/kamer-delft/x/1/', title: 'x', address: {}, contact: 'message', id: 'kamernl:1', propertyId: null, firstSeenAt: '', lastSeenAt: '', state: 'active', via: 'poll' } as Listing;
    expect(await kamernl.contact!(listing, { body: 'x', language: 'nl', profile: ctx.profile, dryRun: false }, ctx)).toMatchObject({ ok: false, needs: 'paid' });
  });

  test('checkSession sees the login link of a logged-out header', async () => {
    const { ctx } = ctxWith({ 'https://www.kamer.nl/': 'kamernl/search-delft.html' });
    expect(await kamernl.checkSession!(ctx)).toBe('none');
  });
});

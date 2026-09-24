import { describe, expect, test } from 'vitest';
import type { Listing, RawListing } from '@nlpf/core';
import { createHuurwoningenAdapter, huurwoningen } from '../../src/adapters/huurwoningen.js';
import { parseParariusCards } from '../../src/parsers/pararius-cards.js';
import { fixtureContext, readFixture } from '../../src/testing.js';
import { fakeBrowser } from './fake-page.js';

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
const DELFT = 'https://www.huurwoningen.nl/in/delft/?price=0-1400&since=3';
const now = new Date('2026-09-24T10:00:00Z');

function ctxWith(routes: Parameters<typeof fakeBrowser>[0], config: Record<string, unknown> = threeCities) {
  const browser = fakeBrowser(routes);
  return { ctx: fixtureContext({ sourceId: 'huurwoningen', routes: [], config, browser, now }), browser };
}

const asListing = (l: RawListing): Listing => ({ ...l, id: `${l.sourceId}:${l.externalId}`, propertyId: null, firstSeenAt: '', lastSeenAt: '', state: 'active', via: 'poll' });

describe('huurwoningen', () => {
  test('declares the Premium paywall, a headed browser, and terms that forbid automation', () => {
    expect(huurwoningen.capabilities).toMatchObject({
      search: 'browser',
      contact: 'form',
      login: 'required',
      paid: { feature: 'contact', plan: 'huurwoningen-premium' },
      terms: 'forbids',
      browser: 'headed',
    });
  });

  test('buildSearches encodes town, price and the last day in the site’s own parameters', () => {
    const { ctx } = ctxWith({});
    expect(huurwoningen.buildSearches(ctx.searches, ctx.source).map((r) => r.url)).toEqual([
      DELFT,
      'https://www.huurwoningen.nl/in/rotterdam/?price=0-1400&since=3',
      'https://www.huurwoningen.nl/in/den-haag/?price=0-1400&since=3',
    ]);
  });

  test('the shared card parser reads both Pararius and Huurwoningen pages', () => {
    const para = parseParariusCards(readFixture('pararius/search-delft.html'), { sourceId: 'pararius', baseUrl: 'https://www.pararius.nl/huurwoningen/delft' });
    const huur = parseParariusCards(readFixture('huurwoningen/search-delft.html'), { sourceId: 'huurwoningen', baseUrl: 'https://www.huurwoningen.nl/in/delft/' });
    expect(para.listings).toHaveLength(17);
    expect(para.skipped).toBe(6);
    expect(huur.listings).toHaveLength(30);
    expect(huur.total).toBe(50);
    expect(huur.nextPage).toBe('https://www.huurwoningen.nl/in/delft/?page=2');
    for (const l of [...para.listings, ...huur.listings]) {
      expect(l.externalId).toMatch(/^[0-9a-f]{8}$/);
      expect(l.url.startsWith(`https://www.${l.sourceId}.nl/`)).toBe(true);
      expect(l.title).toMatch(/^(Appartement|Huis|Studio|Kamer) /);
      expect(l.address.city).toBe('Delft');
      expect(l.address.postcode).toMatch(/^\d{4} [A-Z]{2}$/);
      expect(l.sizeM2).toBeGreaterThan(0);
      expect(l.type).toBeDefined();
    }
  });

  test('search maps the recorded cards, with bare rent and service costs from the transparency badge', async () => {
    const adapter = createHuurwoningenAdapter({ maxPages: 1 });
    const { ctx, browser } = ctxWith({ [DELFT]: 'huurwoningen/search-delft.html' });
    const listings = await adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx);
    expect(browser.sessions).toEqual([{ headed: true }]);
    expect(listings).toHaveLength(30);
    expect(listings[0]).toEqual({
      sourceId: 'huurwoningen',
      externalId: '9a4df4ba',
      url: 'https://www.huurwoningen.nl/huren/delft/9a4df4ba/van-foreestweg/',
      title: 'Appartement Van Foreestweg',
      priceEur: 1415,
      priceBasis: 'excl',
      serviceCostsEur: 285,
      sizeM2: 70,
      rooms: 3,
      type: 'apartment',
      furnishing: 'furnished',
      address: { street: 'Van Foreestweg', postcode: '2614 CM', city: 'Delft', neighbourhood: 'Kuyperwijk-Noord' },
      images: [expect.stringMatching(/^https:\/\//)],
      contact: 'form',
      contactUrl: 'https://www.huurwoningen.nl/huren/delft/9a4df4ba/van-foreestweg/',
      language: 'nl',
      extra: expect.objectContaining({ uuid: '9a4df4ba-2ed6-5cfe-960b-58c2fa6397e1', agentId: 'a9bfa7b7-456e-55a3-bed9-a43e0ae69a50' }),
    });
    const single = listings.find((l) => l.externalId === 'baa7064c');
    expect(single).toMatchObject({ priceEur: 1950, priceBasis: 'unknown' });
    expect(single?.serviceCostsEur).toBeUndefined();
  });

  test('follows the next page and drops repeats', async () => {
    const adapter = createHuurwoningenAdapter({ pageGapMs: 0 });
    const { ctx, browser } = ctxWith({
      [DELFT]: 'huurwoningen/search-delft.html',
      'https://www.huurwoningen.nl/in/delft/?page=2': 'huurwoningen/search-delft.html',
    });
    expect(await adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx)).toHaveLength(30);
    expect(browser.visits).toEqual([DELFT, 'https://www.huurwoningen.nl/in/delft/?page=2']);
  });

  test('detail reads the listing page', async () => {
    const url = 'https://www.huurwoningen.nl/huren/delft/1a2838c6/pierre-van-hauwelaan/';
    const { ctx } = ctxWith({ [url]: 'huurwoningen/detail-pierre-van-hauwelaan.html' });
    const base: RawListing = { sourceId: 'huurwoningen', externalId: '1a2838c6', url, title: 'Appartement Pierre van Hauwelaan', address: { city: 'Delft' }, contact: 'form' };
    expect(await huurwoningen.detail!(base, ctx)).toMatchObject({
      priceEur: 1180,
      sizeM2: 43,
      rooms: 2,
      bedrooms: 1,
      energyLabel: 'A++++',
      availableFrom: '2026-09-24',
      publishedAt: '2026-09-22T22:00:00.000Z',
      address: { city: 'Delft', postcode: '2625 WL', neighbourhood: 'Het Rode Dorp' },
      contact: 'form',
      contactUrl: url,
    });
  });

  test('contact without the Premium plan reports the paywall; with it, hands the reaction to a person', async () => {
    const listing = asListing({ sourceId: 'huurwoningen', externalId: '1a2838c6', url: 'https://www.huurwoningen.nl/huren/delft/1a2838c6/pierre-van-hauwelaan/', title: 'x', address: {}, contact: 'form' });
    const msg = { body: 'Hallo', language: 'nl' as const, profile: ctxWith({}).ctx.profile, dryRun: false };
    expect(await huurwoningen.contact!(listing, msg, ctxWith({}).ctx)).toMatchObject({ ok: false, needs: 'paid' });
    const paid = ctxWith({}, { ...threeCities, sources: { huurwoningen: { paidPlan: 'huurwoningen-premium' } } }).ctx;
    const r = await huurwoningen.contact!(listing, msg, paid);
    expect(r.ok).toBe(false);
    expect(r.needs).toBeUndefined();
    expect(r.error).toContain(listing.url);
  });

  test('checkSession reads the masthead', async () => {
    const { ctx } = ctxWith({ 'https://www.huurwoningen.nl/': 'huurwoningen/search-delft.html' });
    expect(await huurwoningen.checkSession!(ctx)).toBe('none');
  });
});

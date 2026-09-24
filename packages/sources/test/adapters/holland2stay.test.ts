import { describe, expect, test } from 'vitest';
import type { Listing } from '@nlpf/core';
import { createHolland2StayAdapter, findProducts, holland2stay, mapHolland2StayProducts } from '../../src/adapters/holland2stay.js';
import { SourceBlockedError } from '../../src/runtime/errors.js';
import { detectChallenge } from '../../src/runtime/fetch.js';
import { fixtureContext, readFixture } from '../../src/testing.js';
import { fakeBrowser } from './fake-page.js';

const now = new Date('2026-09-24T10:00:00Z');
const DELFT = 'https://www.holland2stay.com/residences?page=1&city%5Bfilter%5D=Delft%2C6186';
const config = {
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
const products = () => findProducts(JSON.parse(readFixture('holland2stay/products.json')));

function ctxWith(routes: Parameters<typeof fakeBrowser>[0], captured: unknown[] = []) {
  const browser = fakeBrowser(routes);
  browser.evaluate = () => captured;
  return { ctx: fixtureContext({ sourceId: 'holland2stay', routes: [], config, browser, now }), browser };
}

describe('holland2stay', () => {
  test('assisted mode: booking contact, terms that forbid automation, a headed browser', () => {
    expect(holland2stay.capabilities).toMatchObject({ search: 'browser', contact: 'booking', login: 'required', terms: 'forbids', browser: 'headed' });
    expect(holland2stay.loginUrl).toBe('https://www.holland2stay.com/residences');
  });

  test('buildSearches uses the verified Delft filter and narrows other towns itself', () => {
    const { ctx } = ctxWith({});
    expect(holland2stay.buildSearches(ctx.searches, ctx.source)).toEqual([
      { key: 'city:delft', label: 'Holland2Stay Delft', url: DELFT, params: { cities: 'delft' } },
      { key: 'towns:rotterdam,den haag', label: 'Holland2Stay', url: 'https://www.holland2stay.com/residences?page=1', params: { cities: 'rotterdam,den haag' } },
    ]);
  });

  test('maps GraphQL units, including available_startdate, and skips reserved ones', () => {
    const listings = mapHolland2StayProducts(products(), { cities: ['delft'] });
    expect(listings).toEqual([
      {
        sourceId: 'holland2stay',
        externalId: 'VBL-12-301',
        url: 'https://www.holland2stay.com/residences/voorbeeldlaan-12-301.html',
        title: 'Voorbeeldlaan 12-301, Delft',
        priceEur: 812.5,
        priceBasis: 'excl',
        serviceCostsEur: 172.87,
        sizeM2: 26,
        rooms: 1,
        type: 'studio',
        furnishing: 'furnished',
        energyLabel: 'A',
        availableFrom: '2026-10-01',
        address: { street: 'Voorbeeldlaan', houseNumber: '12', addition: '301', city: 'Delft' },
        images: [
          'https://www.holland2stay.com/media/catalog/product/example/voorbeeldlaan-1.jpg',
          'https://www.holland2stay.com/media/catalog/product/example/voorbeeldlaan-2.jpg',
        ],
        contact: 'booking',
        contactUrl: 'https://www.holland2stay.com/residences/voorbeeldlaan-12-301.html',
        language: 'en',
        extra: {
          sku: 'VBL-12-301',
          status: 'available',
          statusId: '179',
          bookingUrl: 'https://www.holland2stay.com/residences/voorbeeldlaan-12-301.html',
          minimumStayMonths: 6,
          contract: 'Indefinite',
          maxPersons: 1,
        },
      },
      expect.objectContaining({
        externalId: 'VBL-12-512',
        contact: 'lottery',
        availableFrom: '2026-11-01',
        rooms: 2,
        type: 'apartment',
        furnishing: 'upholstered',
        extra: expect.objectContaining({ status: 'lottery', lotterySubscribers: 143 }),
      }),
    ]);
    const all = mapHolland2StayProducts(products());
    expect(all.map((l) => l.externalId)).toEqual(['VBL-12-301', 'VBL-12-512', 'HVK-7-04']);
    // 2050-01-01 means "no next contract date" and is not passed on.
    expect(all[2]?.availableFrom).toBeUndefined();
  });

  test('search reads the unit data the page received', async () => {
    const { ctx, browser } = ctxWith({ [DELFT]: { html: '<!doctype html><title>Residences</title><div id="__next"></div>' } }, [readFixture('holland2stay/products.json')]);
    const listings = await holland2stay.search(holland2stay.buildSearches(ctx.searches, ctx.source)[0]!, ctx);
    expect(listings.map((l) => l.externalId)).toEqual(['VBL-12-301', 'VBL-12-512']);
    expect(browser.sessions).toEqual([{ headed: true }]);
    expect(browser.open()).toBe(0);
  });

  test('the recorded Turnstile page is detected as blocked, never clicked', async () => {
    const page = readFixture('holland2stay/challenge.html');
    expect(detectChallenge(page, 'text/html')).toBe('cf-chl');
    const adapter = createHolland2StayAdapter({ waitMs: 300 });
    const { ctx, browser } = ctxWith({ [DELFT]: { file: 'holland2stay/challenge.html', status: 403 } });
    const err = await adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceBlockedError);
    expect(err).toMatchObject({ status: 403, marker: 'turnstile' });
    expect((err as Error).message).toContain('nlpf connect holland2stay');
    expect(browser.open()).toBe(0);
  });

  test('contact never books: it asks for a person and hands over the booking page', async () => {
    const [unit] = mapHolland2StayProducts(products(), { cities: ['delft'] });
    const listing: Listing = { ...unit!, id: 'holland2stay:VBL-12-301', propertyId: null, firstSeenAt: '', lastSeenAt: '', state: 'active', via: 'poll' };
    const { ctx, browser } = ctxWith({});
    const result = await holland2stay.contact!(listing, { body: 'x', language: 'en', profile: ctx.profile, dryRun: false }, ctx);
    expect(result).toMatchObject({ ok: false, channel: 'booking', needs: 'human', evidence: 'https://www.holland2stay.com/residences/voorbeeldlaan-12-301.html' });
    expect(listing.extra?.bookingUrl).toBe('https://www.holland2stay.com/residences/voorbeeldlaan-12-301.html');
    expect(browser.sessions).toHaveLength(0);
  });

  test('checkSession is ok once the page shows data, expired while the Turnstile is up', async () => {
    const adapter = createHolland2StayAdapter({ checkWaitMs: 300 });
    const all = 'https://www.holland2stay.com/residences?page=1';
    const blocked = ctxWith({ [all]: { file: 'holland2stay/challenge.html', status: 403 } });
    expect(await adapter.checkSession!(blocked.ctx)).toBe('expired');
    const open = ctxWith({ [all]: { html: '<!doctype html><div id="__next"></div>' } }, [readFixture('holland2stay/products.json')]);
    expect(await adapter.checkSession!(open.ctx)).toBe('ok');
  });
});

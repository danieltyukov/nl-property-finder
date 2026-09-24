import { describe, expect, test } from 'vitest';
import type { InboundMessage } from '@nlpf/core';
import { SourceBlockedError } from '../../src/runtime/errors.js';
import { createParariusAdapter, mastheadLoginState, pararius } from '../../src/adapters/pararius.js';
import { browserAdapters } from '../../src/builtin/browser.js';
import { parseParariusCards, parseParariusDetail, parariusListingId } from '../../src/parsers/pararius-cards.js';
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

const DELFT = 'https://www.pararius.nl/huurwoningen/delft/0-1400/sinds-1';
const now = new Date('2026-09-24T10:00:00Z');

function ctxWith(routes: Parameters<typeof fakeBrowser>[0], config: Record<string, unknown> = threeCities) {
  const browser = fakeBrowser(routes);
  const ctx = fixtureContext({ sourceId: 'pararius', routes: [], config, browser, now });
  return { ctx, browser };
}

describe('browser adapter group', () => {
  test('registers the five browser-driven sources, all in a headed browser', () => {
    const all = browserAdapters();
    expect(all.map((a) => a.id)).toEqual(['pararius', 'holland2stay', 'huurwoningen', 'kamernl', 'xior']);
    expect(all.every((a) => a.capabilities.browser === 'headed' && a.capabilities.search === 'browser')).toBe(true);
    expect(Object.fromEntries(all.map((a) => [a.id, a.capabilities.terms]))).toEqual({
      pararius: 'forbids',
      holland2stay: 'forbids',
      huurwoningen: 'forbids',
      kamernl: 'unknown',
      xior: 'unknown',
    });
    expect(Object.fromEntries(all.filter((a) => a.capabilities.paid).map((a) => [a.id, a.capabilities.paid?.plan]))).toEqual({
      huurwoningen: 'huurwoningen-premium',
      kamernl: 'kamernl-premium',
    });
  });
});

describe('pararius capabilities', () => {
  test('declares a headed browser, a login, and terms that forbid automation', () => {
    expect(pararius.capabilities).toMatchObject({ search: 'browser', contact: 'form', login: 'required', terms: 'forbids', browser: 'headed' });
    expect(pararius.capabilities.paid).toBeUndefined();
    expect(pararius.loginUrl).toBe('https://www.pararius.nl/inloggen');
  });
});

describe('pararius buildSearches', () => {
  test('puts city, price and the last day in the path, one request per municipality', () => {
    const { ctx } = ctxWith({});
    const reqs = pararius.buildSearches(ctx.searches, ctx.source);
    expect(reqs.map((r) => r.url)).toEqual([
      DELFT,
      'https://www.pararius.nl/huurwoningen/rotterdam/0-1400/sinds-1',
      'https://www.pararius.nl/huurwoningen/den-haag/0-1400/sinds-1',
    ]);
    expect(new Set(reqs.map((r) => r.key)).size).toBe(3);
  });

  test('merges searches per town, rounds prices to the dropdown values and adds a single type', () => {
    const { ctx } = ctxWith({}, {
      searches: [
        { id: 'a', name: 'A', regions: [{ name: 'Delft', municipalities: ['Delft'] }], priceMinEur: 450, priceMaxEur: 1100, types: ['studio'] },
        { id: 'b', name: 'B', regions: [{ name: 'Delft', municipalities: ['delft'] }], priceMinEur: 600, priceMaxEur: 1450, types: ['studio'] },
      ],
      sources: { pararius: { searchUrls: ['https://www.pararius.nl/huurwoningen/leiden/sinds-3'] } },
    });
    const reqs = pararius.buildSearches(ctx.searches, ctx.source);
    expect(reqs.map((r) => r.url)).toEqual([
      'https://www.pararius.nl/huurwoningen/delft/studio/400-1500/sinds-1',
      'https://www.pararius.nl/huurwoningen/leiden/sinds-3',
    ]);
  });

  test('a search without named towns reads the whole country', () => {
    const { ctx } = ctxWith({}, { searches: [{ id: 'nl', name: 'NL', regions: [{ name: 'Randstad', postcodes: ['2611-2629'] }] }] });
    expect(pararius.buildSearches(ctx.searches, ctx.source).map((r) => r.url)).toEqual(['https://www.pararius.nl/huurwoningen/nederland/sinds-1']);
  });
});

describe('pararius search', () => {
  test('maps the recorded cards and skips homes under option or rented', async () => {
    const { ctx, browser } = ctxWith({ [DELFT]: 'pararius/search-delft.html' });
    const [req] = pararius.buildSearches(ctx.searches, ctx.source);
    const listings = await pararius.search(req!, ctx);

    expect(browser.sessions).toEqual([{ headed: true }]);
    expect(browser.open()).toBe(0);
    // 23 cards on the page: 2 "Onder optie" and 4 "Verhuurd onder voorbehoud" are skipped.
    expect(listings).toHaveLength(17);
    expect(listings[0]).toEqual({
      sourceId: 'pararius',
      externalId: 'fd826b6c',
      url: 'https://www.pararius.nl/appartement-te-huur/delft/fd826b6c/kruisstraat',
      title: 'Appartement Kruisstraat 46',
      priceEur: 2450,
      priceBasis: 'unknown',
      sizeM2: 102,
      rooms: 2,
      type: 'apartment',
      furnishing: 'upholstered',
      address: { street: 'Kruisstraat', houseNumber: '46', postcode: '2611 MJ', city: 'Delft', neighbourhood: 'In de Veste' },
      images: [expect.stringMatching(/^https:\/\/casco-media-prod\.global\.ssl\.fastly\.net\/listings\/api\/media\/fd826b6c-/)],
      agent: { name: 'Björnd Makelaardij' },
      contact: 'form',
      contactUrl: 'https://www.pararius.nl/contact/fd826b6c-b92c-59b2-acf8-4175ad916d1f',
      language: 'nl',
      extra: {
        uuid: 'fd826b6c-b92c-59b2-acf8-4175ad916d1f',
        agentPage: 'https://www.pararius.nl/makelaars/delft/bjornd-makelaardij',
        imageOrigin: 'images.realworks.nl',
      },
    });
    const ids = listings.map((l) => l.externalId);
    expect(ids).not.toContain('8615d6eb'); // Martinus Nijhofflaan, onder optie
    expect(ids).not.toContain('62c02427'); // Brabantse Turfmarkt, verhuurd onder voorbehoud
    for (const l of listings) {
      expect(l.url).toMatch(/^https:\/\/www\.pararius\.nl\/[a-z]+-te-huur\/delft\/[0-9a-f]{8}\/[a-z0-9-]+$/);
      expect(l.address.city).toBe('Delft');
      expect(l.priceEur).toBeGreaterThan(0);
      expect(l.contactUrl).toMatch(/^https:\/\/www\.pararius\.nl\/contact\/[0-9a-f-]{36}$/);
    }
    const vlouw = listings.find((l) => l.externalId === '9a4d5084');
    expect(vlouw?.address).toMatchObject({ street: 'De Vlouw', houseNumber: '1', addition: 'C' });
    expect(listings.find((l) => l.externalId === 'c5637b92')?.priceEur).toBe(2170);
  });

  test('a page that found nothing in the town yields nothing, not the nearby homes it shows', async () => {
    const { ctx } = ctxWith({ [DELFT]: 'pararius/search-delft-sinds-1-nearby.html' });
    const [req] = pararius.buildSearches(ctx.searches, ctx.source);
    expect(await pararius.search(req!, ctx)).toEqual([]);
    const page = parseParariusCards(readFixture('pararius/search-delft-sinds-1-nearby.html'), { sourceId: 'pararius', baseUrl: DELFT });
    expect(page.noResults).toBe(true);
  });

  test('waits out a Cloudflare check that clears by itself', async () => {
    const challenge = { file: 'holland2stay/challenge.html', status: 403 };
    const adapter = createParariusAdapter({ waitMs: 5_000 });
    const { ctx } = ctxWith({ [DELFT]: [challenge, challenge, { file: 'pararius/search-delft.html' }] });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    expect(await adapter.search(req!, ctx)).toHaveLength(17);
  });

  test('a check that does not clear is reported as blocked, so the scheduler backs off', async () => {
    const adapter = createParariusAdapter({ waitMs: 300 });
    const { ctx, browser } = ctxWith({ [DELFT]: { file: 'holland2stay/challenge.html', status: 403 } });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const err = await adapter.search(req!, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceBlockedError);
    expect(err).toMatchObject({ status: 403, marker: 'cf-chl' });
    expect(browser.open()).toBe(0);
  });
});

describe('pararius listing pages', () => {
  const url = 'https://www.pararius.nl/appartement-te-huur/delft/fd826b6c/kruisstraat';

  test('the id is the 8-hex URL segment the alert parser uses too', () => {
    expect(parariusListingId(url)).toBe('fd826b6c');
    expect(parariusListingId('https://www.pararius.com/apartment-for-rent/delft/FD826B6C/kruisstraat')).toBe('fd826b6c');
    expect(parariusListingId('https://www.huurwoningen.nl/huren/delft/1a2838c6/pierre-van-hauwelaan/')).toBe('1a2838c6');
    expect(parariusListingId('https://www.pararius.nl/huurwoningen/delft')).toBeUndefined();
  });

  test('detail reads the features, the description and the agent', async () => {
    const { ctx } = ctxWith({ [url]: 'pararius/detail-kruisstraat.html' });
    const [listing] = await pararius.search(
      pararius.buildSearches(ctx.searches, ctx.source)[0]!,
      ctxWith({ [DELFT]: 'pararius/search-delft.html' }).ctx,
    );
    const d = await pararius.detail!(listing!, ctx);
    expect(d).toMatchObject({
      externalId: 'fd826b6c',
      priceEur: 2450,
      depositEur: 2450,
      bedrooms: 1,
      energyLabel: 'A++',
      availableFrom: '2026-09-24',
      publishedAt: '2026-09-21T22:00:00.000Z',
      contact: 'form',
      contactUrl: 'https://www.pararius.nl/contact/fd826b6c-b92c-59b2-acf8-4175ad916d1f',
      agent: { name: 'Björnd Makelaardij', phone: '+31152135139' },
    });
    expect(d.description).toMatch(/\w{3,}/);
    expect(d.extra?.clickout).toBeUndefined();
  });

  test('the parser tells a Pararius contact form from a clickout to the advertiser', () => {
    const html = readFixture('pararius/detail-kruisstraat.html');
    expect(parseParariusDetail(html, url, now)).toMatchObject({ clickout: false, unavailable: false, status: 'Te huur' });
    // The clickout variant of the reaction button, as ListingReactionButton.wc.js expects it (recorded 2026-09-24).
    const clickout = html.replaceAll(
      /<wc-listing-reaction-button class="listing-reaction-button listing-reaction-button--contact-agent">[\s\S]*?<\/wc-listing-reaction-button>/g,
      '<wc-listing-reaction-button class="listing-reaction-button listing-reaction-button--click-out"><button class="button button--secondary">Contact met de aanbieder</button></wc-listing-reaction-button>',
    );
    expect(parseParariusDetail(clickout, url, now)).toMatchObject({ clickout: true });
    expect(parseParariusDetail(clickout, url, now).contactUrl).toBeUndefined();
  });

  test('isAvailable is false for a removed listing and true for a live one', async () => {
    const { ctx } = ctxWith({ [url]: 'pararius/detail-kruisstraat.html' });
    expect(await pararius.isAvailable!({ ...(await listingFromSearch()), id: 'pararius:fd826b6c', propertyId: null, firstSeenAt: '', lastSeenAt: '', state: 'active', via: 'poll' }, ctx)).toBe(true);
    const gone = ctxWith({}).ctx;
    expect(await pararius.isAvailable!({ ...(await listingFromSearch()), id: 'pararius:fd826b6c', propertyId: null, firstSeenAt: '', lastSeenAt: '', state: 'active', via: 'poll' }, gone)).toBe(false);
  });
});

async function listingFromSearch() {
  const { ctx } = ctxWith({ [DELFT]: 'pararius/search-delft.html' });
  const [listing] = await pararius.search(pararius.buildSearches(ctx.searches, ctx.source)[0]!, ctx);
  return listing!;
}

describe('pararius session check', () => {
  test('reads the login state from the masthead without opening the login page', async () => {
    const loggedOut = readFixture('pararius/search-delft.html');
    expect(mastheadLoginState(loggedOut)).toBe('out');
    const { ctx, browser } = ctxWith({ 'https://www.pararius.nl/': { html: loggedOut } });
    expect(await pararius.checkSession!(ctx)).toBe('none');
    expect(browser.visits).toEqual(['https://www.pararius.nl/']);

    const loggedIn = loggedOut.replace(/<a[^>]*masthead__button--login[\s\S]*?<\/a>/, '');
    expect(mastheadLoginState(loggedIn)).toBe('in');
    const second = ctxWith({ 'https://www.pararius.nl/': { html: loggedIn } });
    expect(await pararius.checkSession!(second.ctx)).toBe('ok');
  });
});

describe('pararius alert emails', () => {
  test('turns a saved-search email into listings keyed like the polled ones', () => {
    const mail: InboundMessage = {
      id: '<alert-1@pararius.nl>',
      channel: 'email',
      from: { name: 'Pararius', address: 'noreply@pararius.nl' },
      subject: '2 nieuwe huurwoningen in Delft',
      text: '',
      html: readFixture('pararius/alert-email.html'),
      at: '2026-09-24T05:00:00Z',
      attachments: [],
    };
    const listings = pararius.parseAlertEmail!(mail);
    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({
      sourceId: 'pararius',
      externalId: 'fd826b6c',
      url: 'https://www.pararius.nl/appartement-te-huur/delft/fd826b6c/kruisstraat',
      title: 'Appartement Kruisstraat 46',
      priceEur: 2450,
      sizeM2: 102,
      rooms: 2,
      type: 'apartment',
      furnishing: 'upholstered',
      address: { street: 'Kruisstraat', houseNumber: '46', postcode: '2611 MJ', city: 'Delft', neighbourhood: 'In de Veste' },
      contact: 'form',
    });
    expect(listings[1]).toMatchObject({ externalId: 'b5a5016c', priceEur: 1190, furnishing: 'furnished' });
    expect(pararius.alertSenders).toContain('noreply@pararius.nl');
  });

  test('falls back to the plain-text part', () => {
    const mail: InboundMessage = {
      id: '<alert-2@pararius.nl>',
      channel: 'email',
      from: { address: 'noreply@pararius.nl' },
      text: 'Nieuw aanbod\n\nStudio Phoenixstraat, 2611 AL Delft (Centrum), € 975 per maand\nhttps://www.pararius.nl/studio-te-huur/delft/a3b1c2d4/phoenixstraat\n',
      at: '2026-09-24T05:00:00Z',
      attachments: [],
    };
    expect(pararius.parseAlertEmail!(mail)).toEqual([
      expect.objectContaining({ externalId: 'a3b1c2d4', type: 'studio', priceEur: 975, address: expect.objectContaining({ postcode: '2611 AL', city: 'Delft' }) }),
    ]);
  });
});

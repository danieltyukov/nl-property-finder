import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createRotsvastAdapter } from '../../src/adapters/rotsvast.js';
import { fixtureContext, readFixture } from '../../src/testing.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('rotsvast', () => {
  const adapter = createRotsvastAdapter();

  test('is a regional agent reached by email, without login or fee', () => {
    expect(adapter.id).toBe('rotsvast');
    expect(adapter.capabilities).toEqual({ search: 'html', detail: true, contact: 'email', login: 'none', terms: 'unknown' });
    expect(adapter.regions).toEqual(expect.arrayContaining(['delft', 'rotterdam', 'den haag', 'leiden', 'zoetermeer']));
  });

  test("buildSearches uses the site's search form: place, radius and the next price step", () => {
    expect(adapter.buildSearches(config.searches, SourceConfigSchema.parse({})).map((r) => r.url)).toEqual([
      'https://www.rotsvast.nl/huren/?search=Delft&radius=5&price_to=1500',
      'https://www.rotsvast.nl/huren/?search=Rotterdam&radius=5&price_to=1500',
      'https://www.rotsvast.nl/huren/?search=Den+Haag&radius=5&price_to=1500',
    ]);
    const all = ConfigSchema.parse({});
    expect(adapter.buildSearches(all.searches, SourceConfigSchema.parse({})).map((r) => r.url)).toEqual(['https://www.rotsvast.nl/huren/']);
  });

  test('search maps the recorded list page', async () => {
    const ctx = fixtureContext({ sourceId: 'rotsvast', config, now: NOW, routes: { 'rotsvast.nl/huren/': 'rotsvast/huren.html' } });
    const listings = await adapter.search({ key: 'nl', label: 'Rotsvast', url: 'https://www.rotsvast.nl/huren/' }, ctx);
    expect(listings).toHaveLength(10);
    expect(listings[0]).toMatchObject({
      sourceId: 'rotsvast',
      externalId: 'H1025010421',
      url: 'https://www.rotsvast.nl/huren/oppert-rotterdam-h1025010421/',
      title: 'Oppert, Rotterdam',
      priceEur: 3150,
      sizeM2: 117,
      bedrooms: 2,
      furnishing: 'furnished',
      availableFrom: '2026-09-24',
      address: { street: 'Oppert', city: 'Rotterdam' },
      agent: { name: 'Rotsvast', url: 'https://www.rotsvast.nl' },
      contact: 'email',
    });
    expect(listings[0]?.images?.[0]).toMatch(/^https:\/\/www\.rotsvast\.nl\/app\/uploads\//);
    expect(listings[6]).toMatchObject({ address: { street: 'Kerkstraat', city: 'Hilversum' }, furnishing: 'upholstered', availableFrom: '2026-10-01' });
  });

  test('search skips a card labelled Verhuurd', async () => {
    const ctx = fixtureContext({ sourceId: 'rotsvast', config, now: NOW, routes: { 'search=Delft': 'rotsvast/delft.html' } });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const listings = await adapter.search(req!, ctx);
    expect(listings.map((l) => l.externalId)).toEqual(['H102523797']);
    expect(listings[0]).toMatchObject({ address: { street: 'De Genestetstraat', city: 'Delft' }, availableFrom: '2023-02-01', priceEur: 250 });
  });

  test('detail reads the full address, deposit and the branch that answers email', async () => {
    const list = fixtureContext({ sourceId: 'rotsvast', now: NOW, routes: { 'rotsvast.nl/huren/': 'rotsvast/huren.html' } });
    const [card] = await adapter.search({ key: 'nl', label: 'Rotsvast', url: 'https://www.rotsvast.nl/huren/' }, list);
    const ctx = fixtureContext({ sourceId: 'rotsvast', now: NOW, routes: { 'oppert-rotterdam-h1025010421': 'rotsvast/detail-oppert.html' } });
    const full = await adapter.detail!(card!, ctx);
    expect(full).toMatchObject({
      address: { street: 'Oppert', houseNumber: '274', postcode: '3011 HV', city: 'Rotterdam' },
      rooms: 4,
      depositEur: 6000,
      type: 'apartment',
      agent: { name: 'Rotsvast Rotterdam', url: 'https://www.rotsvast.nl', email: 'rotterdam@rotsvast.nl', phone: '010-4762323' },
    });
    expect(full.description).toMatch(/^Exclusive penthouse with spacious balcony/);
  });

  test('isAvailable is false once the listing page is gone', async () => {
    const listing = { url: 'https://www.rotsvast.nl/huren/oppert-rotterdam-h1025010421/' } as never;
    const gone = fixtureContext({ sourceId: 'rotsvast', routes: [{ match: 'oppert', status: 404, body: 'weg' }] });
    expect(await adapter.isAvailable!(listing, gone)).toBe(false);
    const live = fixtureContext({ sourceId: 'rotsvast', routes: { oppert: 'rotsvast/detail-oppert.html' } });
    expect(await adapter.isAvailable!(listing, live)).toBe(true);
    const rented = readFixture('rotsvast/detail-oppert.html').replace('<span class="label">Topper</span>', '<span class="label">Verhuurd</span>');
    const let_ = fixtureContext({ sourceId: 'rotsvast', routes: [{ match: 'oppert', body: rented, headers: { 'content-type': 'text/html' } }] });
    expect(await adapter.isAvailable!(listing, let_)).toBe(false);
  });
});

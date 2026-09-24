import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createNederwoonAdapter, parseNederwoonList } from '../../src/adapters/nederwoon.js';
import { fixtureContext, readFixture } from '../../src/testing.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('nederwoon', () => {
  const adapter = createNederwoonAdapter();

  test('is a regional agent whose viewings need a paid account', () => {
    expect(adapter.id).toBe('nederwoon');
    expect(adapter.capabilities).toEqual({
      search: 'html',
      detail: false,
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'nederwoon-account' },
      terms: 'unknown',
    });
    expect(adapter.regions).toEqual(expect.arrayContaining(['delft', 'rotterdam', 'den haag', 'utrecht']));
  });

  test('buildSearches asks per city, newest first, for homes and for rooms; the site has no price filter', () => {
    const urls = adapter.buildSearches(config.searches, SourceConfigSchema.parse({})).map((r) => r.url);
    expect(urls).toEqual([
      'https://www.nederwoon.nl/search?search_type=1&city=Delft&sort=1',
      'https://www.nederwoon.nl/search?search_type=3&city=Delft&sort=1',
      'https://www.nederwoon.nl/search?search_type=1&city=Rotterdam&sort=1',
      'https://www.nederwoon.nl/search?search_type=3&city=Rotterdam&sort=1',
      'https://www.nederwoon.nl/search?search_type=1&city=Den+Haag&sort=1',
      'https://www.nederwoon.nl/search?search_type=3&city=Den+Haag&sort=1',
    ]);
    const noRooms = ConfigSchema.parse({ searches: [{ id: 'a', name: 'A', types: ['apartment'], regions: [{ name: 'x', municipalities: ['Utrecht'] }] }] });
    expect(adapter.buildSearches(noRooms.searches, SourceConfigSchema.parse({})).map((r) => r.url)).toEqual([
      'https://www.nederwoon.nl/search?search_type=1&city=Utrecht&sort=1',
    ]);
    // The site answers "U dient een plaatsnaam op te geven" without a city.
    expect(adapter.buildSearches(ConfigSchema.parse({}).searches, SourceConfigSchema.parse({}))).toEqual([]);
  });

  test('search maps the recorded Utrecht page', async () => {
    const ctx = fixtureContext({ sourceId: 'nederwoon', now: NOW, routes: { 'city=Utrecht': 'nederwoon/utrecht.html' } });
    const listings = await adapter.search({ key: 'u', label: 'u', url: 'https://www.nederwoon.nl/search?search_type=1&city=Utrecht&sort=1' }, ctx);
    expect(listings).toHaveLength(9);
    expect(listings[0]).toMatchObject({
      sourceId: 'nederwoon',
      externalId: '38715',
      url: 'https://www.nederwoon.nl/huurwoning/vleuten/38715/appartement-droomtuinlaan',
      title: 'Droomtuinlaan, Vleuten',
      priceEur: 1725,
      priceBasis: 'excl',
      sizeM2: 95,
      rooms: 4,
      type: 'apartment',
      furnishing: 'unfurnished',
      availableFrom: '2026-10-01',
      address: { street: 'Droomtuinlaan', postcode: '3452 RL', city: 'Vleuten' },
      contact: 'none',
      extra: { views: 85 },
    });
    const byId = new Map(listings.map((l) => [l.externalId, l]));
    expect(byId.get('38626')).toMatchObject({ furnishing: 'furnished', address: { street: 'Drieharingstraat', postcode: '3511 BH', city: 'Utrecht' } });
    expect(byId.get('38626')?.address.lat).toBeCloseTo(52.0921, 3);
    expect(byId.get('38650')).toMatchObject({ type: 'studio', priceEur: 932.93, furnishing: 'upholstered', address: { city: 'Houten' } });
    expect(byId.get('38590')?.availableFrom).toBe('2026-09-24');
  });

  test('search reads the single Rotterdam result', async () => {
    const ctx = fixtureContext({ sourceId: 'nederwoon', config, now: NOW, routes: { 'city=Rotterdam': 'nederwoon/rotterdam.html' } });
    const req = adapter.buildSearches(ctx.searches, ctx.source).find((r) => r.url?.includes('search_type=1&city=Rotterdam'));
    const listings = await adapter.search(req!, ctx);
    expect(listings).toEqual([expect.objectContaining({ externalId: '38641', title: 'Statenplein, Rotterdam', priceEur: 1495, sizeM2: 74, rooms: 2 })]);
  });

  test('a card that says it is under option or rented is skipped', () => {
    const html = readFixture('nederwoon/utrecht.html').replace('Mooi appartement in Vleuten', 'Onder optie');
    const listings = parseNederwoonList(html, NOW);
    expect(listings).toHaveLength(8);
    expect(listings[0]?.externalId).toBe('38716');
  });
});

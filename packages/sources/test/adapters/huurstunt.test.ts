import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createHuurstuntAdapter } from '../../src/adapters/huurstunt.js';
import { fixtureContext } from '../../src/testing.js';
import { htmlAdapters } from '../../src/builtin/html.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('huurstunt', () => {
  const adapter = createHuurstuntAdapter();

  test('is one of the built-in HTML sources', () => {
    expect(htmlAdapters().map((a) => a.id)).toContain('huurstunt');
  });

  test('is a paid aggregator that is only ingested', () => {
    expect(adapter.id).toBe('huurstunt');
    expect(adapter.regions).toBe('nl');
    expect(adapter.capabilities).toMatchObject({
      search: 'html',
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'huurstunt-premium' },
      terms: 'unknown',
    });
  });

  test('buildSearches uses the city pages (filters are posted by a live component, not the URL)', () => {
    expect(adapter.buildSearches(config.searches, SourceConfigSchema.parse({})).map((r) => r.url)).toEqual([
      'https://www.huurstunt.nl/huren/delft',
      'https://www.huurstunt.nl/huren/rotterdam',
      'https://www.huurstunt.nl/huren/den-haag',
    ]);
    expect(adapter.buildSearches(ConfigSchema.parse({}).searches, SourceConfigSchema.parse({})).map((r) => r.url)).toEqual([
      'https://www.huurstunt.nl/huren/nederland',
    ]);
  });

  test('search joins the JSON-LD list with the cards and skips rented and optioned homes', async () => {
    const ctx = fixtureContext({ sourceId: 'huurstunt', config, now: NOW, routes: { '/huren/delft': 'huurstunt/delft.html' } });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const listings = await adapter.search(req!, ctx);
    // 25 in the JSON-LD: 6 under option and 3 rented (their cards carry no link) are left out.
    expect(listings).toHaveLength(16);
    expect(listings.map((l) => l.externalId)).not.toContain('foA4Y');
    expect(listings[0]).toMatchObject({
      sourceId: 'huurstunt',
      externalId: 'fxH5E',
      url: 'https://www.huurstunt.nl/appartement/huren/in/delft/kruisstraat/fxH5E',
      title: 'Kruisstraat, Delft',
      priceEur: 2450,
      priceBasis: 'excl',
      sizeM2: 102,
      rooms: 2,
      type: 'apartment',
      address: { street: 'Kruisstraat', city: 'Delft' },
      publishedAt: '2026-09-22T18:21:59.000Z',
      contact: 'none',
    });
    expect(listings[0]?.images).toHaveLength(4);
    // A card hidden behind an account still has its street and price in the JSON-LD.
    expect(listings[1]).toMatchObject({
      externalId: 'fxwuJ',
      title: 'Martinus Nijhofflaan, Delft',
      priceEur: 1361,
      address: { street: 'Martinus Nijhofflaan', city: 'Delft' },
      extra: { accountOnly: true },
    });
    expect(listings[1]?.sizeM2).toBeUndefined();
    const room = listings.find((l) => l.externalId === 'fgEaG');
    expect(room).toMatchObject({ type: 'room', sizeM2: 12, rooms: 1, priceEur: 600 });
    const studio = listings.find((l) => l.externalId === 'fpbJR');
    expect(studio).toMatchObject({ type: 'studio', sizeM2: 35 });
    const noStreet = listings.find((l) => l.externalId === 'dgih7');
    expect(noStreet).toMatchObject({ title: 'Delft', address: { city: 'Delft' }, priceEur: 1500 });
    expect(noStreet?.address.street).toBeUndefined();
  });
});

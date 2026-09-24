import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createRentolaAdapter } from '../../src/adapters/rentola.js';
import { fixtureContext } from '../../src/testing.js';
import { htmlAdapters } from '../../src/builtin/html.js';

const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('rentola', () => {
  const adapter = createRentolaAdapter();

  test('is one of the built-in HTML sources', () => {
    expect(htmlAdapters().map((a) => a.id)).toContain('rentola');
  });

  test('is a paid re-aggregator that is only ingested', () => {
    expect(adapter.id).toBe('rentola');
    expect(adapter.regions).toBe('nl');
    expect(adapter.capabilities).toMatchObject({
      search: 'html',
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'rentola-premium' },
      terms: 'unknown',
    });
  });

  test('buildSearches puts the city and the rent ceiling in the query string', () => {
    const reqs = adapter.buildSearches(config.searches, SourceConfigSchema.parse({}));
    expect(reqs.map((r) => r.url)).toEqual([
      'https://rentola.nl/huren?location=Delft&rent=0-1400',
      'https://rentola.nl/huren?location=Rotterdam&rent=0-1400',
      'https://rentola.nl/huren?location=Den+Haag&rent=0-1400',
    ]);
    const open = ConfigSchema.parse({ searches: [{ id: 'a', name: 'A', regions: [{ name: 'x', municipalities: ['Utrecht'] }] }] });
    expect(adapter.buildSearches(open.searches, SourceConfigSchema.parse({})).map((r) => r.url)).toEqual(['https://rentola.nl/huren?location=Utrecht']);
  });

  test('search maps the JSON-LD results with full addresses', async () => {
    const ctx = fixtureContext({ sourceId: 'rentola', config, routes: { 'location=Delft': 'rentola/delft.html' } });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const listings = await adapter.search(req!, ctx);
    expect(listings).toHaveLength(21);
    expect(listings[0]).toMatchObject({
      sourceId: 'rentola',
      externalId: 'p5dff1f',
      url: 'https://rentola.nl/listings/achterom-p5dff1f',
      title: 'Achterom 52, Delft',
      priceEur: 290,
      sizeM2: 8,
      bedrooms: 1,
      type: 'room',
      publishedAt: '2026-09-01T22:15:08.000Z',
      address: { street: 'Achterom', houseNumber: '52', postcode: '2611 PR', city: 'Delft' },
      contact: 'none',
    });
    expect(listings[0]?.address.lat).toBeCloseTo(52.0075, 3);
    const byId = new Map(listings.map((l) => [l.externalId, l]));
    // The name carries the real number; the geocoded address points at a neighbour, so its postcode is not trusted.
    expect(byId.get('p9543ed')?.address).toEqual({ street: 'Delflandplein', houseNumber: '442', city: 'Delft' });
    expect(byId.get('p849554')).toMatchObject({ type: 'studio', address: { street: 'Van Embdenstraat', houseNumber: '676', postcode: '2628 ZL', city: 'Delft' } });
    expect(byId.get('p952178')?.address).toMatchObject({ street: 'Brabantse Turfmarkt', houseNumber: '76', addition: 'H', postcode: '2611 CP' });
    expect(byId.get('p848792')?.address).toMatchObject({ street: 'Martinus Nijhofflaan', houseNumber: '2', addition: 'M-10', postcode: '2624 ES' });
    // "unnamed road" is not a street; the listing name has the address.
    expect(byId.get('pf1f198')?.address).toEqual({ street: 'De groene haven', houseNumber: '204', city: 'Delft' });
    expect(byId.get('p4fb749')).toMatchObject({ type: 'room', priceEur: 250 });
    expect(byId.get('p47ee1c')).toMatchObject({ type: 'apartment', bedrooms: 2, address: { street: 'Nijverheidspad', houseNumber: '187', postcode: '2624 MR' } });
  });

  test('the Rotterdam page recorded with rent=0-1400 only holds homes under the ceiling', async () => {
    const ctx = fixtureContext({ sourceId: 'rentola', config, routes: { 'location=Rotterdam': 'rentola/rotterdam-rent-1400.html' } });
    const req = adapter.buildSearches(ctx.searches, ctx.source).find((r) => r.key === 'rotterdam');
    const listings = await adapter.search(req!, ctx);
    expect(listings.length).toBeGreaterThan(15);
    expect(listings.every((l) => (l.priceEur ?? 0) <= 1400)).toBe(true);
    expect(listings.every((l) => l.address.city === 'Rotterdam')).toBe(true);
    expect(listings.find((l) => l.address.street === 'Zwart Janstraat')?.address).toMatchObject({ houseNumber: '68', addition: 'B-03', postcode: '3035 AV' });
  });
});

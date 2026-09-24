import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createStadswonenAdapter, STADSWONEN_API } from '../../src/adapters/stadswonen.js';
import { fixtureContext } from '../../src/testing.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('stadswonen', () => {
  const adapter = createStadswonenAdapter();

  test('is a Rotterdam-only portal that needs a registration to react', () => {
    expect(adapter.id).toBe('stadswonen');
    expect(adapter.regions).toEqual(['rotterdam']);
    expect(adapter.capabilities).toMatchObject({ search: 'json', contact: 'none', login: 'required', terms: 'unknown' });
  });

  test('buildSearches asks the site API for the whole list in one page; it has no price filter', () => {
    const reqs = adapter.buildSearches(config.searches, SourceConfigSchema.parse({}));
    expect(reqs).toHaveLength(1);
    const url = new URL(reqs[0]!.url!);
    expect(url.origin + url.pathname).toBe(STADSWONEN_API);
    expect(url.searchParams.get('qson')).toBe('filter:(),list:(page:1,sort:default,type:list)');
    expect(url.searchParams.get('size')).toBe('100');
  });

  test('search maps the recorded list', async () => {
    const ctx = fixtureContext({ sourceId: 'stadswonen', config, now: NOW, routes: { '/api/stadswonen/search/nl/aanbod': 'stadswonen/aanbod.json' } });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const listings = await adapter.search(req!, ctx);
    expect(listings).toHaveLength(32);
    const first = listings[0]!;
    expect(first).toMatchObject({
      sourceId: 'stadswonen',
      externalId: '6ab4dbe0496ed720dde9e922',
      url: 'https://www.stadswonenrotterdam.nl/nl/aanbod/6ab4dbe0496ed720dde9e922-scheepmakershaven-48a',
      title: 'Scheepmakershaven 48A',
      priceEur: 498.2,
      priceBasis: 'excl',
      serviceCostsEur: 151.27,
      sizeM2: 23,
      type: 'room',
      energyLabel: 'A',
      availableFrom: '2026-10-22',
      publishedAt: '2026-09-24T08:14:24.000Z',
      address: { street: 'Scheepmakershaven', houseNumber: '48', addition: 'A', city: 'Rotterdam', neighbourhood: 'Stadsdriehoek' },
      contact: 'none',
      language: 'nl',
    });
    expect(first.address.lat).toBeCloseTo(51.9162, 3);
    expect(first.extra).toMatchObject({ deadline: '2026-09-30T21:45:00Z', allocation: 'hospiteren', target: ['student'], ageMax: 27 });

    const byName = new Map(listings.map((l) => [l.title, l]));
    expect(byName.get('Ichthushof 144')).toMatchObject({ type: 'apartment', rooms: 3, sizeM2: 53, extra: { allocation: 'toewijzing', incomeMin: 51538 } });
    expect(byName.get('Coolhaven 222A 1')?.address).toMatchObject({ street: 'Coolhaven', houseNumber: '222', addition: 'A-1', city: 'Rotterdam' });
    expect(byName.get('Rivierstraat 41A /1')?.address).toMatchObject({ houseNumber: '41', addition: 'A-1' });
    expect(byName.get("'s-Gravendijkwal 155l")).toMatchObject({ type: 'studio', address: { street: "'s-Gravendijkwal", houseNumber: '155', addition: 'L' } });
    expect(byName.get('Laan op Zuid 181 j')?.address).toMatchObject({ street: 'Laan op Zuid', houseNumber: '181', addition: 'J' });
    // A missing energy label ("-") and zero rooms are left out rather than guessed.
    expect(byName.get('Coolhaven 222A 1')?.energyLabel).toBeUndefined();
    expect(byName.get('Coolhaven 222A 1')?.rooms).toBeUndefined();
  });

  test('isAvailable checks that the listing is still in the list and its deadline has not passed', async () => {
    const ctx = fixtureContext({ sourceId: 'stadswonen', now: NOW, routes: { '/api/stadswonen/search/nl/aanbod': 'stadswonen/aanbod.json' } });
    const [first] = await adapter.search(adapter.buildSearches(ctx.searches, ctx.source)[0]!, ctx);
    expect(await adapter.isAvailable!(first as never, ctx)).toBe(true);
    expect(await adapter.isAvailable!({ ...first, externalId: '000000000000000000000000' } as never, ctx)).toBe(false);
    const late = fixtureContext({
      sourceId: 'stadswonen',
      now: new Date('2026-10-01T00:00:00Z'),
      routes: { '/api/stadswonen/search/nl/aanbod': 'stadswonen/aanbod.json' },
    });
    expect(await adapter.isAvailable!(first as never, late)).toBe(false);
  });
});

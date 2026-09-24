import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createDirectwonenAdapter, parseDirectwonenList } from '../../src/adapters/directwonen.js';
import { fixtureContext, readFixture } from '../../src/testing.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('directwonen', () => {
  const adapter = createDirectwonenAdapter();

  test('is a paid aggregator that is only ingested', () => {
    expect(adapter.id).toBe('directwonen');
    expect(adapter.regions).toBe('nl');
    expect(adapter.capabilities).toEqual({
      search: 'html',
      detail: false,
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'directwonen-premium' },
      terms: 'unknown',
    });
  });

  test('buildSearches uses the city pages; price filters live in cookies, so they are not in the URL', () => {
    const reqs = adapter.buildSearches(config.searches, SourceConfigSchema.parse({}));
    expect(reqs.map((r) => r.url)).toEqual([
      'https://directwonen.nl/huurwoningen-huren/delft',
      'https://directwonen.nl/huurwoningen-huren/rotterdam',
      'https://directwonen.nl/huurwoningen-huren/den-haag',
    ]);
  });

  test('search maps the recorded Delft page, including the Smart-only card', async () => {
    const ctx = fixtureContext({ sourceId: 'directwonen', config, now: NOW, routes: { '/huurwoningen-huren/delft': 'directwonen/delft.html' } });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const listings = await adapter.search(req!, ctx);
    expect(listings).toHaveLength(7);
    expect(listings[0]).toMatchObject({
      sourceId: 'directwonen',
      externalId: '519407',
      url: 'https://directwonen.nl/huurwoningen-huren/delft/martinus-nijhofflaan/appartement-519407',
      title: 'Martinus Nijhofflaan, Delft',
      priceEur: 1173,
      priceBasis: 'excl',
      rooms: 2,
      sizeM2: 64,
      type: 'apartment',
      availableFrom: '2026-09-24',
      address: { street: 'Martinus Nijhofflaan', city: 'Delft' },
      contact: 'none',
      extra: { smartOnly: true },
    });
    expect(listings[0]?.publishedAt?.slice(0, 10)).toBe('2026-08-15');
    expect(listings[0]?.images?.[0]).toMatch(/^https:\/\/resources\.directwonen\.nl\/image\//);
    expect(listings[1]).toMatchObject({ externalId: '520780', type: 'room', priceEur: 950, address: { street: 'Oude Delft', city: 'Delft' } });
    expect(listings[1]?.extra).toBeUndefined();
    expect(listings[6]).toMatchObject({ externalId: '516568', type: 'house', rooms: 5, sizeM2: 144, address: { street: 'Taj Mahalplaats' } });
  });

  test('a card marked as rented is skipped', () => {
    const html = readFixture('directwonen/delft.html').replace('Smart only', 'Verhuurd');
    const listings = parseDirectwonenList(html, 'https://directwonen.nl/huurwoningen-huren/delft', NOW);
    expect(listings).toHaveLength(6);
    expect(listings[0]?.externalId).toBe('520780');
  });
});

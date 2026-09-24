import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createVanderlindenAdapter } from '../../src/adapters/vanderlinden.js';
import { createRegistry } from '../../src/index.js';
import { fixtureContext, readFixture } from '../../src/testing.js';
import { htmlAdapters } from '../../src/builtin/html.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const randstad = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});
const amsterdam = ConfigSchema.parse({
  searches: [{ id: 'a', name: 'A', priceMaxEur: 1400, regions: [{ name: 'Amsterdam', municipalities: ['Amsterdam', 'Diemen'] }] }],
});

describe('vanderlinden', () => {
  const adapter = createVanderlindenAdapter();

  test('is one of the built-in HTML sources', () => {
    expect(htmlAdapters().map((a) => a.id)).toContain('vanderlinden');
  });

  test('is a regional agent whose reaction form creates an account, so reacting is left to a person', () => {
    expect(adapter.id).toBe('vanderlinden');
    expect(adapter.capabilities).toEqual({ search: 'html', detail: false, contact: 'none', login: 'optional', terms: 'unknown' });
  });

  test('is polled only for searches in its area around Amsterdam, Almere and Utrecht', () => {
    const registry = createRegistry([adapter]);
    expect(registry.enabled(randstad)).toHaveLength(0);
    expect(registry.enabled(amsterdam)).toHaveLength(1);
  });

  test('buildSearches reads the one list page; it has no filters to put the price or place in', () => {
    expect(adapter.buildSearches(amsterdam.searches, SourceConfigSchema.parse({}))).toEqual([
      { key: 'woning-huren', label: 'Van der Linden', url: 'https://www.vanderlinden.nl/woning-huren/' },
    ]);
  });

  test('search maps the recorded list and skips homes under option and interest lists', async () => {
    const ctx = fixtureContext({ sourceId: 'vanderlinden', config: amsterdam, now: NOW, routes: { '/woning-huren/': 'vanderlinden/woning-huren.html' } });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source);
    const listings = await adapter.search(req!, ctx);
    // 14 cards: two "Onder optie" and one "Belangstellendenlijst" (a project, not a home).
    expect(listings).toHaveLength(11);
    expect(listings.map((l) => l.externalId)).not.toContain('2567');
    expect(listings.map((l) => l.externalId)).not.toContain('522');
    expect(listings[0]).toMatchObject({
      sourceId: 'vanderlinden',
      externalId: '2561',
      url: 'https://www.vanderlinden.nl/huurwoning/Wijnsilostraat-12-Amsterdam/2561/',
      title: 'Wijnsilostraat 12, Amsterdam',
      priceEur: 1910,
      sizeM2: 85,
      bedrooms: 3,
      energyLabel: 'A',
      address: { street: 'Wijnsilostraat', houseNumber: '12', city: 'Amsterdam' },
      agent: { name: 'Van der Linden', url: 'https://www.vanderlinden.nl' },
      contact: 'none',
      extra: { label: 'Binnenkort beschikbaar' },
    });
    expect(listings[0]?.availableFrom).toBeUndefined();
    expect(listings[0]?.images?.[0]).toMatch(/^https:\/\/www\.vanderlinden\.nl\/media_huur\/thumbs\/414x276\/\d+\.jpg$/);
    const byId = new Map(listings.map((l) => [l.externalId, l]));
    expect(byId.get('2571')).toMatchObject({ address: { city: 'Nunspeet' }, extra: { label: 'Seniorenwoning', note: 'Seniorenhuisvesting' } });
    expect(byId.get('2617')).toMatchObject({ energyLabel: 'A++', availableFrom: '2026-09-24', priceEur: 1173, bedrooms: 1 });
  });

  test('isAvailable reads the status next to the address on the listing page', async () => {
    const listing = { url: 'https://www.vanderlinden.nl/huurwoning/Krijn-Taconiskade-539-Amsterdam/2617/' } as never;
    const live = fixtureContext({ sourceId: 'vanderlinden', routes: { '/2617/': 'vanderlinden/detail-krijn-taconiskade-539.html' } });
    expect(await adapter.isAvailable!(listing, live)).toBe(true);
    const html = readFixture('vanderlinden/detail-krijn-taconiskade-539.html').replace(
      '<span class="status me-1 ms-3">Beschikbaar</span>',
      '<span class="status me-1 ms-3">Verhuurd</span>',
    );
    const rented = fixtureContext({ sourceId: 'vanderlinden', routes: [{ match: '/2617/', body: html, headers: { 'content-type': 'text/html' } }] });
    expect(await adapter.isAvailable!(listing, rented)).toBe(false);
    const gone = fixtureContext({ sourceId: 'vanderlinden', routes: [{ match: '/2617/', status: 404, body: 'weg' }] });
    expect(await adapter.isAvailable!(listing, gone)).toBe(false);
  });
});

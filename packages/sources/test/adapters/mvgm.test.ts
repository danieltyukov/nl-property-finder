import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createMvgmAdapter, parseMvgmList } from '../../src/adapters/mvgm.js';
import { fixtureContext, readFixture } from '../../src/testing.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('mvgm', () => {
  const adapter = createMvgmAdapter();

  test('describes a nationwide portal that needs an account to react', () => {
    expect(adapter.id).toBe('mvgm');
    expect(adapter.regions).toBe('nl');
    expect(adapter.capabilities).toMatchObject({ search: 'html', contact: 'none', login: 'required', terms: 'unknown' });
    expect(adapter.capabilities.paid).toBeUndefined();
  });

  test('buildSearches asks for each city newest first; the price filter is session-only, so it is not in the URL', () => {
    const reqs = adapter.buildSearches(config.searches, SourceConfigSchema.parse({}));
    expect(reqs.map((r) => r.url)).toEqual([
      'https://ikwilhuren.nu/aanbod/delft/?sort=aanbodDESC',
      'https://ikwilhuren.nu/aanbod/rotterdam/?sort=aanbodDESC',
      'https://ikwilhuren.nu/aanbod/den-haag/?sort=aanbodDESC',
    ]);
    expect(new Set(reqs.map((r) => r.key)).size).toBe(3);
  });

  test('buildSearches falls back to the national list for a search without municipalities', () => {
    const nl = ConfigSchema.parse({});
    const reqs = adapter.buildSearches(nl.searches, SourceConfigSchema.parse({ searchUrls: ['https://ikwilhuren.nu/aanbod/utrecht/'] }));
    expect(reqs.map((r) => r.url)).toEqual(['https://ikwilhuren.nu/aanbod/?sort=aanbodDESC', 'https://ikwilhuren.nu/aanbod/utrecht/']);
  });

  test('search maps the recorded Rotterdam page', async () => {
    const ctx = fixtureContext({ sourceId: 'mvgm', config, now: NOW, routes: { '/aanbod/rotterdam/': 'mvgm/aanbod-rotterdam.html' } });
    const [req] = adapter.buildSearches(ctx.searches, ctx.source).filter((r) => r.key === 'rotterdam');
    const listings = await adapter.search(req!, ctx);
    expect(listings).toHaveLength(10);
    expect(listings[0]).toMatchObject({
      sourceId: 'mvgm',
      externalId: '70aa51a4d6bc837f556425813c248358',
      url: 'https://ikwilhuren.nu/object/rotterdam-3012ah-14-c-van-oldenbarneveltplaats-70aa51a4d6bc837f556425813c248358/',
      title: 'Van Oldenbarneveltplaats 14 C',
      priceEur: 2215,
      priceBasis: 'excl',
      sizeM2: 120,
      bedrooms: 3,
      type: 'apartment',
      address: { street: 'Van Oldenbarneveltplaats', houseNumber: '14', addition: 'C', postcode: '3012 AH', city: 'Rotterdam' },
      availableFrom: '2026-09-24',
      contact: 'none',
      agent: { name: 'MVGM', url: 'https://ikwilhuren.nu' },
    });
    expect(listings[0]?.images?.[0]).toMatch(/^https:\/\/c\.static\.nbo\.nl\/media\//);
    const schiedam = listings[4];
    expect(schiedam?.address).toEqual({ street: "'s-gravelandseweg", houseNumber: '811', postcode: '3119 XT', city: 'Schiedam' });
    expect(listings[7]).toMatchObject({ type: 'house', sizeM2: 111, address: { houseNumber: '114', city: 'Rotterdam' } });
    // A card with an extra badge (upholstery costs) still reads as available.
    expect(listings[8]).toMatchObject({ priceEur: 1290, address: { houseNumber: '671' } });
  });

  test('a card whose status badge says rented or under option is skipped', () => {
    const html = readFixture('mvgm/aanbod-rotterdam.html');
    const first = html.indexOf('Te huur');
    const second = html.indexOf('Te huur', first + 1);
    const edited = html.slice(0, first) + 'Verhuurd' + html.slice(first + 7, second) + 'Onder optie' + html.slice(second + 7);
    const listings = parseMvgmList(edited, NOW);
    expect(listings).toHaveLength(8);
    expect(listings[0]?.externalId).toBe('e84c5af805e32d7771399fad0e136b22');
  });

  test('detail adds the description, service costs, deposit and energy label', async () => {
    const ctx = fixtureContext({ sourceId: 'mvgm', now: NOW, routes: { '/object/rotterdam-3071az-64': 'mvgm/object-louis-pregerkade-64.html' } });
    const [, , , , , card] = await adapter.search(
      { key: 'rotterdam', label: 'x', url: 'https://ikwilhuren.nu/aanbod/rotterdam/?sort=aanbodDESC' },
      fixtureContext({ sourceId: 'mvgm', now: NOW, routes: { '/aanbod/rotterdam/': 'mvgm/aanbod-rotterdam.html' } }),
    );
    const full = await adapter.detail!(card!, ctx);
    expect(full).toMatchObject({
      serviceCostsEur: 60,
      depositEur: 1471,
      energyLabel: 'B',
      availableFrom: '2026-09-24',
      address: { street: 'Louis Pregerkade', houseNumber: '64', postcode: '3071 AZ', city: 'Rotterdam' },
    });
    expect(full.description).toMatch(/^3-kamerappartement met een woonoppervlakte van 90m2/);
    expect(full.description).toContain('Servicekosten: €60,00 per maand.');
  });

  test('isAvailable is false once the object page is gone', async () => {
    const listing = { url: 'https://ikwilhuren.nu/object/rotterdam-3071az-64-louis-pregerkade-72b2200fdeb28d05ca3a8d0e6471975d/' };
    const gone = fixtureContext({ sourceId: 'mvgm', routes: [{ match: '/object/', status: 404, body: 'not found' }] });
    expect(await adapter.isAvailable!(listing as never, gone)).toBe(false);
    const live = fixtureContext({ sourceId: 'mvgm', routes: { '/object/': 'mvgm/object-louis-pregerkade-64.html' } });
    expect(await adapter.isAvailable!(listing as never, live)).toBe(true);
  });
});

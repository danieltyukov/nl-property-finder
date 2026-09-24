import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createWonen123Adapter } from '../../src/adapters/wonen123.js';
import { createRegistry } from '../../src/index.js';
import { fixtureContext } from '../../src/testing.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('wonen123', () => {
  const adapter = createWonen123Adapter();

  test('is a regional agent reached by email, without login or fee', () => {
    expect(adapter.id).toBe('wonen123');
    expect(adapter.capabilities).toEqual({ search: 'html', detail: true, contact: 'email', login: 'none', terms: 'unknown' });
    expect(adapter.regions).toEqual(expect.arrayContaining(['delft', 'rotterdam', 'den haag', 'utrecht', 'amsterdam']));
  });

  test('the registry enables it only when a search names one of its municipalities', () => {
    const registry = createRegistry([adapter]);
    expect(registry.enabled(config)).toHaveLength(1);
    const elsewhere = ConfigSchema.parse({ searches: [{ id: 'a', name: 'A', regions: [{ name: 'x', municipalities: ['Vaals'] }] }] });
    expect(registry.enabled(elsewhere)).toHaveLength(0);
  });

  test('buildSearches asks for each covered city newest first; a price in the URL is ignored by the site, so none is sent', () => {
    expect(adapter.buildSearches(config.searches, SourceConfigSchema.parse({})).map((r) => r.url)).toEqual([
      'https://www.123wonen.nl/huurwoningen/in/delft/sort/newest',
      'https://www.123wonen.nl/huurwoningen/in/rotterdam/sort/newest',
      'https://www.123wonen.nl/huurwoningen/in/den-haag/sort/newest',
    ]);
  });

  test('search maps the recorded Rotterdam page and skips the rented cards', async () => {
    const ctx = fixtureContext({ sourceId: 'wonen123', config, now: NOW, routes: { '/huurwoningen/in/rotterdam': 'wonen123/rotterdam.html' } });
    const req = adapter.buildSearches(ctx.searches, ctx.source).find((r) => r.key === 'rotterdam');
    const listings = await adapter.search(req!, ctx);
    // 12 cards, 9 of them marked "Verhuurd".
    expect(listings).toHaveLength(3);
    expect(listings[0]).toMatchObject({
      sourceId: 'wonen123',
      externalId: '2348-26',
      url: 'https://www.123wonen.nl/huur/rotterdam/appartement/lotustuin-2348-26',
      title: 'Lotustuin, Rotterdam',
      priceEur: 3050,
      sizeM2: 123,
      bedrooms: 2,
      type: 'apartment',
      address: { street: 'Lotustuin', city: 'Rotterdam' },
      availableFrom: '2026-09-24',
      publishedAt: '2026-09-20T22:00:00.000Z',
      agent: { name: '123Wonen', url: 'https://www.123wonen.nl' },
      contact: 'email',
    });
    expect(listings[0]?.images?.[0]).toBe('https://www.static.123wonen.nl/files/object_data/cache/s320240/2026/9/747904.jpg');
    expect(listings[1]).toMatchObject({ externalId: '2347-26', energyLabel: 'A++', priceEur: 2300 });
    expect(listings[2]).toMatchObject({ externalId: '2344-26', availableFrom: '2026-10-01', bedrooms: 1 });
  });

  test('detail adds the branch that answers email, the room count and the description', async () => {
    const list = fixtureContext({ sourceId: 'wonen123', now: NOW, routes: { '/huurwoningen/in/rotterdam': 'wonen123/rotterdam.html' } });
    const [card] = await adapter.search({ key: 'r', label: 'r', url: 'https://www.123wonen.nl/huurwoningen/in/rotterdam/sort/newest' }, list);
    const ctx = fixtureContext({ sourceId: 'wonen123', now: NOW, routes: { '/lotustuin-2348-26': 'wonen123/detail-lotustuin.html' } });
    const full = await adapter.detail!(card!, ctx);
    expect(full.agent).toEqual({ name: '123Wonen Rotterdam', url: 'https://www.123wonen.nl', email: 'rotterdam@123wonen.nl', phone: '010 - 314 0585' });
    expect(full.rooms).toBe(3);
    expect(full.description).toMatch(/^Ruim en licht appartement met 2 slaapkamers/);
    expect(full.furnishing).toBe('furnished');
  });

  test('isAvailable is false for a page marked rented or gone', async () => {
    const listing = { url: 'https://www.123wonen.nl/huur/rotterdam/appartement/lotustuin-2348-26' } as never;
    const live = fixtureContext({ sourceId: 'wonen123', routes: { '/lotustuin-2348-26': 'wonen123/detail-lotustuin.html' } });
    expect(await adapter.isAvailable!(listing, live)).toBe(true);
    const gone = fixtureContext({ sourceId: 'wonen123', routes: [{ match: '/lotustuin-2348-26', status: 404, body: 'weg' }] });
    expect(await adapter.isAvailable!(listing, gone)).toBe(false);
  });
});

import { describe, expect, test } from 'vitest';
import { ConfigSchema, SourceConfigSchema } from '@nlpf/core';
import { createHuurzoneAdapter } from '../../src/adapters/huurzone.js';
import { fixtureContext } from '../../src/testing.js';
import { htmlAdapters } from '../../src/builtin/html.js';

const NOW = new Date('2026-09-24T10:30:00Z');
const config = ConfigSchema.parse({
  searches: [
    { id: 'main', name: 'Main', priceMaxEur: 1400, regions: [{ name: 'Randstad', municipalities: ['Delft', 'Rotterdam', 'Den Haag'] }] },
  ],
});

describe('huurzone', () => {
  const adapter = createHuurzoneAdapter();

  test('is one of the built-in HTML sources', () => {
    expect(htmlAdapters().map((a) => a.id)).toContain('huurzone');
  });

  test('is a paid aggregator that is only ingested', () => {
    expect(adapter.id).toBe('huurzone');
    expect(adapter.regions).toBe('nl');
    expect(adapter.capabilities).toMatchObject({
      search: 'html',
      detail: true,
      contact: 'none',
      login: 'required',
      paid: { feature: 'contact', plan: 'huurzone-premium' },
      terms: 'unknown',
    });
  });

  test('buildSearches sorts newest first and passes the rent ceiling as one of the site\'s steps', () => {
    expect(adapter.buildSearches(config.searches, SourceConfigSchema.parse({})).map((r) => r.url)).toEqual([
      'https://www.huurzone.nl/huurwoningen/delft?sort_by=created_at.desc&price_to=1400',
      'https://www.huurzone.nl/huurwoningen/rotterdam?sort_by=created_at.desc&price_to=1400',
      'https://www.huurzone.nl/huurwoningen/den-haag?sort_by=created_at.desc&price_to=1400',
    ]);
    const odd = ConfigSchema.parse({ searches: [{ id: 'a', name: 'A', priceMaxEur: 1450, regions: [] }] });
    expect(adapter.buildSearches(odd.searches, SourceConfigSchema.parse({})).map((r) => r.url)).toEqual([
      'https://www.huurzone.nl/huurwoningen/heel-nederland?sort_by=created_at.desc&price_to=1500',
    ]);
    const high = ConfigSchema.parse({ searches: [{ id: 'a', name: 'A', priceMaxEur: 2500, regions: [{ name: 'x', municipalities: ['Delft'] }] }] });
    expect(adapter.buildSearches(high.searches, SourceConfigSchema.parse({}))[0]?.url).toBe(
      'https://www.huurzone.nl/huurwoningen/delft?sort_by=created_at.desc',
    );
  });

  test('search maps the recorded Rotterdam page', async () => {
    const ctx = fixtureContext({ sourceId: 'huurzone', config, now: NOW, routes: { '/huurwoningen/rotterdam': 'huurzone/rotterdam.html' } });
    const req = adapter.buildSearches(ctx.searches, ctx.source).find((r) => r.key === 'rotterdam');
    const listings = await adapter.search(req!, ctx);
    expect(listings).toHaveLength(12);
    expect(listings[0]).toMatchObject({
      sourceId: 'huurzone',
      externalId: '1248688',
      url: 'https://www.huurzone.nl/huurwoningen/zuid-holland/rotterdam/1248688',
      title: 'Kamer in Rotterdam',
      priceEur: 550,
      sizeM2: 15,
      rooms: 1,
      type: 'room',
      address: { city: 'Rotterdam' },
      contact: 'none',
    });
    expect(listings.every((l) => (l.priceEur ?? 0) <= 1400)).toBe(true);
    expect(listings.find((l) => l.externalId === '1231315')).toMatchObject({ type: 'apartment', rooms: 3, sizeM2: 81, priceEur: 1399 });
  });

  test('detail adds the postcode, deposit, furnishing and listing date from the detail page', async () => {
    const list = fixtureContext({ sourceId: 'huurzone', now: NOW, routes: { '/huurwoningen/rotterdam': 'huurzone/rotterdam.html' } });
    const card = (await adapter.search({ key: 'r', label: 'r', url: 'https://www.huurzone.nl/huurwoningen/rotterdam' }, list)).find(
      (l) => l.externalId === '1231315',
    );
    const ctx = fixtureContext({ sourceId: 'huurzone', now: NOW, routes: { '/rotterdam/1231315': 'huurzone/detail-1231315.html' } });
    const full = await adapter.detail!(card!, ctx);
    expect(full).toMatchObject({
      address: { postcode: '3039 HL', city: 'Rotterdam' },
      depositEur: 2797,
      furnishing: 'furnished',
      bedrooms: 2,
      publishedAt: '2026-09-21T16:50:24.000Z',
      description: 'De oppervlakte van deze woning is 81 m².',
    });
    // The street is for Premium members only and stays empty.
    expect(full.address.street).toBeUndefined();
  });
});

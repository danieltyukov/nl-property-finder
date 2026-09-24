import { describe, expect, test } from 'vitest';
import { ConfigSchema, type Listing, type RawListing } from '@nlpf/core';
import { ssh, sshOfferPath } from '../../src/adapters/ssh.js';
import { fixtureContext, type FixtureContextOptions } from '../../src/testing.js';

// fixtures/ssh/offer.json is the live offer list of 2026-09-24; details.json is the matching
// getOffersDetails answer, trimmed to address, floor area and rent.

const NOW = new Date('2026-09-24T10:00:00Z');

function ctxFor(config: Record<string, unknown>, routes: FixtureContextOptions['routes']) {
  return fixtureContext({ sourceId: 'ssh', config, routes, now: NOW });
}

const ROUTES = { '/api/v1/offer/getOffersDetails': 'ssh/details.json', '/api/v1/offer': 'ssh/offer.json' };

async function searchWith(regions: { name: string; municipalities: string[] }[]): Promise<RawListing[]> {
  const config = { searches: [{ id: 'main', name: 'Main', regions, priceMaxEur: 1400 }] };
  const ctx = ctxFor(config, ROUTES);
  const [req] = ssh.buildSearches(ctx.searches, ctx.source);
  return ssh.search(req!, ctx);
}

describe('ssh adapter', () => {
  test('declares a JSON source where reacting happens on the portal', () => {
    expect(ssh.id).toBe('ssh');
    expect(ssh.regions).toBe('nl');
    expect(ssh.defaultIntervalSec).toBe(60);
    expect(ssh.capabilities).toEqual({ search: 'json', detail: false, contact: 'lottery', login: 'required', terms: 'unknown' });
    expect(ssh.contact).toBeUndefined();
    expect(ssh.loginUrl).toBe('https://www.sshxl.nl/nl/inloggen');
  });

  test('buildSearches makes one request, because the offer API has no filters; the municipalities go along', () => {
    const config = ConfigSchema.parse({
      searches: [
        { id: 'a', name: 'A', regions: [{ name: 'Delft', municipalities: ['delft'] }, { name: 'Rotterdam', municipalities: ['rotterdam'] }] },
        { id: 'b', name: 'B', regions: [{ name: 'Den Haag', municipalities: ['den haag'] }], priceMaxEur: 1400 },
      ],
    });
    expect(ssh.buildSearches(config.searches, { enabled: true, searchUrls: [], options: {} })).toEqual([
      { key: 'offers?delft,den haag,rotterdam', label: 'SSH offers', url: 'https://www.sshxl.nl/api/v1/offer', params: { municipalities: 'delft,den haag,rotterdam' } },
    ]);
  });

  test('search joins offers with their addresses and keeps the municipalities asked for', async () => {
    const listings = await searchWith([
      { name: 'Delft', municipalities: ['delft'] },
      { name: 'Rotterdam', municipalities: ['rotterdam'] },
      { name: 'Den Haag', municipalities: ['den haag'] },
    ]);
    expect(listings).toHaveLength(1);
    expect(listings[0]?.address.city).toBe('Rotterdam');
    expect(listings[0]?.contact).toBe('lottery');
  });

  test('search maps an offer with price basis, service costs, deadline and applicant count', async () => {
    const listings = await searchWith([{ name: 'Utrecht', municipalities: ['utrecht'] }]);
    expect(listings).toHaveLength(29);
    const biltstraat = listings.find((l) => l.extra?.wocasId === '25601003');
    expect(biltstraat).toEqual({
      sourceId: 'ssh',
      externalId: '1478087',
      url: 'https://www.sshxl.nl/nl/aanbod/1478087-biltstraat-91',
      title: 'Biltstraat 91',
      priceEur: 940.66,
      priceBasis: 'incl',
      serviceCostsEur: 7.73,
      sizeM2: 46,
      type: 'apartment',
      address: { street: 'Biltstraat', houseNumber: '91', postcode: '3572 AK', city: 'Utrecht' },
      availableFrom: expect.stringMatching(/^2026-\d{2}-\d{2}$/),
      images: expect.any(Array),
      agent: { name: 'SSH', url: 'https://www.sshxl.nl' },
      contact: 'lottery',
      contactUrl: 'https://www.sshxl.nl/nl/aanbod/1478087-biltstraat-91',
      publishedAt: '2026-09-22T00:00:01.000Z',
      language: 'nl',
      extra: {
        reactions: 0,
        kind: 'Bezichtiging',
        contractType: 'Jongerencontract',
        deadline: '2026-09-24T21:59:59.000Z',
        viewingAt: expect.any(String),
        wocasId: '25601003',
      },
    });
    const room = listings.find((l) => l.extra?.wocasId === '29602059');
    expect(room).toMatchObject({ type: 'room', url: 'https://www.sshxl.nl/nl/aanbod/1478241-enny-vredelaan-339-k8', extra: { kind: 'Hospiteren', room: 'k8' } });
    const studio = listings.find((l) => l.extra?.wocasId === '36400341');
    expect(studio).toMatchObject({ type: 'studio', sizeM2: 23 });
  });

  test('without municipalities every open offer in the country comes back', async () => {
    const listings = await searchWith([]);
    expect(listings).toHaveLength(36);
    expect(new Set(listings.map((l) => l.address.city))).toEqual(new Set(['Utrecht', 'Zwolle', 'Rotterdam', 'Tilburg']));
  });

  test('offers past their deadline are skipped', async () => {
    const config = { searches: [{ id: 'main', name: 'Main', regions: [] }] };
    const ctx = fixtureContext({ sourceId: 'ssh', config, routes: ROUTES, now: new Date('2026-09-25T12:00:00Z') });
    const [req] = ssh.buildSearches(ctx.searches, ctx.source);
    const listings = await ssh.search(req!, ctx);
    expect(listings.length).toBeLessThan(36);
    for (const l of listings) expect(Date.parse(String(l.extra?.deadline))).toBeGreaterThan(Date.parse('2026-09-25T12:00:00Z'));
  });

  test('isAvailable checks that the offer is still listed', async () => {
    const [first] = await searchWith([{ name: 'Utrecht', municipalities: ['utrecht'] }]);
    const listing: Listing = { ...first!, id: `ssh:${first!.externalId}`, propertyId: null, firstSeenAt: '', lastSeenAt: '', state: 'active', via: 'poll' };
    expect(await ssh.isAvailable!(listing, ctxFor({}, { '/api/v1/offer': 'ssh/offer.json' }))).toBe(true);
    expect(await ssh.isAvailable!({ ...listing, externalId: '1' }, ctxFor({}, { '/api/v1/offer': 'ssh/offer.json' }))).toBe(false);
  });

  test('offer paths follow the portal', () => {
    expect(sshOfferPath(1478276, { Straatnaam: 'Ina Boudier-Bakkerlaan', Nummer: '133', Locatie: 'k1425' })).toBe('/nl/aanbod/1478276-ina-boudier-bakkerlaan-133-k1425');
    expect(sshOfferPath(1, { Straatnaam: 'Oude Gracht', Nummer: '12', Letter: 'A', Toevoeging: 'bis' })).toBe('/nl/aanbod/1-oude-gracht-12a-bis');
  });
});

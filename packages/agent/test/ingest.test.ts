import { expect, test } from 'vitest';
import { openStore, type RawListing } from '@nlpf/core';
import { assignProperty } from '../src/cluster.js';
import { createGeocoder } from '../src/geocode.js';
import { normaliseListing } from '../src/normalise.js';
import { fixtureFetch } from './helpers.js';

const NOW = '2026-09-23T10:00:00.000Z';

const raw = (sourceId: string, address: RawListing['address'], priceEur: number): RawListing => ({
  sourceId,
  externalId: `${sourceId}-1`,
  url: `https://${sourceId}.example.test/1`,
  title: 'Appartement Oude Delft',
  priceEur,
  sizeM2: 40,
  address,
  contact: 'form',
});

// Review Focus 1, the way the daemon's ingest runs it: normalise, geocode, assign.
test('one home on three sites with differently written addresses becomes one property', async () => {
  const store = openStore(':memory:');
  const geo = createGeocoder(store, fixtureFetch());
  const listings = [
    raw('funda', { street: 'Oude Delft', houseNumber: '12-A', city: 'Delft' }, 1250),
    raw('pararius', { street: 'Oude Delft', houseNumber: '12A', city: 'DELFT' }, 1250),
    // The third site even has the postcode wrong; PDOK's best text hit for it is number 41A.
    raw('kamernet', { street: 'Oude Delft', houseNumber: '12 a', postcode: '2611 BC', city: 'Delft' }, 1275),
  ];
  const ids = new Set<string>();
  for (const r of listings) {
    const n = normaliseListing(r);
    const { listing } = store.listings.upsert({ ...n, address: await geo.geocode(n.address) }, 'poll', NOW);
    ids.add(assignProperty(store, listing, NOW).property.id);
  }
  expect(ids.size).toBe(1);
  const [property] = store.properties.list();
  expect(property).toMatchObject({
    key: 'pc:2611CC:12:a',
    address: {
      street: 'Oude Delft',
      houseNumber: '12',
      addition: 'A',
      postcode: '2611 CC',
      municipality: 'Delft',
    },
  });
  expect(store.listings.list({ propertyId: property!.id })).toHaveLength(3);
});

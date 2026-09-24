import { expect, test } from 'vitest';
import { openStore } from '@nlpf/core';
import { createGeocoder, pdokQueryUrl } from '../src/geocode.js';
import { fixtureFetch } from './helpers.js';

const pdok = (q: string) =>
  `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(q)}&fq=type:adres&rows=1`;

test('builds the Locatieserver URL from the address', () => {
  expect(pdokQueryUrl({ street: 'Oude Delft', houseNumber: '12-a', city: 'Delft' })).toBe(
    pdok('Oude Delft 12A Delft'),
  );
  expect(pdokQueryUrl({ street: 'Oude Delft', houseNumber: '12', postcode: '2611 bc', city: 'Delft' })).toBe(
    pdok('Oude Delft 12 2611BC Delft'),
  );
  expect(pdokQueryUrl({ city: 'Delft' })).toBeUndefined();
});

test('fills postcode, municipality, neighbourhood and coordinates from PDOK', async () => {
  const fetchJson = fixtureFetch();
  const geo = createGeocoder(openStore(':memory:'), fetchJson);
  const out = await geo.geocode({ street: 'Oude Delft', houseNumber: '12-A', city: 'Delft' });
  expect(out).toMatchObject({
    street: 'Oude Delft',
    houseNumber: '12',
    addition: 'A',
    postcode: '2611 CC',
    city: 'Delft',
    municipality: 'Delft',
    neighbourhood: 'Centrum',
  });
  expect(out.lat).toBeCloseTo(52.00812309, 6);
  expect(out.lon).toBeCloseTo(4.35890715, 6);
  expect(fetchJson.calls.map((c) => c.url)).toEqual([pdok('Oude Delft 12A Delft')]);
});

test('answers from the store cache the second time', async () => {
  const store = openStore(':memory:');
  const fetchJson = fixtureFetch();
  const geo = createGeocoder(store, fetchJson);
  await geo.geocode({ street: 'Oude Delft', houseNumber: '12A', city: 'Delft' });
  const again = await createGeocoder(store, fetchJson).geocode({
    street: 'Oude Delft',
    houseNumber: '12',
    addition: 'a',
    city: 'Delft',
  });
  expect(again.postcode).toBe('2611 CC');
  expect(fetchJson.calls).toHaveLength(1);
});

test('a wrong postcode is retried without it and corrected', async () => {
  const fetchJson = fixtureFetch();
  const out = await createGeocoder(openStore(':memory:'), fetchJson).geocode({
    street: 'Oude Delft',
    houseNumber: '12',
    postcode: '2611 BC',
    city: 'Delft',
  });
  // PDOK's best hit for "Oude Delft 12 2611BC" is number 41A, which must not be taken.
  expect(out).toMatchObject({ houseNumber: '12', postcode: '2611 CC', neighbourhood: 'Centrum' });
  expect(fetchJson.calls.map((c) => c.url)).toEqual([
    pdok('Oude Delft 12 2611BC Delft'),
    pdok('Oude Delft 12 Delft'),
  ]);
});

test('a hit on another street is rejected and the miss is cached', async () => {
  const store = openStore(':memory:');
  const fetchJson = fixtureFetch();
  const addr = { street: 'Nergensstraat', houseNumber: '999', city: 'Delft' };
  const out = await createGeocoder(store, fetchJson).geocode(addr);
  expect(out).toEqual(addr);
  await createGeocoder(store, fetchJson).geocode(addr);
  expect(fetchJson.calls).toHaveLength(1);
});

test('a network error leaves the address alone and is not cached', async () => {
  const store = openStore(':memory:');
  const url = pdok('Oude Delft 12A Delft');
  const failing = fixtureFetch({ [url]: new Error('ETIMEDOUT') });
  const addr = { street: 'Oude Delft', houseNumber: '12A', city: 'Delft' };
  expect(await createGeocoder(store, failing).geocode(addr)).toEqual(addr);
  const working = fixtureFetch();
  expect((await createGeocoder(store, working).geocode(addr)).postcode).toBe('2611 CC');
  expect(working.calls).toHaveLength(1);
});

test('an address without a house number is not looked up', async () => {
  const fetchJson = fixtureFetch();
  expect(await createGeocoder(openStore(':memory:'), fetchJson).geocode({ city: 'Delft' })).toEqual({
    city: 'Delft',
  });
  expect(fetchJson.calls).toHaveLength(0);
});

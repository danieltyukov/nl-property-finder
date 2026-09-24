import { expect, test } from 'vitest';
import { openStore } from '@nlpf/core';
import { lookupPropertyFacts } from '../src/facts.js';
import { fixtureFetch } from './helpers.js';

const addr = { street: 'Oude Delft', houseNumber: '12A', city: 'Delft' };
const now = new Date('2026-09-24T10:00:00Z');
const EP = 'https://public.ep-online.nl/api/v5/PandEnergielabel/AdresseerbaarObject/0503010000003325';

test('reads floor area and build year from BAG and the WOZ value from the WOZ-waardeloket', async () => {
  const fetchJson = fixtureFetch();
  const facts = await lookupPropertyFacts(addr, { fetchJson, store: openStore(':memory:'), now });
  expect(facts).toEqual({ sizeM2: 294, buildYear: 1884, wozEur: 1_256_000, wozPeildatum: '2025-01-01', residential: true, sources: ['bag', 'woz'] });
  expect(fetchJson.calls.map((c) => c.url)).toEqual([
    'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=Oude%20Delft%2012A%20Delft&fq=type:adres&rows=1',
    'https://api.pdok.nl/kadaster/bag/ogc/v2/collections/verblijfsobject/items?identificatie=0503010000003325&f=json',
    'https://api.pdok.nl/kadaster/bag/ogc/v2/collections/pand/items/dac5ca1c-de71-5177-b52c-05abcadb4bbd?f=json',
    'https://api.kadaster.nl/lvwoz/wozwaardeloket-api/v1/wozwaarde/nummeraanduiding/0503200000040028',
  ]);
});

test('with an EP-Online key, the newest valid label is used and simplified labels are skipped', async () => {
  const fetchJson = fixtureFetch();
  const facts = await lookupPropertyFacts(addr, { fetchJson, store: openStore(':memory:'), epOnlineKey: 'test-key', now });
  expect(facts).toMatchObject({ energyLabel: 'C', labelChecked: true, sources: ['bag', 'woz', 'ep-online'] });
  expect(fetchJson.calls.find((c) => c.url === EP)?.headers).toEqual({ Authorization: 'test-key' });
});

test('an address EP-Online does not know gets the build-year rule', async () => {
  const fetchJson = fixtureFetch({ [EP]: new Error('HTTP 404 Not Found') });
  const facts = await lookupPropertyFacts(addr, { fetchJson, store: openStore(':memory:'), epOnlineKey: 'k', now });
  expect(facts.energyLabel).toBeUndefined();
  expect(facts.labelChecked).toBe(true);
});

test('results are cached per address', async () => {
  const store = openStore(':memory:');
  await lookupPropertyFacts(addr, { fetchJson: fixtureFetch(), store, now });
  const again = fixtureFetch();
  const facts = await lookupPropertyFacts({ ...addr, houseNumber: '12', addition: 'a' }, { fetchJson: again, store, now });
  expect(facts.wozEur).toBe(1_256_000);
  expect(again.calls).toHaveLength(0);
});

test('a failing service gives partial facts that are not cached', async () => {
  const store = openStore(':memory:');
  const unauthorized = Object.assign(new Error('HTTP 401 Unauthorized'), { status: 401 });
  const facts = await lookupPropertyFacts(addr, { fetchJson: fixtureFetch({ [EP]: unauthorized }), store, epOnlineKey: 'wrong', now });
  expect(facts.sources).toEqual(['bag', 'woz']);
  expect(facts.labelChecked).toBeUndefined();
  const retry = fixtureFetch();
  await lookupPropertyFacts(addr, { fetchJson: retry, store, epOnlineKey: 'right', now });
  expect(retry.calls.some((c) => c.url === EP)).toBe(true);
});

test('an unknown address has no facts', async () => {
  const facts = await lookupPropertyFacts({ street: 'Nergensstraat', houseNumber: '999', city: 'Delft' }, { fetchJson: fixtureFetch(), store: openStore(':memory:'), now });
  expect(facts).toEqual({ sources: [] });
});

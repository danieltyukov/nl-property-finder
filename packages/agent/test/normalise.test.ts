import { expect, test } from 'vitest';
import type { RawListing } from '@nlpf/core';
import { detectFurnishing, detectType, normaliseListing, titleCaseCity } from '../src/normalise.js';

const raw = (over: Partial<RawListing> = {}): RawListing => ({
  sourceId: 'funda', externalId: '1', url: ' https://example.test/1 ', title: '  Oude Delft   12-A ',
  address: { street: ' Oude Delft ', houseNumber: '12-a', postcode: '2611bc', city: 'DELFT' }, contact: 'form', ...over,
});

test('trims, formats the postcode and title-cases the city', () => {
  const n = normaliseListing(raw());
  expect(n.title).toBe('Oude Delft 12-A');
  expect(n.url).toBe('https://example.test/1');
  expect(n.address).toMatchObject({ street: 'Oude Delft', houseNumber: '12', addition: 'A', postcode: '2611 BC', city: 'Delft' });
});

test('drops a postcode that is not Dutch', () => {
  expect(normaliseListing(raw({ address: { postcode: 'SW1A 1AA', city: 'delft' } })).address.postcode).toBeUndefined();
});

test('city title case keeps Dutch particles lowercase', () => {
  expect(titleCaseCity('den haag')).toBe('Den Haag');
  expect(titleCaseCity("'S-GRAVENHAGE")).toBe("'s-Gravenhage");
  expect(titleCaseCity('alphen aan den rijn')).toBe('Alphen aan den Rijn');
  expect(titleCaseCity('capelle aan den ijssel')).toBe('Capelle aan den IJssel');
});

test('fills type and furnishing from the text', () => {
  const n = normaliseListing(raw({ title: 'Gestoffeerde studio', description: 'Een fijne studio in het centrum.' }));
  expect(n.type).toBe('studio');
  expect(n.furnishing).toBe('upholstered');
  expect(n.language).toBe('nl');
  expect(normaliseListing(raw({ type: 'house', title: 'Studio' })).type).toBe('house');
});

test('type detection does not read "3-kamer appartement" as a room', () => {
  expect(detectType('Ruim 3-kamer appartement')).toBe('apartment');
  expect(detectType('3 kamerwoning')).toBeUndefined();
  expect(detectType('Kamer in studentenhuis')).toBe('room');
  expect(detectType('Room in shared house')).toBe('room');
  expect(detectType('Tussenwoning met tuin')).toBe('house');
});

test('furnishing detection handles negations first', () => {
  expect(detectFurnishing('Unfurnished apartment')).toBe('unfurnished');
  expect(detectFurnishing('Ongemeubileerd, kaal opgeleverd')).toBe('unfurnished');
  expect(detectFurnishing('Fully furnished')).toBe('furnished');
  expect(detectFurnishing('Gemeubileerd')).toBe('furnished');
  expect(detectFurnishing('nice place')).toBe('unknown');
});

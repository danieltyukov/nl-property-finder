import { expect, test } from 'vitest';
import { normalisePostcode, splitAddress } from '../src/index.js';

test('the five forms from the plan', () => {
  expect(splitAddress('Oude Delft 12-A')).toEqual({ street: 'Oude Delft', houseNumber: '12', addition: 'A' });
  expect(splitAddress('Oude Delft 12A')).toEqual({ street: 'Oude Delft', houseNumber: '12', addition: 'A' });
  expect(splitAddress('Oude Delft 12 a')).toEqual({ street: 'Oude Delft', houseNumber: '12', addition: 'A' });
  expect(splitAddress('Laan van Meerdervoort 123 bis')).toEqual({
    street: 'Laan van Meerdervoort',
    houseNumber: '123',
    addition: 'bis',
  });
  expect(splitAddress('2611 BC Delft')).toEqual({ postcode: '2611 BC', city: 'Delft' });
});

test('the three spellings of one home agree on street, number and addition (Review Focus 1)', () => {
  const forms = ['Oude Delft 12-A', 'Oude Delft 12A', 'Oude Delft 12 a, 2611 BC'].map(splitAddress);
  for (const a of forms) {
    expect([a.street, a.houseNumber, a.addition]).toEqual(['Oude Delft', '12', 'A']);
  }
  expect(forms[2]?.postcode).toBe('2611 BC');
});

test('full addresses with postcode and city', () => {
  expect(splitAddress('Oude Delft 12 a, 2611 BC Delft')).toEqual({
    street: 'Oude Delft',
    houseNumber: '12',
    addition: 'A',
    postcode: '2611 BC',
    city: 'Delft',
  });
  expect(splitAddress('Kerkstraat 5, 2611bc delft')).toEqual({ street: 'Kerkstraat', houseNumber: '5', postcode: '2611 BC', city: 'delft' });
  expect(splitAddress('Coolsingel 40, Rotterdam')).toEqual({ street: 'Coolsingel', houseNumber: '40', city: 'Rotterdam' });
  expect(splitAddress('Laan van Meerdervoort 123 bis Den Haag')).toEqual({
    street: 'Laan van Meerdervoort',
    houseNumber: '123',
    addition: 'bis',
    city: 'Den Haag',
  });
  expect(splitAddress('Kerkstraat 5 Den Haag')).toEqual({ street: 'Kerkstraat', houseNumber: '5', city: 'Den Haag' });
});

test('Amsterdam floor additions and streets that start with a number', () => {
  expect(splitAddress('Van Woustraat 12-3')).toEqual({ street: 'Van Woustraat', houseNumber: '12', addition: '3' });
  expect(splitAddress('Van Woustraat 12 III')).toEqual({ street: 'Van Woustraat', houseNumber: '12', addition: 'III' });
  expect(splitAddress('Van Woustraat 12-hs')).toEqual({ street: 'Van Woustraat', houseNumber: '12', addition: 'hs' });
  expect(splitAddress('1e Carnissestraat 5')).toEqual({ street: '1e Carnissestraat', houseNumber: '5' });
  expect(splitAddress("Jan van Galenstraat 7 2-hoog")).toEqual({ street: 'Jan van Galenstraat', houseNumber: '7', addition: '2-hoog' });
});

test('text without a house number', () => {
  expect(splitAddress('Oude Delft')).toEqual({ street: 'Oude Delft' });
  expect(splitAddress('Oude Delft, Delft')).toEqual({ street: 'Oude Delft', city: 'Delft' });
  expect(splitAddress('')).toEqual({});
  expect(splitAddress('Te huur: Oude Delft 12A')).toEqual({ street: 'Oude Delft', houseNumber: '12', addition: 'A' });
});

test('normalisePostcode', () => {
  expect(normalisePostcode('2611bc')).toBe('2611 BC');
  expect(normalisePostcode(' 2611  BC ')).toBe('2611 BC');
  expect(normalisePostcode('2611')).toBeUndefined();
});

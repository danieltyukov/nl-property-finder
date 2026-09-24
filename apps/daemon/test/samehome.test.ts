import { expect, test } from 'vitest';
import type { Property } from '@nlpf/core';
import { isSameHome } from '../src/actions.js';

const home = (street: string, houseNumber: string, title = `Appartement ${street}`): Property => ({
  id: 'p', key: 'k', title, address: { street, houseNumber, city: 'Delft' }, createdAt: 't', updatedAt: 't',
});

test('the typed address matches street and number, not just the street', () => {
  expect(isSameHome('Kuipersgracht 12', home('Kuipersgracht', '12'))).toBe(true);
  expect(isSameHome('kuipersgracht 12a, Delft', home('Kuipersgracht', '12'))).toBe(true);
  expect(isSameHome('Kuipersgracht 120', home('Kuipersgracht', '12'))).toBe(false);
  expect(isSameHome('Kuipersgracht 7', home('Kuipersgracht', '12'))).toBe(false);
  expect(isSameHome('Oude Delft 12', home('Kuipersgracht', '12'))).toBe(false);
});

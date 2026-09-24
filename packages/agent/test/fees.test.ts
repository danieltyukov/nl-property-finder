import { describe, expect, test } from 'vitest';
import { feeFlags } from '../src/fees.js';

describe('mediation_fee', () => {
  test.each([
    'Bemiddelingskosten: € 350 eenmalig.',
    'Er worden bemiddelingskosten van 1 maand huur in rekening gebracht.',
    'Administratiekosten € 150 en contractkosten € 100.',
    'An agency fee of EUR 500 applies.',
    'Tenant pays a mediation fee of one month rent.',
  ])('fires on "%s"', (text) => expect(feeFlags(text)).toContain('mediation_fee'));

  test.each([
    'Geen bemiddelingskosten!',
    'Deze woning wordt zonder bemiddelingskosten verhuurd.',
    'Bemiddelingskosten: n.v.t.',
    'Bemiddelingskosten € 0,-',
    'No agency fees.',
  ])('stays quiet on "%s"', (text) => expect(feeFlags(text)).not.toContain('mediation_fee'));
});

describe('deposit_above_2x', () => {
  test.each([
    ['Waarborgsom: 3 maanden kale huur.', undefined],
    ['Borg drie maanden huur', undefined],
    ['De borg bedraagt 3x de huur.', undefined],
    ['A deposit of three months rent is required.', undefined],
    ['3 months deposit', undefined],
    ['Huur € 1.000 per maand, borg € 3.000.', 1000],
    ['Security deposit: EUR 2,500', 1000],
  ] as [string, number | undefined][])('fires on "%s"', (text, price) => expect(feeFlags(text, price)).toContain('deposit_above_2x'));

  test.each([
    ['Waarborgsom: 2 maanden kale huur.', undefined],
    ['Deposit: 2x monthly rent', undefined],
    ['Borg € 2.000', 1000],
    ['Borg € 3.000', undefined],
    ['Een borgstelling van drie maanden is mogelijk via een borgsteller.', undefined],
    ['Geen borg nodig.', 1000],
  ] as [string, number | undefined][])('stays quiet on "%s"', (text, price) => expect(feeFlags(text, price)).not.toContain('deposit_above_2x'));
});

describe('key_money', () => {
  test.each([
    'Sleutelgeld € 1.000.',
    'Key money of 2000 euro is required.',
    'Overnamekosten vloer en gordijnen: € 2.500',
    'A takeover fee applies.',
  ])('fires on "%s"', (text) => expect(feeFlags(text)).toContain('key_money'));

  test.each(['Geen sleutelgeld.', 'Vloer en gordijnen ter overname.', 'No key money.'])('stays quiet on "%s"', (text) =>
    expect(feeFlags(text)).not.toContain('key_money'));
});

test('all three together, each once', () => {
  expect(feeFlags('Bemiddelingskosten € 300. Borg 3 maanden. Sleutelgeld € 500. Bemiddelingskosten zijn eenmalig.')).toEqual([
    'mediation_fee', 'deposit_above_2x', 'key_money',
  ]);
});

test('an ordinary listing has no flags', () => {
  expect(feeFlags('Huurprijs € 1.250 per maand exclusief servicekosten. Waarborgsom 1 maand huur. Geen bemiddelingskosten.', 1250)).toEqual([]);
});

import { expect, test } from 'vitest';
import { ProfileSchema } from '@nlpf/core';
import { applicationAnswers, dutchPhone, initials, moveInChoices } from '../src/generic/viewing-request.js';

const now = new Date('2026-09-26T12:00:00Z');
const profile = ProfileSchema.parse({
  firstName: 'Sam Pieter',
  lastName: 'de Vries',
  email: 'sam+huur@example.test',
  phone: '+31 6 1234 5678',
  salutation: 'dhr',
  birthDate: '2001-03-09',
  occupation: 'student',
  job: { employer: 'Acme', role: 'engineer' },
  incomeMonthlyGrossEur: 3200.4,
  moveInFrom: '2026-09-01',
  address: { street: 'Oude Delft', houseNumber: '12', addition: 'A', postcode: '2611 bc', city: 'Delft' },
});

test('maps the profile onto the portal field names', () => {
  const a = applicationAnswers(profile, now);
  expect(a.text).toMatchObject({
    a_roepnaam: 'Sam',
    a_voornamen: 'Sam Pieter',
    a_voorletters: 'S.P.',
    a_achternaam: 'de Vries',
    a_geboortedatum: '09-03-2001',
    a_postcode: '2611BC',
    a_huisnummer: '12',
    a_huisnummertoevoeging: 'A',
    a_straat: 'Oude Delft',
    a_woonplaats: 'Delft',
    a_telefoon: '0612345678',
    a_email: 'sam+huur@example.test',
    a_maandinkomen: '3200',
  });
  expect(a.choice).toMatchObject({ a_geslacht: ['M'], a_samenhuren: ['Alleen'], a_werksituatie: ['Loondienst'] });
  expect(a.select).toMatchObject({ a_land: ['NL', 'Nederland'], gez_pers: ['1'], gez_kind: ['0'], a_wanneerhuren: ['Per direct', 'Now'] });
});

test('leaves out what the profile does not know, so the portal keeps its saved answers', () => {
  const a = applicationAnswers(ProfileSchema.parse({ firstName: 'Sam', lastName: 'de Vries' }), now);
  expect(a.text.a_geboortedatum).toBeUndefined();
  expect(a.text.a_postcode).toBeUndefined();
  expect(a.choice.a_geslacht).toBeUndefined();
  expect(a.text.a_spaargeld).toBeUndefined();
});

test('move-in: now or a past date is "Per direct", a later month is named in Dutch and English', () => {
  expect(moveInChoices('2026-09-30', now)).toEqual(['Per direct', 'Now']);
  expect(moveInChoices(undefined, now)).toEqual(['Per direct', 'Now']);
  expect(moveInChoices('2026-11-15', now)).toEqual(['november 2026', 'november 2026']);
  expect(moveInChoices('2027-01-01', now)).toEqual(['januari 2027', 'january 2027']);
});

test('initials and a Dutch phone number', () => {
  expect(initials('Daniel')).toBe('D.');
  expect(initials('anna-maria louise')).toBe('A.M.L.');
  expect(dutchPhone('+31 6 27321612')).toBe('0627321612');
  expect(dutchPhone('0031 6 1234 5678')).toBe('0612345678');
  expect(dutchPhone('06-12345678')).toBe('0612345678');
});

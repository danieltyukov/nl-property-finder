import { describe, expect, test } from 'vitest';
import {
  detectFurnishing,
  detectType,
  parseBedrooms,
  parseDutchDate,
  parsePrice,
  parseRooms,
  parseSize,
} from '../src/index.js';

// Wednesday 23 September 2026, 12:00 in Amsterdam.
const now = new Date('2026-09-23T10:00:00Z');

describe('parsePrice', () => {
  test('the forms from the plan', () => {
    expect(parsePrice('€ 1.250,- per maand excl.')).toEqual({ priceEur: 1250, basis: 'excl' });
    expect(parsePrice('EUR 975 incl. g/w/e')).toEqual({ priceEur: 975, basis: 'incl' });
    const onRequest = parsePrice('Prijs op aanvraag');
    expect(onRequest.priceEur).toBeUndefined();
    expect(onRequest.basis).toBe('unknown');
  });

  test('thousands and decimal separators in Dutch and English', () => {
    expect(parsePrice('€ 1.250,00 /mnd').priceEur).toBe(1250);
    expect(parsePrice('€1,250 per month').priceEur).toBe(1250);
    expect(parsePrice('€ 1.395').priceEur).toBe(1395);
    expect(parsePrice('€ 850,50').priceEur).toBe(850.5);
    expect(parsePrice('1250').priceEur).toBe(1250);
    expect(parsePrice('Huurprijs: € 2.100 p/m').priceEur).toBe(2100);
    expect(parsePrice('€ 1.100,-').priceEur).toBe(1100);
  });

  test('takes the first amount and the basis that follows it', () => {
    expect(parsePrice('€ 1.250 - € 1.400 per maand')).toEqual({ priceEur: 1250, basis: 'unknown' });
    expect(parsePrice('€ 900 exclusief servicekosten (€ 45)')).toEqual({ priceEur: 900, basis: 'excl' });
    expect(parsePrice('€ 1.100 inclusief')).toEqual({ priceEur: 1100, basis: 'incl' });
    expect(parsePrice('€ 700 all-in').basis).toBe('incl');
    expect(parsePrice('€ 1.150 excluding utilities').basis).toBe('excl');
  });

  test('nothing to parse', () => {
    expect(parsePrice('').priceEur).toBeUndefined();
    expect(parsePrice('Huurprijs in overleg').priceEur).toBeUndefined();
  });
});

describe('sizes and rooms', () => {
  test('parseSize', () => {
    expect(parseSize('Woonoppervlakte 42 m²')).toBe(42);
    expect(parseSize('42m2')).toBe(42);
    expect(parseSize('65,5 m²')).toBe(66);
    expect(parseSize('Living area: 120 sq m')).toBe(120);
    expect(parseSize('42')).toBe(42);
    expect(parseSize('3 kamers')).toBeUndefined();
    expect(parseSize('')).toBeUndefined();
  });

  test('parseRooms and parseBedrooms', () => {
    expect(parseRooms('3 kamers')).toBe(3);
    expect(parseRooms('Aantal kamers: 4')).toBe(4);
    expect(parseRooms('2 rooms')).toBe(2);
    expect(parseRooms('3 kamers (2 slaapkamers)')).toBe(3);
    expect(parseRooms('2 slaapkamers')).toBeUndefined();
    expect(parseRooms('5')).toBe(5);
    expect(parseBedrooms('3 kamers (2 slaapkamers)')).toBe(2);
    expect(parseBedrooms('1 bedroom')).toBe(1);
    expect(parseBedrooms('Aantal slaapkamers: 3')).toBe(3);
  });
});

describe('parseDutchDate', () => {
  test('per direct and friends are today in Amsterdam', () => {
    expect(parseDutchDate('per direct', now)).toBe('2026-09-23');
    expect(parseDutchDate('Direct beschikbaar', now)).toBe('2026-09-23');
    expect(parseDutchDate('Available immediately', now)).toBe('2026-09-23');
    // 23:30 UTC on the 23rd is already the 24th in Amsterdam.
    expect(parseDutchDate('per direct', new Date('2026-09-23T23:30:00Z'))).toBe('2026-09-24');
  });

  test('full dates', () => {
    expect(parseDutchDate('Beschikbaar vanaf 1 november 2026')).toBe('2026-11-01');
    expect(parseDutchDate('vanaf 1 nov. 2026', now)).toBe('2026-11-01');
    expect(parseDutchDate('Per 15-10-2026', now)).toBe('2026-10-15');
    expect(parseDutchDate('01/12/2026', now)).toBe('2026-12-01');
    expect(parseDutchDate('2026-10-01', now)).toBe('2026-10-01');
    expect(parseDutchDate('Available from 1 December 2026', now)).toBe('2026-12-01');
    expect(parseDutchDate('Available from November 1, 2026', now)).toBe('2026-11-01');
  });

  test('dates without a year pick the coming occurrence', () => {
    expect(parseDutchDate('per 1 oktober', now)).toBe('2026-10-01');
    expect(parseDutchDate('vanaf 1 januari', now)).toBe('2027-01-01');
    expect(parseDutchDate('per 15 september', now)).toBe('2026-09-15');
    expect(parseDutchDate('vanaf december', now)).toBe('2026-12-01');
  });

  test('no date', () => {
    expect(parseDutchDate('In overleg', now)).toBeUndefined();
    expect(parseDutchDate('31 februari 2026', now)).toBeUndefined();
    expect(parseDutchDate('', now)).toBeUndefined();
  });
});

describe('detectFurnishing', () => {
  test('Dutch and English terms', () => {
    expect(detectFurnishing('Gestoffeerd')).toBe('upholstered');
    expect(detectFurnishing('Gemeubileerd appartement')).toBe('furnished');
    expect(detectFurnishing('gemeubeld')).toBe('furnished');
    expect(detectFurnishing('Ongemeubileerd')).toBe('unfurnished');
    expect(detectFurnishing('Kaal opgeleverd')).toBe('unfurnished');
    expect(detectFurnishing('Unfurnished')).toBe('unfurnished');
    expect(detectFurnishing('Semi-furnished')).toBe('upholstered');
    expect(detectFurnishing('Fully furnished studio')).toBe('furnished');
    expect(detectFurnishing('Mooie woning')).toBe('unknown');
  });

  test('the first mention wins', () => {
    expect(detectFurnishing('Gestoffeerd, op verzoek gemeubileerd')).toBe('upholstered');
  });
});

describe('detectType', () => {
  test('type words', () => {
    expect(detectType('Studio')).toBe('studio');
    expect(detectType('Kamer te huur')).toBe('room');
    expect(detectType('Room in shared house')).toBe('room');
    expect(detectType('Appartement')).toBe('apartment');
    expect(detectType('Bovenwoning')).toBe('apartment');
    expect(detectType('Eengezinswoning')).toBe('house');
    expect(detectType('Tussenwoning met tuin')).toBe('house');
    expect(detectType('House')).toBe('house');
    expect(detectType('Woning')).toBeUndefined();
  });

  test('ignores rooms inside a home and picks the first type mentioned', () => {
    expect(detectType('Apartment with a spacious living room')).toBe('apartment');
    expect(detectType('Appartement met 3 kamers en een woonkamer')).toBe('apartment');
    expect(detectType('Kamer in studentenhuis')).toBe('room');
    expect(detectType('Nice bedroom and bathroom')).toBeUndefined();
  });
});

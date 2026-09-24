import { describe, expect, test } from 'vitest';
import { energyPoints, estimateMaxRent, maxRentForPoints, rentCheck, wozPoints } from '../src/rentcheck.js';
import { listing } from './helpers.js';

const now = new Date('2026-09-23T10:00:00Z');

describe('the official numbers', () => {
  test('maximum rent table of 1 January 2026', () => {
    expect(maxRentForPoints(40)).toBe(250.26);
    expect(maxRentForPoints(143)).toBe(932.93);
    expect(maxRentForPoints(186)).toBe(1228.07);
    expect(maxRentForPoints(250)).toBe(1667.4);
    expect(maxRentForPoints(252)).toBeCloseTo(1667.4 + 2 * 6.86, 2); // beyond the table: the 249 to 250 step per point
  });

  test('WOZ points follow the Huurcommissie example', () => {
    // Beleidsboek 2.11.2: WOZ 300,000 on 60 m2 with peildatum 1 January 2025 gives 36.25 points.
    expect(wozPoints(300_000, 60, '2025-01-01')).toBe(36.25);
    expect(wozPoints(300_000, 60, '2024-01-01')).toBe(
      Math.round((300_000 / 15_329 + 300_000 / 60 / 242) * 4) / 4,
    );
  });

  test('energy label points differ for single-family and multi-family homes', () => {
    expect(energyPoints('A', 'apartment')).toBe(37);
    expect(energyPoints('A', 'house')).toBe(41);
    expect(energyPoints('a++', 'house')).toBe(52);
    expect(energyPoints('E', 'apartment')).toBe(-4);
    expect(energyPoints('G', 'house')).toBe(-15);
    expect(energyPoints(undefined, 'apartment', 1995)).toBe(15); // no label: build year 1992-1999
  });
});

describe('estimateMaxRent', () => {
  test('a 30 m2 studio with label A and WOZ 180,000 lands in the documented range and says it is an estimate', () => {
    const r = estimateMaxRent({ sizeM2: 30, energyLabel: 'A', type: 'studio', wozEur: 180_000 });
    // 30 area + 4 heating + 37 label A + 7 kitchen + 8 sanitary + 33 WOZ = 119 points.
    expect(r.points).toBe(119);
    expect(r.points).toBeGreaterThanOrEqual(100);
    expect(r.points).toBeLessThanOrEqual(140);
    expect(r.maxRentEur).toBe(768.08);
    expect(r.sector).toBe('social');
    expect(r.note).toMatch(/estimate/i);
  });

  test('sectors: social up to 143 points, middle 144 to 186, free from 187', () => {
    expect(estimateMaxRent({ sizeM2: 60, energyLabel: 'A', type: 'apartment', wozEur: 300_000 }).sector).toBe(
      'middle',
    );
    expect(estimateMaxRent({ sizeM2: 110, energyLabel: 'A+', type: 'house', wozEur: 650_000 }).sector).toBe(
      'free',
    );
  });

  test('the WOZ share is capped at 33% from 187 points, with a floor of 186', () => {
    const r = estimateMaxRent({ sizeM2: 60, energyLabel: 'B', type: 'apartment', wozEur: 900_000 });
    // Without the cap: 60 + 6 + 30 + 11 + 10 + WOZ 109 = 226. Capped WOZ is 57, total 174, so the floor of 186 applies.
    expect(r.points).toBe(186);
    expect(r.sector).toBe('middle');
  });

  test('without a WOZ value the legal minimum is used and the note says so', () => {
    const r = estimateMaxRent({ sizeM2: 30, energyLabel: 'A', type: 'studio' });
    expect(r.note).toMatch(/WOZ/);
    expect(r.points).toBeLessThan(
      estimateMaxRent({ sizeM2: 30, energyLabel: 'A', type: 'studio', wozEur: 180_000 }).points,
    );
  });
});

describe('rentCheck', () => {
  const facts = {
    sizeM2: 30,
    energyLabel: 'A',
    wozEur: 180_000,
    buildYear: 2004,
    sources: ['bag', 'woz', 'ep-online'] as ('bag' | 'woz' | 'ep-online')[],
  };

  test('a studio asking 40% more than the estimate is about 40% above', () => {
    const l = listing({ type: 'studio', priceEur: Math.round(768.08 * 1.4), sizeM2: 32 });
    const r = rentCheck(l, facts, now);
    expect(r?.aboveMaxPct).toBeCloseTo(40, 0);
    expect(r).toMatchObject({
      points: 119,
      maxRentEur: 768.08,
      sector: 'social',
      sources: ['bag', 'woz', 'ep-online'],
    });
    expect(r?.inputs).toEqual({ sizeM2: 30, energyLabel: 'A', wozEur: 180_000, buildYear: 2004 });
    expect(r?.note).toMatch(/estimate/i);
  });

  test('service costs are left out of an inclusive price', () => {
    const l = listing({
      type: 'studio',
      priceEur: 900,
      priceBasis: 'incl',
      serviceCostsEur: 131.92,
      sizeM2: 30,
    });
    expect(rentCheck(l, facts, now)?.aboveMaxPct).toBeCloseTo(0, 0);
  });

  test('listing data fills gaps and is named as a source', () => {
    const r = rentCheck(
      listing({ type: 'studio', priceEur: 700, sizeM2: 30, energyLabel: 'A' }),
      { wozEur: 180_000, sources: ['woz'] },
      now,
    );
    expect(r?.sources).toEqual(['woz', 'listing']);
    expect(r?.aboveMaxPct).toBeLessThan(0);
  });

  test('no comparison without an official WOZ value or in the free sector', () => {
    expect(
      rentCheck(listing({ type: 'studio', priceEur: 1200, sizeM2: 30 }), { sources: [] }, now)?.aboveMaxPct,
    ).toBeUndefined();
    const big = rentCheck(
      listing({ type: 'house', priceEur: 3000, sizeM2: 140 }),
      { sizeM2: 140, energyLabel: 'A', wozEur: 800_000, sources: ['bag', 'woz'] },
      now,
    );
    expect(big?.sector).toBe('free');
    expect(big?.aboveMaxPct).toBeUndefined();
    expect(big?.note).toMatch(/free sector/i);
  });

  test('an out-of-date table is mentioned', () => {
    const r = rentCheck(
      listing({ type: 'studio', priceEur: 900, sizeM2: 30 }),
      { wozEur: 180_000, sources: ['woz'] },
      new Date('2027-02-01T00:00:00Z'),
    );
    expect(r?.note).toMatch(/2026 tables were used/);
    expect(
      rentCheck(
        listing({ type: 'studio', priceEur: 900, sizeM2: 30 }),
        { wozEur: 180_000, sources: ['woz'] },
        now,
      )?.note,
    ).not.toMatch(/tables were used/);
  });

  test('rooms and listings without a size are not checked', () => {
    expect(rentCheck(listing({ type: 'room', sizeM2: 14 }), facts, now)).toBeUndefined();
    expect(rentCheck(listing({ sizeM2: undefined }), { sources: [] }, now)).toBeUndefined();
  });
});

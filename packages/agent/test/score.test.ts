import { expect, test } from 'vitest';
import { applyPreferences } from '../src/score.js';
import { listing, search } from './helpers.js';

const tu = { name: 'TU Delft', lat: 51.999, lon: 4.3735, mode: 'bike' as const, maxMinutes: 20 };
const near = listing({
  address: { city: 'Delft', lat: 52.0067, lon: 4.3556 },
  description: 'Licht appartement met balkon en berging.',
});
const far = listing({
  address: { city: 'Rotterdam', lat: 51.9244, lon: 4.469 },
  description: 'Appartement zonder buitenruimte.',
});

test('must-haves raise the score when mentioned and lower it when not', () => {
  const s = search({ mustHaves: ['balkon', 'vaatwasser'] });
  const out = applyPreferences({ score: 70, reasons: ['fits budget'] }, near, s);
  expect(out.score).toBe(70 + 4 - 8);
  expect(out.reasons).toEqual(['fits budget', 'mentions balkon', 'no mention of vaatwasser']);
});

test('commute within the limit adds points and a reason with the minutes', () => {
  const out = applyPreferences({ score: 70, reasons: [] }, near, search({ commute: [tu] }));
  expect(out.score).toBe(75);
  expect(out.reasons).toEqual(['8 min by bike to TU Delft']);
});

test('commute over the limit costs points', () => {
  const out = applyPreferences({ score: 70, reasons: [] }, far, search({ commute: [tu] }));
  expect(out.score).toBe(55);
  expect(out.reasons[0]).toMatch(/^\d+ min by bike to TU Delft, over 20$/);
});

test('commute without a limit is only a reason, and unknown coordinates are skipped', () => {
  const info = { ...tu, maxMinutes: undefined };
  expect(applyPreferences({ score: 70, reasons: [] }, near, search({ commute: [info] }))).toEqual({
    score: 70,
    reasons: ['8 min by bike to TU Delft'],
  });
  expect(applyPreferences({ score: 70, reasons: [] }, listing(), search({ commute: [tu] }))).toEqual({
    score: 70,
    reasons: [],
  });
});

test('the score stays between 0 and 100', () => {
  expect(
    applyPreferences({ score: 98, reasons: [] }, near, search({ mustHaves: ['balkon', 'berging'] })).score,
  ).toBe(100);
  expect(
    applyPreferences({ score: 5, reasons: [] }, far, search({ commute: [tu], mustHaves: ['tuin'] })).score,
  ).toBe(0);
});

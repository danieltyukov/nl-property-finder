import { expect, test } from 'vitest';
import { commuteMinutes, distanceKm } from '../src/commute.js';

const station = { lat: 52.0067, lon: 4.3556 }; // Delft station
const ewi = { lat: 51.999, lon: 4.3735 }; // TU Delft, EEMCS building
const rotterdam = { lat: 51.9244, lon: 4.469 }; // Rotterdam Centraal

test('straight-line distance', () => {
  expect(distanceKm(station, ewi)).toBeCloseTo(1.49, 1);
  expect(distanceKm(station, rotterdam)).toBeCloseTo(12.1, 0);
  expect(distanceKm(station, station)).toBe(0);
});

test('minutes by mode use a detour factor and a speed', () => {
  const km = distanceKm(station, ewi);
  expect(commuteMinutes(station, ewi, 'bike')).toBe(Math.round(((km * 1.3) / 15) * 60));
  expect(commuteMinutes(station, ewi, 'walk')).toBe(Math.round(((km * 1.25) / 5) * 60));
  expect(commuteMinutes(station, ewi, 'car')).toBe(Math.round(((km * 1.4) / 35) * 60));
  expect(commuteMinutes(station, ewi, 'transit')).toBe(Math.round(((km * 1.5) / 25) * 60 + 8));
  expect(commuteMinutes(station, ewi, 'bike')).toBe(8);
});

test('Delft to Rotterdam by bike takes about an hour', () => {
  const min = commuteMinutes(station, rotterdam, 'bike');
  expect(min).toBeGreaterThan(55);
  expect(min).toBeLessThan(70);
});

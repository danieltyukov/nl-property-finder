import { expect, test } from 'vitest';
import { adaptiveInterval, hourOfWeek } from '../src/adaptive.js';

// New listings per hour-of-week bin (0 = Monday 00:00 Amsterdam), busy on Monday morning only.
const histogram = Array.from({ length: 168 }, () => 0);
histogram[8] = 6;
histogram[9] = 30;
histogram[10] = 12;
for (let d = 0; d < 5; d += 1) histogram[d * 24 + 14] = 2; // a little every weekday afternoon

const monday0900 = new Date('2026-09-28T07:00:00Z'); // 09:00 CEST
const sunday0400 = new Date('2026-09-27T02:00:00Z'); // 04:00 CEST

test('hour of week follows the Amsterdam clock', () => {
  expect(hourOfWeek(monday0900)).toBe(9);
  expect(hourOfWeek(sunday0400)).toBe(6 * 24 + 4);
  expect(hourOfWeek(new Date('2026-12-07T08:00:00Z'))).toBe(9); // Monday 09:00 CET
});

test('a histogram peaking Monday 09:00 shortens the interval then and lengthens it Sunday 04:00', () => {
  const peak = adaptiveInterval(240, histogram, monday0900);
  const quiet = adaptiveInterval(240, histogram, sunday0400);
  expect(peak).toBe(120); // 0.5x
  expect(quiet).toBe(720); // 3x
});

test('never below the floor, never beyond 0.5x to 3x', () => {
  expect(adaptiveInterval(90, histogram, monday0900)).toBe(60); // JSON floor
  expect(adaptiveInterval(180, histogram, monday0900, { floorSec: 120 })).toBe(120); // browser floor
  expect(adaptiveInterval(60, histogram, sunday0400)).toBe(180);
  const ordinary = adaptiveInterval(240, histogram, new Date('2026-09-29T12:00:00Z')); // Tuesday 14:00, near the mean
  expect(ordinary).toBeGreaterThanOrEqual(120);
  expect(ordinary).toBeLessThanOrEqual(720);
});

test('without data the base interval is kept', () => {
  expect(adaptiveInterval(240, Array.from({ length: 168 }, () => 0), monday0900)).toBe(240);
  expect(adaptiveInterval(240, [1, 2, 3], monday0900)).toBe(240);
  expect(adaptiveInterval(30, [], monday0900)).toBe(60);
});

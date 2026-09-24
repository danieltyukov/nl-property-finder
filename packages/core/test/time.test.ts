import { expect, test } from 'vitest';
import { amsterdam, fromAmsterdam, isWithinWindow, amsterdamDate } from '../src/index.js';

test('summer and winter offsets', () => {
  expect(fromAmsterdam(2026, 9, 24, 18, 30).toISOString()).toBe('2026-09-24T16:30:00.000Z');
  expect(fromAmsterdam(2026, 12, 1, 9, 0).toISOString()).toBe('2026-12-01T08:00:00.000Z');
});

test('the repeated October hour resolves to its first occurrence', () => {
  expect(fromAmsterdam(2026, 10, 25, 2, 30).toISOString()).toBe('2026-10-25T00:30:00.000Z');
});

test('a non-existent March time moves forward one hour', () => {
  const d = fromAmsterdam(2026, 3, 29, 2, 30);
  expect(amsterdam(d)).toMatchObject({ hh: 3, mm: 30 });
});

test('windows, including across midnight', () => {
  const at = (iso: string) => new Date(iso);
  expect(isWithinWindow(at('2026-09-24T21:45:00Z'), '07:00', '23:30')).toBe(false); // 23:45 local
  expect(isWithinWindow(at('2026-09-24T05:00:00Z'), '07:00', '23:30')).toBe(true); // 07:00 local
  expect(isWithinWindow(at('2026-09-24T22:30:00Z'), '23:00', '07:00')).toBe(true);
  expect(amsterdamDate(at('2026-09-24T22:30:00Z'))).toBe('2026-09-25');
});

import { expect, test } from 'vitest';
import { inSendWindow, nextWindowStart } from '../src/window.js';

const win = { start: '07:00', end: '23:30' };
const at = (iso: string) => new Date(iso);

test('23:45 Amsterdam is outside 07:00-23:30 and the next start is 07:00 the next day', () => {
  const now = at('2026-09-24T21:45:00Z'); // Thursday 23:45 CEST
  expect(inSendWindow(now, win)).toBe(false);
  expect(nextWindowStart(now, win).toISOString()).toBe('2026-09-25T05:00:00.000Z');
});

test('across the October DST change the next start is 07:00 winter time', () => {
  const now = at('2026-10-24T21:45:00Z'); // Saturday 23:45 CEST; clocks go back at 03:00 on Sunday
  expect(inSendWindow(now, win)).toBe(false);
  expect(nextWindowStart(now, win).toISOString()).toBe('2026-10-25T06:00:00.000Z');
});

test('across the March DST change the next start is 07:00 summer time', () => {
  const now = at('2026-03-28T23:00:00Z'); // Sunday 00:00 CET
  expect(nextWindowStart(now, win).toISOString()).toBe('2026-03-29T05:00:00.000Z');
});

test('early morning waits for the same day', () => {
  const now = at('2026-09-24T03:00:00Z'); // 05:00 CEST
  expect(inSendWindow(now, win)).toBe(false);
  expect(nextWindowStart(now, win).toISOString()).toBe('2026-09-24T05:00:00.000Z');
});

test('inside the window the next start is now', () => {
  const now = at('2026-09-24T10:00:00Z');
  expect(inSendWindow(now, win)).toBe(true);
  expect(nextWindowStart(now, win)).toEqual(now);
});

test('a window across midnight', () => {
  const night = { start: '22:00', end: '02:00' };
  expect(inSendWindow(at('2026-09-24T23:00:00Z'), night)).toBe(true); // 01:00 local
  expect(nextWindowStart(at('2026-09-24T10:00:00Z'), night).toISOString()).toBe('2026-09-24T20:00:00.000Z');
});

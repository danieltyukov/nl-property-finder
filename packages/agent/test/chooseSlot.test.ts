import { expect, test } from 'vitest';
import { AutomationSchema, type ProposedSlot } from '@nlpf/core';
import { chooseSlot } from '../src/slots.js';

const availability = AutomationSchema.parse({}).availability; // weekdays 09:00-20:00, weekends 10:00-18:00
const slot = (start: string, over: Partial<ProposedSlot> = {}): ProposedSlot => ({ start, text: start, certain: true, ...over });

const thu1830 = slot('2026-09-24T16:30:00.000Z');
const fri1900 = slot('2026-09-25T17:00:00.000Z');
const thu2100 = slot('2026-09-24T19:00:00.000Z');

test('picks the earliest slot inside availability', () => {
  expect(chooseSlot([fri1900, thu1830], availability, 45, [])).toEqual(thu1830);
});

test('skips a slot that overlaps a booked viewing plus the travel buffer', () => {
  const busy = [{ start: '2026-09-24T15:30:00.000Z', end: '2026-09-24T16:00:00.000Z' }]; // 17:30-18:00 local
  expect(chooseSlot([thu1830, fri1900], availability, 45, busy)).toEqual(fri1900);
  expect(chooseSlot([thu1830, fri1900], availability, 15, busy)).toEqual(thu1830);
});

test('skips slots outside availability and uncertain slots', () => {
  expect(chooseSlot([thu2100, slot('2026-09-25T07:00:00.000Z', { certain: false })], availability, 45, [])).toBeNull();
});

test('a slot must end inside availability', () => {
  expect(chooseSlot([slot('2026-09-24T17:45:00.000Z')], availability, 0, [])).toBeNull(); // 19:45 + 30 min > 20:00
  expect(chooseSlot([slot('2026-09-24T17:45:00.000Z', { end: '2026-09-24T17:55:00.000Z' })], availability, 0, [])).not.toBeNull();
});

test('weekend availability applies on Saturday', () => {
  const sat0930 = slot('2026-09-26T07:30:00.000Z');
  const sat1000 = slot('2026-09-26T08:00:00.000Z', { end: '2026-09-26T08:15:00.000Z' });
  expect(chooseSlot([sat0930, sat1000], availability, 45, [])).toEqual(sat1000);
});

test('an open window is narrowed to the first free half hour', () => {
  const window = slot('2026-09-25T15:00:00.000Z', { end: '2026-09-25T17:00:00.000Z', text: 'vrijdag tussen 17 en 19 uur' }); // 17:00-19:00 local
  const busy = [{ start: '2026-09-25T15:00:00.000Z', end: '2026-09-25T15:30:00.000Z' }];
  expect(chooseSlot([window], availability, 45, busy)).toEqual({
    ...window, start: '2026-09-25T16:15:00.000Z', end: '2026-09-25T16:45:00.000Z',
  });
});

test('returns null when nothing fits', () => {
  expect(chooseSlot([], availability, 45, [])).toBeNull();
  const busy = [{ start: '2026-09-24T14:00:00.000Z', end: '2026-09-24T18:00:00.000Z' }];
  expect(chooseSlot([thu1830], availability, 45, busy)).toBeNull();
});

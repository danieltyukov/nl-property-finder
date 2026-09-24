import { expect, test } from 'vitest';
import type { Property, Viewing } from '@nlpf/core';
import { renderIcs } from '../src/ics.js';

test('booked viewings render as VEVENTs with stable UIDs, UTC times and escaped text', () => {
  const p: Property = { id: 'p1', key: 'k', title: 'Oude Delft 12A; top floor', address: { street: 'Oude Delft', houseNumber: '12', addition: 'A', postcode: '2611 BC', city: 'Delft' }, createdAt: 't', updatedAt: 't' };
  const v: Viewing[] = [
    { id: 'v1', applicationId: 'a1', propertyId: 'p1', startsAt: '2026-09-24T16:30:00.000Z', endsAt: '2026-09-24T16:45:00.000Z', state: 'booked', bookedBy: 'agent' },
    { id: 'v2', applicationId: 'a1', propertyId: 'p1', startsAt: '2026-09-25T16:30:00.000Z', endsAt: '2026-09-25T16:45:00.000Z', state: 'cancelled', bookedBy: 'agent' },
  ];
  const ics = renderIcs(v, new Map([['p1', p]]), '2026-09-24T10:00:00.000Z');
  expect(ics).toContain('UID:v1@nl-property-finder');
  expect(ics).toContain('DTSTART:20260924T163000Z');
  expect(ics).toContain('SUMMARY:Viewing: Oude Delft 12A\; top floor');
  expect(ics).toContain('LOCATION:Oude Delft 12A\\, 2611 BC\\, Delft');
  expect(ics).not.toContain('UID:v2');
  expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
});

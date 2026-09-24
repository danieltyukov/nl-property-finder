import { describe, expect, it } from 'vitest';
import { parseSimpleSlots } from '../src/slots.js';

// Wednesday 23 September 2026, 12:00 in Amsterdam (CEST, UTC+2).
const now = new Date('2026-09-23T10:00:00.000Z');

describe('parseSimpleSlots', () => {
  it('reads a weekday with a time', () => {
    const slots = parseSimpleSlots('Kunt u donderdag om 18:30 langskomen voor een bezichtiging?', now);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ start: '2026-09-24T16:30:00.000Z', certain: true });
    expect(slots[0]?.text).toContain('donderdag');
  });

  it('reads a weekday with a date and time, as the sandbox writes them', () => {
    const slots = parseSimpleSlots('U bent welkom op donderdag 1 oktober 18:30.', now);
    expect(slots).toEqual([expect.objectContaining({ start: '2026-10-01T16:30:00.000Z', certain: true })]);
  });

  it('reads several options in one message', () => {
    const text = 'Mogelijke tijden:\n- vrijdag 2 oktober 17:00\n- zaterdag 3 oktober 11:00\n- maandag 5 oktober om half zeven';
    const starts = parseSimpleSlots(text, now).map((s) => s.start);
    expect(starts).toEqual(['2026-10-02T15:00:00.000Z', '2026-10-03T09:00:00.000Z', '2026-10-05T16:30:00.000Z']);
  });

  it('reads relative days and Dutch hour notation', () => {
    expect(parseSimpleSlots('morgen 14u', now)[0]?.start).toBe('2026-09-24T12:00:00.000Z');
    expect(parseSimpleSlots('overmorgen om 18.30 uur', now)[0]?.start).toBe('2026-09-25T16:30:00.000Z');
  });

  it('reads ranges into start and end', () => {
    const [slot] = parseSimpleSlots('za 10:00-10:15', now);
    expect(slot).toMatchObject({ start: '2026-09-26T08:00:00.000Z', end: '2026-09-26T08:15:00.000Z' });
    const [window] = parseSimpleSlots('Dinsdag tussen 17 en 19 uur', now);
    expect(window).toMatchObject({ start: '2026-09-29T15:00:00.000Z', end: '2026-09-29T17:00:00.000Z' });
  });

  it('reads English weekdays, dates and am or pm', () => {
    expect(parseSimpleSlots('Would Friday 2 October at 6 pm work for you?', now)[0]?.start).toBe('2026-10-02T16:00:00.000Z');
    expect(parseSimpleSlots('How about October 3rd at 11am?', now)[0]?.start).toBe('2026-10-03T09:00:00.000Z');
  });

  it('reads numeric dates', () => {
    expect(parseSimpleSlots('Bezichtiging op 26-09 om 10:00', now)[0]?.start).toBe('2026-09-26T08:00:00.000Z');
    expect(parseSimpleSlots('Viewing on 2/10 at 17:30', now)[0]?.start).toBe('2026-10-02T15:30:00.000Z');
  });

  it('marks a weekday that disagrees with the date as uncertain', () => {
    const [slot] = parseSimpleSlots('donderdag 26 sept om 18:00', now);
    expect(slot?.certain).toBe(false);
    expect(slot?.start).toBe('2026-09-26T16:00:00.000Z');
  });

  it('marks a date without a time as uncertain', () => {
    const [slot] = parseSimpleSlots('Kunt u donderdag 1 oktober langskomen?', now);
    expect(slot?.certain).toBe(false);
  });

  it('resolves the repeated October hour to its first occurrence', () => {
    expect(parseSimpleSlots('zondag 25 oktober 02:30', now)[0]?.start).toBe('2026-10-25T00:30:00.000Z');
  });

  it('does not read prices, postcodes or phone numbers as times', () => {
    expect(parseSimpleSlots('Huur EUR 1.150 per maand, 2611 BC, bel 06-12345678.', now)).toEqual([]);
    expect(parseSimpleSlots('Zo snel mogelijk graag, do you have pets?', now)).toEqual([]);
  });

  it('skips dates that are deadlines', () => {
    const slots = parseSimpleSlots('Bezichtiging donderdag 1 oktober om 18:30. Graag reactie voor 28 september.', now);
    expect(slots).toHaveLength(1);
  });
});

import { describe, expect, test } from 'vitest';
import { parseSlots } from '../src/slots.js';

// Wednesday 23 September 2026, 12:00 in Amsterdam (CEST, UTC+2).
const now = new Date('2026-09-23T10:00:00Z');
const starts = (text: string) => parseSlots(text, now).map((s) => s.start);

describe('the plan cases (Review Focus 5)', () => {
  test('"donderdag 24 sept om 18:30" is 2026-09-24T16:30Z and certain', () => {
    expect(parseSlots('donderdag 24 sept om 18:30', now)).toEqual([
      { start: '2026-09-24T16:30:00.000Z', text: 'donderdag 24 sept om 18:30', certain: true },
    ]);
  });

  test('"morgen 14u" is 2026-09-24T12:00Z', () => {
    expect(parseSlots('morgen 14u', now)).toEqual([
      { start: '2026-09-24T12:00:00.000Z', text: 'morgen 14u', certain: true },
    ]);
  });

  test('"za 10:00-10:15" gives start and end', () => {
    expect(parseSlots('za 10:00-10:15', now)).toEqual([
      {
        start: '2026-09-26T08:00:00.000Z',
        end: '2026-09-26T08:15:00.000Z',
        text: 'za 10:00-10:15',
        certain: true,
      },
    ]);
  });

  test('"zondag 25 oktober 02:30" resolves to the first occurrence of the repeated hour', () => {
    const [slot] = parseSlots('zondag 25 oktober 02:30', now);
    expect(slot?.start).toBe('2026-10-25T00:30:00.000Z');
    expect(slot?.certain).toBe(false); // the wall-clock time happens twice that night
  });

  test('"donderdag 26 sept" disagrees with its date (a Saturday) and has no time', () => {
    const slots = parseSlots('donderdag 26 sept', now);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ certain: false, text: 'donderdag 26 sept' });
  });

  test('"donderdag 26 sept om half zeven" keeps the date, reads 18:30 and is not certain', () => {
    expect(parseSlots('donderdag 26 sept om half zeven', now)).toEqual([
      { start: '2026-09-26T16:30:00.000Z', text: 'donderdag 26 sept om half zeven', certain: false },
    ]);
  });
});

describe('Dutch', () => {
  test('"half zeven" in the evening is 18:30 and certain', () => {
    expect(parseSlots("Schikt vrijdag om half zeven 's avonds?", now)).toMatchObject([
      { start: '2026-09-25T16:30:00.000Z', certain: true },
    ]);
  });

  test('"half zeven" alone is read as 18:30 but not certain', () => {
    expect(parseSlots('Kunt u vrijdag om half zeven?', now)).toMatchObject([
      { start: '2026-09-25T16:30:00.000Z', certain: false },
    ]);
  });

  test('"half zeven" next to other afternoon times is certain', () => {
    const slots = parseSlots('Vrijdag om 17:00 of om half zeven', now);
    expect(slots.map((s) => [s.start, s.certain])).toEqual([
      ['2026-09-25T15:00:00.000Z', true],
      ['2026-09-25T16:30:00.000Z', true],
    ]);
  });

  test('kwart over and kwart voor', () => {
    expect(starts("vrijdag kwart over zes 's avonds")).toEqual(['2026-09-25T16:15:00.000Z']);
    expect(starts("vrijdag kwart voor zeven 's avonds")).toEqual(['2026-09-25T16:45:00.000Z']);
  });

  test('overmorgen, dotted times and "uur"', () => {
    expect(parseSlots('overmorgen om 11.00 uur', now)).toMatchObject([
      { start: '2026-09-25T09:00:00.000Z', certain: true },
    ]);
  });

  test('18u30', () => {
    expect(starts('donderdag 18u30')).toEqual(['2026-09-24T16:30:00.000Z']);
  });

  test('"tussen 17 en 19 uur" is a range', () => {
    expect(parseSlots('Vrijdag tussen 17 en 19 uur', now)).toMatchObject([
      { start: '2026-09-25T15:00:00.000Z', end: '2026-09-25T17:00:00.000Z', certain: true },
    ]);
  });

  test('numeric dates 26-09 and 26/9', () => {
    expect(starts('26-09 om 10:00')).toEqual(['2026-09-26T08:00:00.000Z']);
    expect(starts('op 26/9 10:00')).toEqual(['2026-09-26T08:00:00.000Z']);
    expect(starts('za 26.09.2026 om 10:00')).toEqual(['2026-09-26T08:00:00.000Z']);
  });

  test('several times on several days', () => {
    const text = 'Mogelijke tijden:\n- donderdag 18:00 of 18:30\n- vrijdag 19:00';
    expect(starts(text)).toEqual([
      '2026-09-24T16:00:00.000Z',
      '2026-09-24T16:30:00.000Z',
      '2026-09-25T17:00:00.000Z',
    ]);
  });

  test('times listed on the lines after the day', () => {
    expect(starts('Bezichtiging op zaterdag 26 september:\n10:00\n10:30')).toEqual([
      '2026-09-26T08:00:00.000Z',
      '2026-09-26T08:30:00.000Z',
    ]);
  });

  test('vanavond om 8 uur is 20:00', () => {
    expect(parseSlots('Kunt u vanavond om 8 uur?', now)).toMatchObject([
      { start: '2026-09-23T18:00:00.000Z', certain: true },
    ]);
  });

  test('volgende week donderdag', () => {
    expect(starts('volgende week donderdag om 15:00')).toEqual(['2026-10-01T13:00:00.000Z']);
    expect(starts('donderdag om 15:00')).toEqual(['2026-09-24T13:00:00.000Z']);
  });

  test('a weekday that is today and already past means next week', () => {
    expect(starts('woensdag om 10:00')).toEqual(['2026-09-30T08:00:00.000Z']);
  });

  test('a whole landlord email', () => {
    const mail =
      'Beste Sam,\n\nJe bent welkom voor een bezichtiging op donderdag 1 oktober om 18:30. Laat je weten of dit uitkomt?\n\nMet vriendelijke groet,\nJan';
    expect(parseSlots(mail, now)).toEqual([
      { start: '2026-10-01T16:30:00.000Z', text: 'donderdag 1 oktober om 18:30', certain: true },
    ]);
  });

  test('"6:30" without a leading zero is read as the evening but not certain', () => {
    expect(parseSlots('vrijdag 6:30', now)).toMatchObject([
      { start: '2026-09-25T16:30:00.000Z', certain: false },
    ]);
  });

  test('no false days or times', () => {
    expect(parseSlots('Goedemorgen, de woning is beschikbaar per 1 november.', now)).toEqual([]);
    expect(parseSlots('Huur € 12.50 per m2, bel 06-12345678. Zo snel mogelijk reageren graag.', now)).toEqual(
      [],
    );
    expect(parseSlots('De bezichtiging duurt 1 uur.', now)).toEqual([]);
    expect(parseSlots('Om 10 uur ben ik er.', now)).toEqual([]);
  });

  test('a day range is never certain', () => {
    const slots = parseSlots('ma t/m vr tussen 17:00 en 19:00', now);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => !s.certain)).toBe(true);
  });

  test('past slots are dropped', () => {
    expect(parseSlots('maandag 21 sept om 10:00', now)).toEqual([]);
  });

  test('a non-existent spring time is not certain', () => {
    const [slot] = parseSlots('zondag 28 maart 2027 om 02:30', now);
    expect(slot?.certain).toBe(false);
    expect(slot?.start).toBe('2027-03-28T01:30:00.000Z'); // moved to 03:30 summer time
  });
});

describe('English', () => {
  test('Thursday 24 September at 6:30pm', () => {
    expect(parseSlots('Could you come on Thursday 24 September at 6:30pm?', now)).toMatchObject([
      { start: '2026-09-24T16:30:00.000Z', certain: true },
    ]);
  });

  test('tomorrow at 2pm and the day after tomorrow', () => {
    expect(starts('tomorrow at 2pm')).toEqual(['2026-09-24T12:00:00.000Z']);
    expect(starts('the day after tomorrow at 11:00')).toEqual(['2026-09-25T09:00:00.000Z']);
  });

  test('month first, ordinal suffixes and ranges', () => {
    expect(starts('September 26th at 10:00')).toEqual(['2026-09-26T08:00:00.000Z']);
    expect(parseSlots('Sat 10:00-10:15', now)).toMatchObject([
      { start: '2026-09-26T08:00:00.000Z', end: '2026-09-26T08:15:00.000Z' },
    ]);
    expect(parseSlots('Friday between 5 and 7 pm', now)).toMatchObject([
      { start: '2026-09-25T15:00:00.000Z', end: '2026-09-25T17:00:00.000Z', certain: true },
    ]);
  });

  test('half past six in the evening', () => {
    expect(parseSlots('Friday at half past six in the evening', now)).toMatchObject([
      { start: '2026-09-25T16:30:00.000Z', certain: true },
    ]);
  });

  test('"Can you do Monday at 7?" reads 19:00 without being sure', () => {
    expect(parseSlots('Can you do Monday at 7?', now)).toMatchObject([
      { start: '2026-09-28T17:00:00.000Z', certain: false },
    ]);
  });

  test('a message without dates has no slots', () => {
    expect(parseSlots('Thank you for your interest. We will get back to you.', now)).toEqual([]);
  });
});

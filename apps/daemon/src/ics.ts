import type { Property, Viewing } from '@nlpf/core';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** UTC timestamps as iCalendar basic format: 20260924T163000Z. */
const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Folds lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * The viewings calendar a calendar app subscribes to. Times are written in UTC
 * (the Z form), which every client converts to the reader's zone, and the
 * calendar declares Europe/Amsterdam as its default for clients that show it.
 */
export function renderIcs(viewings: Viewing[], properties: Map<string, Property>, now: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//nl-property-finder//viewings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Viewings (nl-property-finder)',
    'X-WR-TIMEZONE:Europe/Amsterdam',
  ];
  for (const v of viewings) {
    if (v.state === 'cancelled') continue;
    const p = properties.get(v.propertyId);
    const title = p ? `Viewing: ${p.title}` : 'Viewing';
    const where = v.location ?? (p ? [p.address.street && `${p.address.street} ${p.address.houseNumber ?? ''}${p.address.addition ?? ''}`.trim(), p.address.postcode, p.address.city].filter(Boolean).join(', ') : '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${v.id}@nl-property-finder`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(v.startsAt)}`,
      `DTEND:${stamp(v.endsAt)}`,
      fold(`SUMMARY:${esc(title)}`),
      ...(where ? [fold(`LOCATION:${esc(where)}`)] : []),
      fold(`DESCRIPTION:${esc([v.bookedBy === 'agent' ? 'Booked by the agent.' : 'Booked by you.', v.note ?? ''].filter(Boolean).join(' '))}`),
      `STATUS:${v.state === 'booked' ? 'CONFIRMED' : 'TENTATIVE'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

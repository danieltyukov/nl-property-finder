/*
 * Viewings: a week at a glance plus the full list, and the calendar feed
 * address for any calendar app. Times are Amsterdam time.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { Viewing } from '@nlpf/core';
import { useProperty, useViewings } from '../api/hooks';
import { CopyButton } from '../components/state';
import { Button, Card, EmptyState, ErrorNote, Loading, PageHeader, Pill } from '../components/ui';
import { dayKey, dayLabel, dayTime, hm, street } from '../lib/format';
import { apiOrigin, apiToken } from '../env';

const DAY = 86_400_000;

function viewingTone(v: Viewing) {
  return v.state === 'booked' ? 'viewing' : v.state === 'proposed' ? 'needs-you' : 'closed';
}

const STATE_LABEL: Record<Viewing['state'], string> = { booked: 'Booked', proposed: 'Proposed', cancelled: 'Cancelled', done: 'Done' };

export function icsUrl(): string {
  return `${apiOrigin()}/calendar.ics?token=${encodeURIComponent(apiToken())}`;
}

export function ViewingsPage() {
  const viewings = useViewings();
  const [weekOffset, setWeekOffset] = useState(0);
  const start = useMemo(() => {
    const now = Date.now() + weekOffset * 7 * DAY;
    return now;
  }, [weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => start + i * DAY), [start]);
  const all = useMemo(() => [...(viewings.data ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)), [viewings.data]);
  const upcoming = all.filter((v) => Date.parse(v.endsAt) >= Date.now() && v.state !== 'cancelled');
  const past = all.filter((v) => Date.parse(v.endsAt) < Date.now() || v.state === 'cancelled').reverse();

  return (
    <div className="page">
      <PageHeader
        eyebrow="Viewings"
        title={upcoming.length ? `${upcoming.length} ${upcoming.length === 1 ? 'viewing' : 'viewings'} ahead.` : 'No viewings planned.'}
        lede="The agent books times inside your availability and never double-books. Every booking also lands in your calendar feed."
      />
      <Card label="Calendar feed" className="ics-card">
        <p className="ics-row">
          <code className="ics-url">{icsUrl().replace(/token=[^&]+/, 'token=...')}</code>
          <CopyButton text={icsUrl()} label="Copy calendar address" what="Calendar address" />
        </p>
        <p className="field-hint">Subscribe to this address in Google Calendar, Apple Calendar or Outlook. It contains your token, so keep it to yourself.</p>
      </Card>

      {viewings.isLoading ? <Loading label="Loading viewings" /> : null}
      {viewings.error ? <ErrorNote error={viewings.error} /> : null}

      <Card
        label={weekOffset === 0 ? 'This week' : weekOffset > 0 ? `In ${weekOffset} ${weekOffset === 1 ? 'week' : 'weeks'}` : `${-weekOffset} ${weekOffset === -1 ? 'week' : 'weeks'} ago`}
        action={
          <div className="inbox-nav">
            <Button variant="ghost" size="sm" icon="left" onClick={() => setWeekOffset((w) => w - 1)} aria-label="Previous week" />
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>
              Today
            </Button>
            <Button variant="ghost" size="sm" icon="right" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week" />
          </div>
        }
      >
        <ol className="week">
          {days.map((d) => {
            const key = dayKey(d);
            const items = all.filter((v) => dayKey(v.startsAt) === key && v.state !== 'cancelled');
            const today = key === dayKey(Date.now());
            return (
              <li key={key} className={`week-day${today ? ' today' : ''}`}>
                <p className="week-label">{dayLabel(d)}</p>
                <ul className="week-items">
                  {items.map((v) => (
                    <WeekItem key={v.id} viewing={v} />
                  ))}
                  {items.length === 0 ? <li className="week-free">Free</li> : null}
                </ul>
              </li>
            );
          })}
        </ol>
      </Card>

      {all.length === 0 && viewings.data ? (
        <EmptyState title="No viewings yet.">
          <p>When a landlord proposes times, the agent books the first one that fits your availability and it shows up here.</p>
        </EmptyState>
      ) : null}
      {upcoming.length ? (
        <Card label="Upcoming" count={upcoming.length}>
          <ul className="viewing-list">
            {upcoming.map((v) => (
              <ViewingRow key={v.id} viewing={v} />
            ))}
          </ul>
        </Card>
      ) : null}
      {past.length ? (
        <Card label="Past and cancelled" count={past.length}>
          <ul className="viewing-list">
            {past.map((v) => (
              <ViewingRow key={v.id} viewing={v} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function WeekItem({ viewing }: { viewing: Viewing }) {
  const property = useProperty(viewing.propertyId);
  return (
    <li className={`week-item ${viewingTone(viewing)}`}>
      <span className="mono">
        {hm(viewing.startsAt)}-{hm(viewing.endsAt)}
      </span>
      <Link href={`/properties/${viewing.propertyId}`}>{property.data ? street(property.data.property.address, property.data.property.title) : viewing.location}</Link>
      {viewing.state === 'proposed' ? <span className="week-flag">proposed</span> : null}
    </li>
  );
}

function ViewingRow({ viewing }: { viewing: Viewing }) {
  const property = useProperty(viewing.propertyId);
  const title = property.data ? street(property.data.property.address, property.data.property.title) : (viewing.location ?? 'Viewing');
  return (
    <li className="viewing-row">
      <span className="viewing-when mono">
        {dayTime(viewing.startsAt)}-{hm(viewing.endsAt)}
      </span>
      <Pill tone={viewingTone(viewing)}>{STATE_LABEL[viewing.state]}</Pill>
      <span className="viewing-where">
        <Link href={`/properties/${viewing.propertyId}`}>{title}</Link>
        <span className="cell-sub">
          {viewing.location}
          {` · booked by ${viewing.bookedBy === 'agent' ? 'the agent' : 'you'}`}
        </span>
        {viewing.note ? <span className="cell-sub">{viewing.note}</span> : null}
      </span>
    </li>
  );
}

/*
 * Activity: everything the agent did without asking, filterable, with the
 * reasoning behind each message it wrote. Live events join at the top.
 */
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'wouter';
import type { NlpfEvent } from '@nlpf/core';
import { useActivity } from '../api/hooks';
import { useEventStream } from '../api/sse';
import { mergeEvents } from '../components/LiveFeed';
import { Card, EmptyState, ErrorNote, Loading, PageHeader, StatusPill } from '../components/ui';
import { clock, dayKey, dayLabel } from '../lib/format';
import { eventStatus } from '../lib/labels';

const GROUPS: { id: string; label: string; match: (type: string) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'listings', label: 'Listings', match: (t) => t.startsWith('listing.') || t.startsWith('property.') },
  { id: 'messages', label: 'Messages', match: (t) => t.startsWith('message.') || t === 'followup.sent' || t === 'applications.withdrawn' },
  { id: 'tasks', label: 'Inbox', match: (t) => t.startsWith('task.') || t === 'action.received' },
  { id: 'viewings', label: 'Viewings', match: (t) => t.startsWith('viewing.') },
  { id: 'sources', label: 'Sources', match: (t) => t.startsWith('source.') || t === 'mail.status' },
  { id: 'system', label: 'System', match: (t) => t.startsWith('automation.') || t === 'config.updated' || t === 'daemon.started' || t === 'application.updated' },
];

export function ActivityPage() {
  const activity = useActivity({ limit: 300 });
  const { events: live } = useEventStream();
  const [group, setGroup] = useState('all');
  const [q, setQ] = useState('');
  const [showChecks, setShowChecks] = useState(false);

  const rows = useMemo(() => {
    const g = GROUPS.find((x) => x.id === group) ?? GROUPS[0]!;
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return mergeEvents(live, activity.data ?? [])
      .filter((e) => showChecks || e.type !== 'source.polled')
      .filter((e) => g.match(e.type))
      .filter((e) => words.every((w) => `${e.summary} ${e.type}`.toLowerCase().includes(w)));
  }, [activity.data, live, group, q, showChecks]);

  return (
    <div className="page">
      <PageHeader eyebrow="Activity" title="What the agent did on its own." lede="Every check, match, message and booking, newest first. Messages the agent wrote show its reasoning." />
      <div className="toolbar">
        <div className="filter-chips" role="group" aria-label="Filter the log">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" className="filter-chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={showChecks} onChange={(e) => setShowChecks(e.currentTarget.checked)} />
          <span>Show every check</span>
        </label>
        <label className="search-field">
          <span className="sr-only">Search the log</span>
          <input className="input" type="search" placeholder="Search the log" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        </label>
      </div>
      {activity.isLoading ? <Loading label="Loading activity" /> : null}
      {activity.error ? <ErrorNote error={activity.error} /> : null}
      {activity.data && rows.length === 0 ? (
        <EmptyState title="Nothing here yet.">
          <p>{group === 'all' && !q ? 'The log fills as the agent checks sources and handles messages.' : 'No event matches this filter.'}</p>
        </EmptyState>
      ) : null}
      {rows.length ? (
        <Card className="log-card">
          <ol className="log">
            {rows.map((e, i) => {
              const previous = rows[i - 1];
              const newDay = !previous || dayKey(previous.at) !== dayKey(e.at);
              return (
                <Fragment key={e.id}>
                  {newDay ? (
                    <li className="log-day" aria-hidden={i === 0 ? undefined : 'true'}>
                      <span>{dayLabel(e.at)}</span>
                    </li>
                  ) : null}
                  <LogRow event={e} />
                </Fragment>
              );
            })}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}

function LogRow({ event }: { event: NlpfEvent }) {
  const rationale = typeof event.data?.rationale === 'string' ? event.data.rationale : undefined;
  const propertyId = typeof event.data?.propertyId === 'string' ? event.data.propertyId : undefined;
  const conversationId = typeof event.data?.conversationId === 'string' ? event.data.conversationId : undefined;
  return (
    <li className="log-row">
      <time className="feed-time" dateTime={event.at}>
        {clock(event.at)}
      </time>
      <StatusPill status={eventStatus(event)} />
      <div className="log-text">
        <p>{propertyId ? <Link href={`/properties/${propertyId}`} className="log-link">{event.summary}</Link> : event.summary}</p>
        {rationale ? (
          <details className="rationale">
            <summary>Why the agent wrote this</summary>
            <p>{rationale}</p>
          </details>
        ) : null}
        {conversationId ? (
          <p className="log-links">
            <Link href={`/conversations/${conversationId}`}>Open the conversation</Link>
          </p>
        ) : null}
      </div>
    </li>
  );
}

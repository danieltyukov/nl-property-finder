/*
 * The live feed: what the agent is doing, newest first, fed by the event
 * stream on top of the last hundred events from /activity.
 *
 * New rows slide in at the top. If the person has scrolled down to read,
 * the list holds still and a "Jump to latest" pill counts what arrived. The
 * feed is deliberately not a live region: screen readers hear inbox items,
 * not every check.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { NlpfEvent } from '@nlpf/core';
import { useActivity, useStatus } from '../api/hooks';
import { useEventStream } from '../api/sse';
import { clock, dayKey, dayLabel } from '../lib/format';
import { eventStatus, FEED_FILTERS, isQuietEvent, matchesFeedFilter, type FeedFilter } from '../lib/labels';
import { Icon } from './Icon';
import { StatusPill } from './ui';

export function mergeEvents(...lists: NlpfEvent[][]): NlpfEvent[] {
  const byId = new Map<number, NlpfEvent>();
  for (const list of lists) for (const event of list) if (event && !byId.has(event.id)) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => b.id - a.id || Date.parse(b.at) - Date.parse(a.at));
}

export function LiveFeed({ className, limit = 150 }: { className?: string; limit?: number }) {
  const activity = useActivity({ limit: 100 });
  const { events: live, state } = useEventStream();
  const status = useStatus();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [holdAt, setHoldAt] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const mountedAt = useRef(Date.now());

  const all = useMemo(
    () => mergeEvents(live, activity.data ?? []).filter((e) => !isQuietEvent(e.type) && matchesFeedFilter(e, filter)).slice(0, limit),
    [live, activity.data, filter, limit],
  );
  const shown = holdAt === null ? all : all.filter((e) => e.id <= holdAt);
  const waiting = holdAt === null ? 0 : all.length - shown.length;
  const liveIds = useMemo(() => new Set(live.filter((e) => Date.parse(e.at) >= mountedAt.current - 2000).map((e) => e.id)), [live]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      if (list.scrollTop > 24) setHoldAt((current) => current ?? all[0]?.id ?? null);
      else setHoldAt(null);
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, [all]);

  const paused = Boolean(status.data?.paused);
  const connected = state === 'open';

  return (
    <section className={`card feed${className ? ` ${className}` : ''}`} aria-labelledby="feed-title">
      <header className="card-head">
        <h2 className="label" id="feed-title">
          Live feed
        </h2>
        <span className="feed-state">
          <span className={`dot ${paused || !connected ? 'closed' : 'live'}${!paused && connected ? ' pulse' : ''}`} aria-hidden="true" />
          {paused ? 'Paused' : connected ? 'Live' : 'Reconnecting'}
        </span>
      </header>
      <div className="feed-filters" role="group" aria-label="Filter the feed">
        {FEED_FILTERS.map((f) => (
          <button key={f.id} type="button" className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {waiting > 0 ? (
        <button
          type="button"
          className="jump-latest"
          onClick={() => {
            setHoldAt(null);
            listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <Icon name="up" size={14} />
          Jump to latest ({waiting} new)
        </button>
      ) : null}
      {shown.length === 0 ? (
        <p className="feed-empty">
          {activity.isLoading ? 'Loading the feed.' : filter === 'all' ? 'Nothing yet. Checks and matches show up here as they happen.' : 'Nothing of this kind yet.'}
        </p>
      ) : (
        <ol className="feed-list" ref={listRef} tabIndex={0} aria-label="Agent events, newest first">
          {shown.map((event, i) => {
            const previous = shown[i - 1];
            const newDay = !previous || dayKey(previous.at) !== dayKey(event.at);
            return (
              <Fragment key={event.id}>
                {newDay && i > 0 ? (
                  <li className="feed-day" aria-hidden="true">
                    <span>{dayLabel(event.at)}</span>
                  </li>
                ) : null}
                <FeedRow event={event} fresh={liveIds.has(event.id)} />
              </Fragment>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function FeedRow({ event, fresh }: { event: NlpfEvent; fresh?: boolean }) {
  const propertyId = typeof event.data?.propertyId === 'string' ? event.data.propertyId : undefined;
  return (
    <li className={`feed-row${fresh ? ' fresh' : ''}`} data-type={event.type}>
      <time className="feed-time" dateTime={event.at}>
        {clock(event.at)}
      </time>
      <StatusPill status={eventStatus(event)} />
      <span className="feed-text">{propertyId ? <Link href={`/properties/${propertyId}`}>{event.summary}</Link> : event.summary}</span>
    </li>
  );
}

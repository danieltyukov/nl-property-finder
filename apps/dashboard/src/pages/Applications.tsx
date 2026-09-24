/*
 * The Applications board: every pursuit by status, with how fast the agent
 * reacted, how it made contact, the last message and the next follow-up.
 * "I found a place" lives here too.
 */
import { Link } from 'wouter';
import type { ApplicationStatus } from '@nlpf/core';
import { useApplications } from '../api/hooks';
import type { ApplicationView } from '../api/views';
import { useNow, useUi } from '../components/state';
import { Button, EmptyState, ErrorNote, Loading, PageHeader, StatusPill } from '../components/ui';
import { ago, dayTime, duration, eur, place, street } from '../lib/format';
import { APPLICATION_STATUS, CHANNEL, sourceName } from '../lib/labels';
import { isOpen } from '../components/FoundPlace';

const COLUMNS: { id: string; label: string; statuses: ApplicationStatus[] }[] = [
  { id: 'sent', label: 'Sent', statuses: ['queued', 'contacted'] },
  { id: 'replied', label: 'Replied', statuses: ['replied', 'manual'] },
  { id: 'viewing', label: 'Viewing', statuses: ['viewing_proposed', 'viewing_booked', 'viewed'] },
  { id: 'offer', label: 'Offer', statuses: ['offer'] },
  { id: 'closed', label: 'Closed', statuses: ['rejected', 'withdrawn', 'gone', 'skipped'] },
];

export function ApplicationsPage() {
  const applications = useApplications();
  const ui = useUi();
  const now = useNow(30_000);
  const all = applications.data ?? [];
  const open = all.filter(isOpen).length;

  return (
    <div className="page page-wide">
      <PageHeader
        eyebrow="Applications"
        title="Everything the agent is pursuing."
        lede={
          all.length
            ? `${open} open ${open === 1 ? 'application' : 'applications'}. When you have a place, withdraw the rest in one go.`
            : undefined
        }
        actions={
          <Button variant="primary" icon="check" onClick={() => ui.setFoundOpen(true)}>
            I found a place
          </Button>
        }
      />
      {applications.isLoading ? <Loading label="Loading applications" /> : null}
      {applications.error ? <ErrorNote error={applications.error} /> : null}
      {applications.data && all.length === 0 ? (
        <EmptyState title="No applications yet.">
          <p>The first one appears as soon as the agent contacts a landlord for a listing that matches your search.</p>
        </EmptyState>
      ) : null}
      {all.length ? (
        <div className="board" role="list" aria-label="Applications by status">
          {COLUMNS.map((column) => {
            const cards = all
              .filter((a) => column.statuses.includes(a.application.status))
              .sort((a, b) => Date.parse(b.application.updatedAt) - Date.parse(a.application.updatedAt));
            return (
              <section key={column.id} className="board-col" role="listitem" aria-labelledby={`col-${column.id}`}>
                <header className="board-col-head">
                  <h2 className="label" id={`col-${column.id}`}>
                    {column.label}
                  </h2>
                  <span className="card-count">{cards.length}</span>
                </header>
                <ul className="board-cards">
                  {cards.length === 0 ? <li className="board-empty">None</li> : null}
                  {cards.map((view) => (
                    <BoardCard key={view.application.id} view={view} now={now} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function BoardCard({ view, now }: { view: ApplicationView; now: number }) {
  const { application, property, lastMessage, nextFollowUpAt } = view;
  const status = APPLICATION_STATUS[application.status];
  const channel = application.channel;
  const who = lastMessage ? (lastMessage.direction === 'in' ? 'Landlord' : lastMessage.author === 'human' ? 'You' : 'Agent') : null;
  return (
    <li className="board-card">
      <div className="board-card-top">
        <StatusPill status={status} />
        {property?.priceEur ? <span className="mono">{eur(property.priceEur)}</span> : null}
      </div>
      <h3 className="board-title">
        <Link href={`/properties/${application.propertyId}`}>{street(property?.address, property?.title ?? 'Unknown address')}</Link>
      </h3>
      <p className="cell-sub">{place(property?.address)}</p>
      <dl className="board-facts">
        {application.reactionMs ? (
          <div>
            <dt>Reaction</dt>
            <dd className="mono">{duration(application.reactionMs)}</dd>
          </div>
        ) : null}
        {channel ? (
          <div>
            <dt>Channel</dt>
            <dd>
              {CHANNEL[channel.kind] ?? channel.kind}
              {channel.sourceId ? ` · ${sourceName(channel.sourceId)}` : ''}
            </dd>
          </div>
        ) : null}
        {nextFollowUpAt ? (
          <div>
            <dt>Follow-up</dt>
            <dd>{dayTime(nextFollowUpAt)} if no reply</dd>
          </div>
        ) : null}
      </dl>
      {lastMessage ? (
        <p className="board-last">
          <span className="board-last-who">
            {who} · {ago(lastMessage.at, now)}
          </span>
          <span className="board-last-body">{lastMessage.body.replace(/\s+/g, ' ').slice(0, 140)}</span>
        </p>
      ) : null}
      {view.conversationId ? (
        <Link className="board-link" href={`/conversations/${view.conversationId}`}>
          Open conversation
        </Link>
      ) : null}
    </li>
  );
}

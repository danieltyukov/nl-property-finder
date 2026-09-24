/*
 * The property drawer: facts, why it matched (or did not), requirements the
 * agent read out of the text, scam signals, the rent estimate, every listing
 * of this home across sites, viewings, and the conversation.
 */
import { Link } from 'wouter';
import type { Message, PropertyView, Requirements } from '@nlpf/core';
import { useConversation, useProperty, usePropertyMutations } from '../api/hooks';
import { Drawer } from '../components/Dialog';
import { useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { rentCheckInputs } from '../components/RentCheck';
import { Button, ErrorNote, Loading, Pill, StatusPill, Tag } from '../components/ui';
import { ago, dayTime, eur, fullAddress, hm, m2, place, street, ymd } from '../lib/format';
import { FURNISHING, INTENT, PROPERTY_TYPE, propertyStatus, sourceName } from '../lib/labels';
import { lastAction } from '../lib/property';

function requirementLines(r: Requirements): string[] {
  const lines: string[] = [];
  if (r.incomeMultiple) lines.push(`Income at least ${r.incomeMultiple}x the rent`);
  if (r.minIncomeEur) lines.push(`Minimum income ${eur(r.minIncomeEur)}`);
  if (r.registrationAllowed === false) lines.push('Registering at the address is not allowed');
  if (r.registrationAllowed === true) lines.push('Registering at the address is allowed');
  if (r.studentsAllowed === false) lines.push('No students');
  if (r.sharingAllowed === false) lines.push('No sharing');
  if (r.contract && r.contract !== 'unknown') lines.push(r.contract === 'indefinite' ? 'Indefinite contract' : 'Temporary contract');
  if (r.minMonths) lines.push(`At least ${r.minMonths} months`);
  if (r.maxMonths) lines.push(`At most ${r.maxMonths} months`);
  if (r.petsAllowed === false) lines.push('No pets');
  if (r.smokingAllowed === false) lines.push('No smoking');
  if (r.guarantorAccepted === true) lines.push('A guarantor is accepted');
  if (r.genderRestriction) lines.push(`Only ${r.genderRestriction === 'female' ? 'women' : 'men'}`);
  if (r.ageMin || r.ageMax) lines.push(`Age ${r.ageMin ?? ''}${r.ageMin && r.ageMax ? ' to ' : ''}${r.ageMax ?? ''}`.trim());
  for (const note of r.notes ?? []) lines.push(note);
  return lines;
}

export function PropertyDrawer({ id, onClose }: { id?: string; onClose: () => void }) {
  const property = useProperty(id);
  return (
    <Drawer open={Boolean(id)} onClose={onClose} label="Property details">
      {property.isLoading ? <Loading label="Loading the property" /> : null}
      {property.error ? <ErrorNote error={property.error} /> : null}
      {property.data ? <DrawerBody view={property.data} /> : null}
    </Drawer>
  );
}

function DrawerBody({ view }: { view: PropertyView }) {
  const { property, listings, match, application, viewings } = view;
  const conversation = useConversation(view.conversationIds[0]);
  const mutations = usePropertyMutations();
  const { toast } = useFeedback();
  const status = propertyStatus(view);
  const listing = listings[0];
  const requirements = match ? requirementLines(match.requirements) : [];
  const canContact = !application || ['skipped', 'manual', 'gone'].includes(application.status);

  const facts: [string, string][] = [
    ['Rent', `${eur(property.priceEur)}${listing?.priceBasis === 'incl' ? ' incl.' : listing?.priceBasis === 'excl' ? ' excl.' : ''}`],
    ['Service costs', eur(listing?.serviceCostsEur)],
    ['Size', m2(property.sizeM2)],
    ['Rooms', listing?.rooms ? String(listing.rooms) : ''],
    ['Type', PROPERTY_TYPE[property.type ?? ''] ?? ''],
    ['Furnishing', FURNISHING[listing?.furnishing ?? ''] ?? ''],
    ['Available from', ymd(listing?.availableFrom)],
    ['Energy label', listing?.energyLabel ?? ''],
    ['Deposit', eur(listing?.depositEur)],
    ['Postcode', property.address.postcode ?? ''],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div className="drawer-body">
      <header className="drawer-head">
        <StatusPill status={status} />
        <h2 className="drawer-title">{street(property.address, property.title)}</h2>
        <p className="drawer-sub">{[place(property.address), property.address.neighbourhood].filter(Boolean).join(' · ')}</p>
        <p className="drawer-action-line">{lastAction(view)}</p>
      </header>

      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="label">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className="drawer-actions">
        {canContact ? (
          <Button
            variant="primary"
            disabled={mutations.contact.isPending}
            onClick={() =>
              mutations.contact.mutate(property.id, {
                onSuccess: () => toast(`Contacting ${street(property.address, property.title)} now.`),
                onError: (e) => toast(`Could not contact: ${e.message}`, 'error'),
              })
            }
          >
            Contact now
          </Button>
        ) : null}
        {!application || application.status === 'queued' ? (
          <Button
            onClick={() =>
              mutations.skip.mutate(property.id, {
                onSuccess: () => toast(`Skipped ${street(property.address, property.title)}. It will not be contacted.`),
                onError: (e) => toast(`Could not skip: ${e.message}`, 'error'),
              })
            }
          >
            Skip
          </Button>
        ) : null}
        {view.conversationIds[0] ? (
          <Link className="btn btn-secondary btn-md" href={`/conversations/${view.conversationIds[0]}`}>
            <Icon name="message" size={14} />
            <span className="btn-label">Open conversation</span>
          </Link>
        ) : null}
      </div>

      {match ? (
        <section className="drawer-section" aria-labelledby="why">
          <h3 className="label" id="why">
            {match.passed ? `Why it matched · score ${match.score}` : 'Why it was skipped'}
          </h3>
          {match.summary ? <p className="summary">{match.summary}</p> : null}
          {!match.passed && match.failedRule ? <p className="mono">{match.failedRule}</p> : null}
          {match.reasons.length ? (
            <p className="chips">
              {match.reasons.map((r) => (
                <Tag key={r}>{r}</Tag>
              ))}
            </p>
          ) : null}
          {requirements.length ? (
            <>
              <h4 className="label sub">Requirements read from the listing</h4>
              <ul className="plain-list">
                {requirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="field-hint">Evaluated {ago(match.evaluatedAt)} by {match.by === 'ai' ? 'Claude' : 'the built-in rules'}.</p>
        </section>
      ) : null}

      {match && match.scam.level !== 'none' ? (
        <section className="drawer-section scam" aria-labelledby="scam">
          <h3 className="label" id="scam">
            {match.scam.level === 'likely' ? 'Likely scam, never contacted' : 'Possible scam'}
          </h3>
          <p className="chips">
            {match.scam.signals.map((s) => (
              <Pill key={s} tone="error">
                {s.replace(/_/g, ' ')}
              </Pill>
            ))}
          </p>
        </section>
      ) : null}

      {match?.rentCheck ? (
        <section className="drawer-section" aria-labelledby="rent">
          <h3 className="label" id="rent">
            Legal rent estimate
          </h3>
          <p>
            {match.rentCheck.aboveMaxPct !== undefined && match.rentCheck.aboveMaxPct > 0
              ? `The asking rent is about ${Math.round(match.rentCheck.aboveMaxPct)}% above the estimated maximum of ${eur(match.rentCheck.maxRentEur)}.`
              : `The asking rent is within the estimated maximum of ${eur(match.rentCheck.maxRentEur)}.`}
          </p>
          <p className="field-hint">{rentCheckInputs(match.rentCheck)}</p>
        </section>
      ) : null}

      <section className="drawer-section" aria-labelledby="listings">
        <h3 className="label" id="listings">
          {listings.length === 1 ? 'Listed on 1 site' : `Listed on ${listings.length} sites`}
        </h3>
        <ul className="listing-list">
          {listings.map((l) => {
            const responses = typeof l.extra?.responses === 'number' ? l.extra.responses : undefined;
            return (
              <li key={l.id} className="listing-row">
                <Tag>{sourceName(l.sourceId)}</Tag>
                <span className="listing-title">{l.title}</span>
                <span className="listing-meta mono">
                  {eur(l.priceEur)} · seen {ago(l.firstSeenAt)}
                  {responses !== undefined ? ` · ${responses} responses so far` : ''}
                  {l.state === 'gone' ? ' · offline' : ''}
                </span>
                <a href={l.url} target="_blank" rel="noreferrer" className="listing-link">
                  Open on {sourceName(l.sourceId)}
                  <Icon name="external" size={12} />
                </a>
              </li>
            );
          })}
        </ul>
        {listing?.description ? (
          <details className="disclosure">
            <summary>Listing text</summary>
            <p className="listing-text" lang={listing.language ?? 'nl'}>
              {listing.description}
            </p>
          </details>
        ) : null}
        {listing?.agent?.name ? (
          <p className="field-hint">
            Offered by {listing.agent.name}
            {listing.agent.phone ? ` · ${listing.agent.phone}` : ''}
          </p>
        ) : null}
      </section>

      {viewings.length ? (
        <section className="drawer-section" aria-labelledby="viewings">
          <h3 className="label" id="viewings">
            Viewings
          </h3>
          <ul className="plain-list">
            {viewings.map((v) => (
              <li key={v.id}>
                <span className="mono">
                  {dayTime(v.startsAt)}-{hm(v.endsAt)}
                </span>{' '}
                {v.state === 'booked' ? 'booked' : v.state} by {v.bookedBy === 'agent' ? 'the agent' : 'you'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {conversation.data ? (
        <section className="drawer-section" aria-labelledby="thread">
          <h3 className="label" id="thread">
            Conversation with {conversation.data.conversation.counterpart.name ?? conversation.data.conversation.counterpart.email ?? 'the landlord'}
          </h3>
          <Thread messages={conversation.data.messages} compact />
        </section>
      ) : null}
      <p className="field-hint drawer-foot">{fullAddress(property.address, property.title)}</p>
    </div>
  );
}

export function Thread({ messages, compact }: { messages: Message[]; compact?: boolean }) {
  const sorted = [...messages].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return (
    <ol className={`thread${compact ? ' compact' : ''}`}>
      {sorted.map((m) => (
        <li key={m.id} className={`bubble ${m.direction === 'in' ? 'in' : 'out'}${m.status === 'failed' ? ' failed' : ''}`}>
          <p className="bubble-meta">
            <span className="bubble-who">{m.author === 'agent' ? 'Agent' : m.author === 'human' ? 'You' : m.author === 'system' ? 'System' : 'Landlord'}</span>
            <time dateTime={m.at}>{dayTime(m.at)}</time>
            {m.intent ? <span className="bubble-intent">{INTENT[m.intent]}</span> : null}
            {m.status === 'draft' || m.status === 'queued' || m.status === 'failed' ? <span className="bubble-intent">{m.status}</span> : null}
          </p>
          {m.subject ? <p className="bubble-subject">{m.subject}</p> : null}
          <p className="bubble-body">{m.body}</p>
          {m.attachments?.length ? (
            <ul className="attachments">
              {m.attachments.map((a) => (
                <li key={a.filename}>
                  <Icon name="file" size={12} /> {a.filename}
                </li>
              ))}
            </ul>
          ) : null}
          {m.rationale ? (
            <details className="rationale">
              <summary>Why the agent wrote this</summary>
              <p>{m.rationale}</p>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

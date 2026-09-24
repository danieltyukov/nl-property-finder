/*
 * Properties: every home the agent has seen, one row per property even when
 * it is listed on several sites. Table or map; a row opens the drawer with the
 * cluster, the match, the rent check and the conversation.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import type { PropertyView } from '@nlpf/core';
import { useProperties, useSources } from '../api/hooks';
import { RentCheckBadge } from '../components/RentCheck';
import { useNow } from '../components/state';
import { Button, Card, EmptyState, ErrorNote, Loading, PageHeader, StatusPill, Tag } from '../components/ui';
import { ago, eur, m2, place, street } from '../lib/format';
import { propertyStatus, sourceName, type Tone } from '../lib/labels';
import { firstSeen, lastAction } from '../lib/property';
import { PropertyDrawer } from './PropertyDrawer';

const RegionMap = lazy(() => import('../components/RegionMap'));

type Filter = 'all' | 'matched' | 'sent' | 'replied' | 'viewing' | 'skipped' | 'scam';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'matched', label: 'Matched' },
  { id: 'sent', label: 'Sent' },
  { id: 'replied', label: 'Replied' },
  { id: 'viewing', label: 'Viewing' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'scam', label: 'Scam' },
];

function matchesFilter(view: PropertyView, filter: Filter): boolean {
  const status = view.application?.status;
  switch (filter) {
    case 'all':
      return true;
    case 'matched':
      return Boolean(view.match?.passed) && view.match?.scam.level !== 'likely';
    case 'sent':
      return status === 'contacted' || status === 'queued';
    case 'replied':
      return status === 'replied' || status === 'offer' || status === 'manual';
    case 'viewing':
      return status === 'viewing_booked' || status === 'viewing_proposed' || status === 'viewed';
    case 'skipped':
      return (!view.match?.passed && view.match?.scam.level !== 'likely') || status === 'skipped' || status === 'rejected' || status === 'gone' || status === 'withdrawn';
    case 'scam':
      return view.match?.scam.level === 'likely' || view.match?.scam.level === 'possible';
  }
}

export function PropertiesPage() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const properties = useProperties({ limit: 200 });
  const sources = useSources();
  const now = useNow(15_000);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'table' | 'map'>('table');
  const names = useMemo(() => new Map((sources.data ?? []).map((s) => [s.sourceId, s.name])), [sources.data]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (properties.data ?? [])
      .filter((p) => matchesFilter(p, filter))
      .filter((p) => {
        if (!q) return true;
        const a = p.property.address;
        const hay = `${p.property.title} ${a.street ?? ''} ${a.houseNumber ?? ''}${a.addition ?? ''} ${a.postcode ?? ''} ${a.city ?? ''} ${p.listings.map((l) => sourceName(l.sourceId, names)).join(' ')}`.toLowerCase();
        return q.split(/\s+/).every((w) => hay.includes(w));
      })
      .sort((a, b) => Date.parse(firstSeen(b)) - Date.parse(firstSeen(a)));
  }, [properties.data, filter, query, names]);

  const selectedId = params.id;
  const markers = useMemo(
    () =>
      rows
        .filter((p) => p.property.address.lat !== undefined && p.property.address.lon !== undefined)
        .map((p) => ({
          id: p.property.id,
          lat: p.property.address.lat!,
          lon: p.property.address.lon!,
          label: `${street(p.property.address, p.property.title)}, ${eur(p.property.priceEur)}`,
          tone: propertyStatus(p).tone as Tone,
          onClick: () => navigate(`/properties/${p.property.id}`),
        })),
    [rows, navigate],
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Properties"
        title="Every home the agent has seen."
        lede="One row per home. The same flat on three sites is one row, contacted once."
        actions={
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
              Table
            </button>
            <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
              Map
            </button>
          </div>
        }
      />
      <div className="toolbar">
        <div className="filter-chips" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="search-field">
          <span className="sr-only">Search properties</span>
          <input className="input" type="search" placeholder="Street, postcode, city or site" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        </label>
      </div>

      {properties.isLoading ? <Loading label="Loading properties" /> : null}
      {properties.error ? <ErrorNote error={properties.error} /> : null}

      {view === 'map' ? (
        <Card label="Map" count={`${markers.length} placed`}>
          <Suspense fallback={<Loading label="Loading the map" />}>
            <RegionMap label="Map of the properties" markers={markers} height={520} />
          </Suspense>
        </Card>
      ) : properties.data && rows.length === 0 ? (
        <Card>
          <EmptyState title={properties.data.length ? 'No home matches this filter.' : 'No homes yet.'}>
            {properties.data.length ? (
              <Button variant="ghost" onClick={() => { setFilter('all'); setQuery(''); }}>
                Show all
              </Button>
            ) : (
              <p>The agent is checking your sources. New listings appear here within a minute or two of going online.</p>
            )}
          </EmptyState>
        </Card>
      ) : rows.length ? (
        <Card className="table-card" label={`${rows.length} ${rows.length === 1 ? 'home' : 'homes'}`}>
          <div className="table-wrap">
            <table className="table props-table">
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Address</th>
                  <th scope="col" className="num">Rent</th>
                  <th scope="col" className="num">Score</th>
                  <th scope="col">Sources</th>
                  <th scope="col">First seen</th>
                  <th scope="col">Last agent action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const selected = p.property.id === selectedId;
                  return (
                    <tr
                      key={p.property.id}
                      className={selected ? 'selected' : undefined}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a, button, .tip')) return;
                        navigate(`/properties/${p.property.id}`);
                      }}
                    >
                      <td>
                        <StatusPill status={propertyStatus(p)} />
                      </td>
                      <td>
                        <Link href={`/properties/${p.property.id}`} className="row-link">
                          {street(p.property.address, p.property.title)}
                        </Link>
                        <span className="cell-sub">{[place(p.property.address), m2(p.property.sizeM2)].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td className="num">
                        <span className="mono">{eur(p.property.priceEur)}</span>
                        <RentCheckBadge check={p.match?.rentCheck} />
                      </td>
                      <td className="num mono">{p.match?.passed ? p.match.score : ''}</td>
                      <td>
                        <span className="tags">
                          {[...new Set(p.listings.map((l) => l.sourceId))].map((id) => (
                            <Tag key={id}>{sourceName(id, names)}</Tag>
                          ))}
                        </span>
                      </td>
                      <td className="mono nowrap">{ago(firstSeen(p), now)}</td>
                      <td className="cell-action">{lastAction(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <PropertyDrawer id={selectedId} onClose={() => navigate('/properties')} />
    </div>
  );
}

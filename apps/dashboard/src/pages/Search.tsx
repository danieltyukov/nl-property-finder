/*
 * Search: named searches (each with its own areas, rent, size and rules), the
 * map for drawing areas, portal search URLs to import, and the registrations
 * tracker for social-housing portals.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearch } from 'wouter';
import type { NamedSearch, Registration } from '@nlpf/core';
import { useConfig, usePatchConfig, useSources } from '../api/hooks';
import type { ConfigView } from '../api/views';
import { NamedSearchSchema } from '../core';
import { useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { Button, Card, EmptyState, Field, IconButton, Loading, PageHeader, Tag, Toggle } from '../components/ui';
import { eur, ymd } from '../lib/format';
import { FURNISHING, PROPERTY_TYPE } from '../lib/labels';

const RegionMap = lazy(() => import('../components/RegionMap'));

const TYPES = ['room', 'studio', 'apartment', 'house'] as const;
const FURNISH = ['unfurnished', 'upholstered', 'furnished', 'unknown'] as const;
const MODES = ['bike', 'walk', 'transit', 'car'] as const;

export function summarise(s: NamedSearch): string {
  const places = s.regions.map((r) => r.name).join(', ') || 'anywhere';
  const rent = s.priceMaxEur ? `up to ${eur(s.priceMaxEur)}` : 'any rent';
  const size = s.sizeMinM2 ? `${s.sizeMinM2} m² or more` : null;
  const types = s.types.length < 4 ? s.types.map((t) => PROPERTY_TYPE[t]?.toLowerCase()).join(', ') : null;
  return [places, rent, size, types].filter(Boolean).join(' · ');
}

const splitList = (text: string) =>
  text
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function newSearch(existing: NamedSearch[]): NamedSearch {
  let n = existing.length + 1;
  while (existing.some((s) => s.id === `search-${n}`)) n++;
  return NamedSearchSchema.parse({ id: `search-${n}`, name: `Search ${n}` }) as NamedSearch;
}

export function SearchPage() {
  const config = useConfig();
  const search = useSearch();
  if (!config.data) return <div className="page"><Loading label="Loading your searches" /></div>;
  return <SearchEditor config={config.data} startNew={new URLSearchParams(search).has('new')} />;
}

function SearchEditor({ config, startNew }: { config: ConfigView; startNew: boolean }) {
  const patch = usePatchConfig();
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<NamedSearch[]>(() => structuredClone(config.searches));
  const [selected, setSelected] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config.searches);

  useEffect(() => {
    if (startNew) {
      setDraft((d) => {
        const next = [...d, newSearch(d)];
        setSelected(next.length - 1);
        return next;
      });
    }
  }, [startNew]);

  const current = draft[selected];
  const update = (fn: (s: NamedSearch) => NamedSearch) => setDraft((d) => d.map((s, i) => (i === selected ? fn(s) : s)));

  const save = () =>
    patch.mutate(
      { section: 'searches', value: draft },
      { onSuccess: () => toast('Searches saved. The next check uses them.'), onError: (e) => toast(`Not saved: ${e.message}`, 'error') },
    );

  return (
    <div className="page page-wide">
      <PageHeader
        eyebrow="Search"
        title="What the agent looks for."
        lede="Each named search has its own areas and rules. A home that passes any enabled search is a match."
        actions={
          <>
            <Button icon="plus" onClick={() => setDraft((d) => { const next = [...d, newSearch(d)]; setSelected(next.length - 1); return next; })}>
              Add search
            </Button>
            <Button
              icon="copy"
              disabled={!current}
              onClick={() =>
                current &&
                setDraft((d) => {
                  const copy = { ...structuredClone(current), id: newSearch(d).id, name: `${current.name} (copy)` };
                  setSelected(d.length);
                  return [...d, copy];
                })
              }
            >
              Duplicate
            </Button>
          </>
        }
      />
      <div className="search-layout">
        <nav className="search-list" aria-label="Named searches">
          <ul>
            {draft.map((s, i) => (
              <li key={s.id}>
                <button type="button" className={`search-item${i === selected ? ' active' : ''}`} aria-current={i === selected ? 'true' : undefined} onClick={() => setSelected(i)}>
                  <span className="search-item-name">
                    <span className={`dot ${s.enabled ? 'live' : 'closed'}`} aria-hidden="true" />
                    {s.name}
                  </span>
                  <span className="search-item-sum">{summarise(s)}</span>
                  {!s.enabled ? <span className="sr-only">(off)</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {current ? (
          <div className="search-editor">
            <SearchForm key={current.id} search={current} onChange={update} onRemove={draft.length > 1 ? () => { setDraft((d) => d.filter((_, i) => i !== selected)); setSelected(0); } : undefined} />
          </div>
        ) : (
          <EmptyState title="No searches yet." />
        )}
      </div>
      <div className={`savebar${dirty ? ' show' : ''}`} role="region" aria-label="Unsaved changes" hidden={!dirty}>
        <p>You have unsaved changes to your searches.</p>
        <Button variant="ghost" onClick={() => setDraft(structuredClone(config.searches))}>
          Discard
        </Button>
        <Button variant="primary" onClick={save} disabled={patch.isPending}>
          Save searches
        </Button>
      </div>
      <div className="two-col">
        <ImportUrls config={config} />
        <Registrations config={config} />
      </div>
    </div>
  );
}

function SearchForm({ search, onChange, onRemove }: { search: NamedSearch; onChange: (fn: (s: NamedSearch) => NamedSearch) => void; onRemove?: () => void }) {
  const set = <K extends keyof NamedSearch>(key: K, value: NamedSearch[K]) => onChange((s) => ({ ...s, [key]: value }));
  const toggleIn = <T extends string>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const regions = useMemo(() => search.regions.map((r) => ({ name: r.name, polygon: r.polygon })), [search.regions]);

  return (
    <>
      <Card label="Name">
        <div className="form-grid">
          <Field label="Search name">{(id) => <input id={id} className="input" value={search.name} onChange={(e) => set('name', e.currentTarget.value)} />}</Field>
          <Toggle label="This search is on" checked={search.enabled} onChange={(v) => set('enabled', v)} />
        </div>
      </Card>

      <Card label="Areas" count={search.regions.length}>
        <Suspense fallback={<Loading label="Loading the map" />}>
          <RegionMap
            label="Search areas on the map"
            regions={regions}
            draw
            onPolygon={(polygon) =>
              onChange((s) => ({ ...s, regions: [...s.regions, { name: `Drawn area ${s.regions.filter((r) => r.polygon).length + 1}`, municipalities: [], postcodes: [], polygon }] }))
            }
          />
        </Suspense>
        <p className="field-hint">Draw a polygon or a rectangle with the tools on the map; each drawing becomes an area. Or name municipalities and postcode ranges below.</p>
        <div className="region-table" role="table" aria-label="Areas">
          <div className="region-head" role="row">
            <span role="columnheader">Area</span>
            <span role="columnheader">Municipalities</span>
            <span role="columnheader">Postcode ranges</span>
            <span role="columnheader">
              <span className="sr-only">Drawing and remove</span>
            </span>
          </div>
          {search.regions.map((region, i) => (
            <div key={`${i}-${search.regions.length}`} className="region-line" role="row">
              <span role="cell">
                <input
                  className="input"
                  aria-label={`Name of area ${i + 1}`}
                  value={region.name}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    set('regions', search.regions.map((r, j) => (j === i ? { ...r, name: v } : r)));
                  }}
                />
              </span>
              <span role="cell">
                <input
                  className="input"
                  aria-label={`Municipalities in ${region.name}, comma separated`}
                  placeholder="Delft, Rijswijk"
                  defaultValue={region.municipalities.join(', ')}
                  onBlur={(e) => {
                    const v = splitList(e.currentTarget.value);
                    set('regions', search.regions.map((r, j) => (j === i ? { ...r, municipalities: v } : r)));
                  }}
                />
              </span>
              <span role="cell">
                <input
                  className="input mono"
                  aria-label={`Postcode ranges in ${region.name}, for example 2611-2629`}
                  placeholder="2611-2629"
                  defaultValue={region.postcodes.join(', ')}
                  onBlur={(e) => {
                    const v = splitList(e.currentTarget.value).filter((x) => /^\d{4}(-\d{4})?$/.test(x));
                    set('regions', search.regions.map((r, j) => (j === i ? { ...r, postcodes: v } : r)));
                  }}
                />
              </span>
              <span role="cell" className="region-tools">
                {region.polygon?.length ? (
                  <Button size="sm" variant="ghost" title="Remove the drawn outline" onClick={() => set('regions', search.regions.map((r, j) => (j === i ? { ...r, polygon: undefined } : r)))}>
                    Drawn, {region.polygon.length} points
                    <Icon name="close" size={12} />
                  </Button>
                ) : null}
                <IconButton icon="trash" label={`Remove area ${region.name}`} onClick={() => set('regions', search.regions.filter((_, j) => j !== i))} />
              </span>
            </div>
          ))}
        </div>
        <div className="card-foot">
          <Button icon="plus" size="sm" onClick={() => set('regions', [...search.regions, { name: `Area ${search.regions.length + 1}`, municipalities: [], postcodes: [] }])}>
            Add area
          </Button>
        </div>
      </Card>

      <Card label="Rent and size">
        <div className="form-grid three">
          <Field label="Minimum rent (EUR)">
            {(id) => <input id={id} className="input mono" inputMode="numeric" value={search.priceMinEur ?? ''} onChange={(e) => set('priceMinEur', numberOrUndefined(e.currentTarget.value))} />}
          </Field>
          <Field label="Maximum rent (EUR)">
            {(id) => <input id={id} className="input mono" inputMode="numeric" value={search.priceMaxEur ?? ''} onChange={(e) => set('priceMaxEur', numberOrUndefined(e.currentTarget.value))} />}
          </Field>
          <Field label="Minimum size (m²)">
            {(id) => <input id={id} className="input mono" inputMode="numeric" value={search.sizeMinM2 ?? ''} onChange={(e) => set('sizeMinM2', numberOrUndefined(e.currentTarget.value))} />}
          </Field>
          <Field label="Minimum rooms">
            {(id) => <input id={id} className="input mono" inputMode="numeric" value={search.roomsMin ?? ''} onChange={(e) => set('roomsMin', numberOrUndefined(e.currentTarget.value))} />}
          </Field>
          <Field label="Minimum bedrooms">
            {(id) => <input id={id} className="input mono" inputMode="numeric" value={search.bedroomsMin ?? ''} onChange={(e) => set('bedroomsMin', numberOrUndefined(e.currentTarget.value))} />}
          </Field>
          <Field label="Available by">
            {(id) => <input id={id} className="input mono" type="date" value={search.availableBy ?? ''} onChange={(e) => set('availableBy', e.currentTarget.value || undefined)} />}
          </Field>
        </div>
        <Toggle label="Count service costs in the rent" checked={search.priceIncludesServiceCosts} onChange={(v) => set('priceIncludesServiceCosts', v)} hint="A listing at €1,300 plus €120 service costs then counts as €1,420." />
        <Toggle label="Registering at the address must be allowed" checked={search.requireRegistration} onChange={(v) => set('requireRegistration', v)} />
      </Card>

      <Card label="Kind of home">
        <fieldset className="chip-set">
          <legend className="field-label">Types</legend>
          {TYPES.map((t) => (
            <label key={t} className="check-chip">
              <input type="checkbox" checked={search.types.includes(t)} onChange={() => set('types', toggleIn(search.types, t))} />
              <span>{PROPERTY_TYPE[t]}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="chip-set">
          <legend className="field-label">Furnishing</legend>
          {FURNISH.map((f) => (
            <label key={f} className="check-chip">
              <input type="checkbox" checked={search.furnishing.includes(f)} onChange={() => set('furnishing', toggleIn(search.furnishing, f))} />
              <span>{FURNISHING[f]}</span>
            </label>
          ))}
        </fieldset>
      </Card>

      <Card label="Rules">
        <div className="form-grid">
          <Field label="Must mention" hint="Comma separated. A listing without these words is skipped.">
            {(id, hint) => <input id={id} className="input" aria-describedby={hint} defaultValue={search.mustHaves.join(', ')} onBlur={(e) => set('mustHaves', splitList(e.currentTarget.value))} />}
          </Field>
          <Field label="Deal-breakers" hint="Comma separated, for example anti-kraak, alleen vrouwen">
            {(id, hint) => <input id={id} className="input" aria-describedby={hint} defaultValue={search.dealBreakers.join(', ')} onBlur={(e) => set('dealBreakers', splitList(e.currentTarget.value))} />}
          </Field>
          <Field label="Minimum score (0 to 100)">
            {(id) => <input id={id} className="input mono" inputMode="numeric" value={search.minScore} onChange={(e) => set('minScore', numberOrUndefined(e.currentTarget.value) ?? 0)} />}
          </Field>
          <Field label="Skip when rent is this % above the legal estimate" hint="Leave empty to only flag it.">
            {(id, hint) => (
              <input id={id} className="input mono" inputMode="numeric" aria-describedby={hint} value={search.skipAboveLegalMaxPct ?? ''} onChange={(e) => set('skipAboveLegalMaxPct', numberOrUndefined(e.currentTarget.value))} />
            )}
          </Field>
        </div>
      </Card>

      <Card label="Commute">
        {search.commute.length === 0 ? <p className="card-empty">Add the places you travel to, and matches show the minutes to get there.</p> : null}
        <ul className="region-list">
          {search.commute.map((c, i) => (
            <li key={i} className="region-row">
              <div className="form-grid commute">
                <Field label="Place">
                  {(id) => <input id={id} className="input" value={c.name} onChange={(e) => { const v = e.currentTarget.value; set('commute', search.commute.map((x, j) => (j === i ? { ...x, name: v } : x))); }} />}
                </Field>
                <Field label="Latitude">
                  {(id) => <input id={id} className="input mono" value={c.lat} onChange={(e) => { const v = Number(e.currentTarget.value); set('commute', search.commute.map((x, j) => (j === i ? { ...x, lat: v } : x))); }} />}
                </Field>
                <Field label="Longitude">
                  {(id) => <input id={id} className="input mono" value={c.lon} onChange={(e) => { const v = Number(e.currentTarget.value); set('commute', search.commute.map((x, j) => (j === i ? { ...x, lon: v } : x))); }} />}
                </Field>
                <Field label="By">
                  {(id) => (
                    <select id={id} className="input" value={c.mode} onChange={(e) => { const v = e.currentTarget.value as (typeof MODES)[number]; set('commute', search.commute.map((x, j) => (j === i ? { ...x, mode: v } : x))); }}>
                      {MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="At most (min)">
                  {(id) => <input id={id} className="input mono" value={c.maxMinutes ?? ''} onChange={(e) => { const v = numberOrUndefined(e.currentTarget.value); set('commute', search.commute.map((x, j) => (j === i ? { ...x, maxMinutes: v } : x))); }} />}
                </Field>
              </div>
              <div className="region-meta">
                <IconButton icon="trash" label={`Remove ${c.name || 'this place'}`} onClick={() => set('commute', search.commute.filter((_, j) => j !== i))} />
              </div>
            </li>
          ))}
        </ul>
        <div className="card-foot">
          <Button icon="plus" size="sm" onClick={() => set('commute', [...search.commute, { name: '', lat: 52.0116, lon: 4.3571, mode: 'bike' }])}>
            Add a place
          </Button>
        </div>
      </Card>

      {onRemove ? (
        <p className="danger-row">
          <Button variant="danger" icon="trash" onClick={onRemove}>
            Delete this search
          </Button>
        </p>
      ) : null}
    </>
  );
}

function ImportUrls({ config }: { config: ConfigView }) {
  const sources = useSources();
  const patch = usePatchConfig();
  const { toast } = useFeedback();
  const [sourceId, setSourceId] = useState('');
  const [url, setUrl] = useState('');
  const list = sources.data ?? [];
  const imported = Object.entries(config.sources).flatMap(([id, s]) => (s.searchUrls ?? []).map((u) => ({ id, url: u })));

  const save = (next: Record<string, string[]>, done: string) => {
    const value = { ...config.sources };
    for (const [id, urls] of Object.entries(next)) value[id] = { ...(value[id] ?? { enabled: true, searchUrls: [], options: {} }), searchUrls: urls };
    patch.mutate({ section: 'sources', value }, { onSuccess: () => toast(done), onError: (e) => toast(`Not saved: ${e.message}`, 'error') });
  };

  return (
    <Card label="Portal search URLs">
      <p className="card-intro">Paste a search you already set up on a site. The agent checks that exact page as well.</p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const id = sourceId || list[0]?.sourceId;
          if (!id) return;
          try {
            new URL(url);
          } catch {
            toast('That is not a full web address. It should start with https://', 'error');
            return;
          }
          save({ [id]: [...(config.sources[id]?.searchUrls ?? []), url] }, 'Search URL imported.');
          setUrl('');
        }}
      >
        <Field label="Site">
          {(id) => (
            <select id={id} className="input" value={sourceId || list[0]?.sourceId || ''} onChange={(e) => setSourceId(e.currentTarget.value)}>
              {list.map((s) => (
                <option key={s.sourceId} value={s.sourceId}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Search URL">
          {(id) => <input id={id} className="input mono" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.currentTarget.value)} />}
        </Field>
        <div className="form-actions wide">
          <Button type="submit" disabled={!url.trim()}>
            Import
          </Button>
        </div>
      </form>
      {imported.length ? (
        <ul className="url-list">
          {imported.map((item) => (
            <li key={`${item.id}-${item.url}`}>
              <Tag>{list.find((s) => s.sourceId === item.id)?.name ?? item.id}</Tag>
              <span className="mono url-text">{item.url}</span>
              <IconButton
                icon="trash"
                label="Remove this URL"
                onClick={() => save({ [item.id]: (config.sources[item.id]?.searchUrls ?? []).filter((u) => u !== item.url) }, 'Search URL removed.')}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function waited(since: string): string {
  const start = Date.parse(since);
  if (Number.isNaN(start)) return '';
  const months = Math.max(0, Math.floor((Date.now() - start) / (30.44 * 86_400_000)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} ${y === 1 ? 'year' : 'years'}` : null, m ? `${m} ${m === 1 ? 'month' : 'months'}` : null].filter(Boolean).join(' ') || 'under a month';
}

function Registrations({ config }: { config: ConfigView }) {
  const patch = usePatchConfig();
  const { toast } = useFeedback();
  const [form, setForm] = useState<Registration>({ portal: '', since: '' });
  const list = config.registrations;
  const save = (next: Registration[], done: string) =>
    patch.mutate({ section: 'registrations', value: next }, { onSuccess: () => toast(done), onError: (e) => toast(`Not saved: ${e.message}`, 'error') });

  return (
    <Card label="Registrations" count={list.length || undefined}>
      <p className="card-intro">Waiting time on social-housing portals counts from the day you registered. The agent reminds you 30 days before a renewal.</p>
      {list.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Portal</th>
                <th scope="col">Since</th>
                <th scope="col">Waited</th>
                <th scope="col">Renew by</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => {
                const soon = r.renewBy && Date.parse(r.renewBy) - Date.now() < 30 * 86_400_000;
                return (
                  <tr key={`${r.portal}-${i}`}>
                    <th scope="row">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.portal}
                        </a>
                      ) : (
                        r.portal
                      )}
                    </th>
                    <td className="mono nowrap">{ymd(r.since)}</td>
                    <td className="nowrap">{waited(r.since)}</td>
                    <td className={`mono nowrap${soon ? ' warn' : ''}`}>{r.renewBy ? ymd(r.renewBy) : <span className="muted">no renewal</span>}</td>
                    <td>
                      <IconButton icon="trash" label={`Remove ${r.portal}`} onClick={() => save(list.filter((_, j) => j !== i), 'Registration removed.')} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.portal.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.since)) {
            toast('Give the portal a name and the date you registered.', 'error');
            return;
          }
          save([...list, { ...form, portal: form.portal.trim(), renewBy: form.renewBy || undefined, url: form.url || undefined }], 'Registration added.');
          setForm({ portal: '', since: '' });
        }}
      >
        <Field label="Portal">{(id) => <input id={id} className="input" placeholder="WoningNet, ROOM, Woonnet Haaglanden" value={form.portal} onChange={(e) => setForm({ ...form, portal: e.currentTarget.value })} />}</Field>
        <Field label="Registered on">{(id) => <input id={id} className="input mono" type="date" value={form.since} onChange={(e) => setForm({ ...form, since: e.currentTarget.value })} />}</Field>
        <Field label="Renew by">{(id) => <input id={id} className="input mono" type="date" value={form.renewBy ?? ''} onChange={(e) => setForm({ ...form, renewBy: e.currentTarget.value })} />}</Field>
        <Field label="Portal URL">{(id) => <input id={id} className="input mono" type="url" placeholder="https://" value={form.url ?? ''} onChange={(e) => setForm({ ...form, url: e.currentTarget.value })} />}</Field>
        <div className="form-actions wide">
          <Button type="submit" icon="plus">
            Add registration
          </Button>
        </div>
      </form>
      <p className="field-hint">
        <Icon name="clock" size={12} /> Waiting time is what the portals rank on, so it is shown here from the registration date.
      </p>
    </Card>
  );
}

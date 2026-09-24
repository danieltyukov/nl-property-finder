/*
 * Overview: today's numbers, the measured reaction time, source health and
 * the stats that back the speed claim (reaction per source, reply rate per
 * agency, message variants, freshness), next to the live feed.
 */
import { Link } from 'wouter';
import { useSources, useStats, useStatus } from '../api/hooks';
import { LiveFeed } from '../components/LiveFeed';
import { PipelineStrip } from '../components/PipelineStrip';
import { Card, Dot, EmptyState, PageHeader } from '../components/ui';
import { ago, duration, pct } from '../lib/format';
import { SOURCE_HEALTH, sourceName } from '../lib/labels';

export function OverviewPage() {
  const status = useStatus();
  const stats = useStats();
  const sources = useSources();
  const names = new Map((sources.data ?? []).map((s) => [s.sourceId, s.name]));
  const s = stats.data;
  const enabled = (sources.data ?? []).filter((x) => x.enabled);
  const healthy = enabled.filter((x) => x.health === 'ok' || x.health === 'watch_only').length;
  const ranked = (s?.perSource ?? []).filter((r) => r.medianReactionMs != null).sort((a, b) => (a.medianReactionMs ?? 0) - (b.medianReactionMs ?? 0));

  return (
    <div className="page">
      <PageHeader eyebrow="Overview" title="How the search is going." lede="Numbers are measured by the agent on this computer. Reaction time runs from the moment a listing was first seen to the moment the message went out." />
      <PipelineStrip status={status.data} stats={s} />
      <div className="overview-grid">
        <div className="overview-main">
          <div className="kpis">
            <Card label="Median reaction, 7 days">
              <p className="kpi">
                <span className="stat stat-xl">{s?.reactionMsMedian7d != null ? duration(s.reactionMsMedian7d) : 'None yet'}</span>
                <span className="kpi-note">from first seen to message sent</span>
              </p>
              {ranked.length > 1 ? (
                <p className="kpi-foot">
                  Fastest <strong>{sourceName(ranked[0]!.sourceId, names)}</strong> at {duration(ranked[0]!.medianReactionMs)}, slowest{' '}
                  <strong>{sourceName(ranked[ranked.length - 1]!.sourceId, names)}</strong> at {duration(ranked[ranked.length - 1]!.medianReactionMs)}.
                </p>
              ) : null}
            </Card>
            <Card label="Sources" action={<Link href="/sources">All sources</Link>}>
              <p className="kpi">
                <span className="stat stat-xl">
                  {healthy}/{enabled.length}
                </span>
                <span className="kpi-note">working normally</span>
              </p>
              <ul className="health-strip" aria-label="Source health">
                {enabled.map((src) => {
                  const h = SOURCE_HEALTH[src.health];
                  return (
                    <li key={src.sourceId} title={`${src.name}: ${h.label}${src.lastRunAt ? `, checked ${ago(src.lastRunAt)}` : ''}`}>
                      <Dot tone={h.tone} />
                      <span>{src.name}</span>
                      <span className="sr-only">: {h.label}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <Card label="Reaction time per source" className="table-card">
            {s?.perSource.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col" className="num">Seen 7 d</th>
                      <th scope="col" className="num">Matched</th>
                      <th scope="col" className="num">Sent</th>
                      <th scope="col" className="num">Replies</th>
                      <th scope="col" className="num">Median reaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.perSource.map((row) => (
                      <tr key={row.sourceId}>
                        <th scope="row">{sourceName(row.sourceId, names)}</th>
                        <td className="num">{row.seen7d}</td>
                        <td className="num">{row.matched7d}</td>
                        <td className="num">{row.contacted7d}</td>
                        <td className="num">{row.replies7d}</td>
                        <td className="num">{row.medianReactionMs != null ? duration(row.medianReactionMs) : <span className="muted">watch only</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No numbers yet.">The table fills in after the first day of checks.</EmptyState>
            )}
          </Card>

          <div className="stack">
            <Card label="Agencies" className="table-card">
              {s?.perAgency.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Agency</th>
                        <th scope="col" className="num">Reply rate</th>
                        <th scope="col" className="num">Median reply</th>
                        <th scope="col" className="num">Viewings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.perAgency.map((row) => (
                        <tr key={row.agency}>
                          <th scope="row">
                            {row.agency}
                            <span className="cell-sub">{row.contacted} contacted</span>
                          </th>
                          <td className="num">{pct((row.replied / Math.max(row.contacted, 1)) * 100)}</td>
                          <td className="num">{row.medianReplyHours != null ? duration(row.medianReplyHours * 3600_000) : ''}</td>
                          <td className="num">{row.viewings}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="card-empty">Agencies appear once they reply.</p>
              )}
            </Card>
            <Card label="Message variants" className="table-card">
              {s?.perVariant.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Variant</th>
                        <th scope="col" className="num">Sent</th>
                        <th scope="col" className="num">Reply rate</th>
                        <th scope="col" className="num">Viewings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.perVariant.map((row) => (
                        <tr key={row.variant}>
                          <th scope="row" className="mono">
                            {row.variant}
                          </th>
                          <td className="num">{row.sent}</td>
                          <td className="num">{pct((row.replies / Math.max(row.sent, 1)) * 100)}</td>
                          <td className="num">{row.viewings}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="card-empty">
                  Add message variants in <Link href="/automation">Automation</Link> to compare them here.
                </p>
              )}
            </Card>
          </div>

          <Card label="Freshness per source" className="table-card">
            {s?.freshness.length ? (
              <ul className="bars" aria-label="Median time from publication to first seen">
                {s.freshness.map((row) => {
                  const max = Math.max(...s.freshness.map((f) => f.medianDetectMs ?? 0), 1);
                  const width = ((row.medianDetectMs ?? 0) / max) * 100;
                  return (
                    <li key={row.sourceId} className="bar-row">
                      <span className="bar-name">{sourceName(row.sourceId, names)}</span>
                      <span className="bar-track" aria-hidden="true">
                        <span className="bar-fill" style={{ width: `${width}%` }} />
                      </span>
                      <span className="bar-value">{row.medianDetectMs != null ? duration(row.medianDetectMs) : 'unknown'}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="card-empty">Only sources that report a publication time are measured.</p>
            )}
            <p className="field-hint card-foot">Median time from a listing's publication to the agent first seeing it, for sources that report when a listing went online.</p>
          </Card>
        </div>
        <LiveFeed className="overview-feed" />
      </div>
    </div>
  );
}

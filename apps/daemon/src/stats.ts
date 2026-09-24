import type { StatsView } from '@nlpf/core';
import type { Runtime } from './runtime.js';

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

/**
 * Numbers for the Overview: reaction time, what each source and agency is
 * worth, how message variants perform, and how fresh each source's listings
 * are. Everything comes from the agent's own database, over the last 7 days.
 */
export function computeStats(rt: Runtime): StatsView {
  const db = rt.store.raw;
  const now = rt.now();
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const reactions = (db.prepare('SELECT reaction_ms AS r FROM applications WHERE contacted_at >= ? AND reaction_ms IS NOT NULL').all(since) as { r: number }[]).map((x) => x.r);

  const days: StatsView['daily'] = [];
  for (let i = 6; i >= 0; i--) {
    const start = new Date(now.getTime() - i * 86_400_000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    const [a, b] = [start.toISOString(), end.toISOString()];
    const n = (sql: string) => (db.prepare(sql).get(a, b) as { n: number }).n;
    days.push({
      date: a.slice(0, 10),
      seen: n('SELECT count(*) AS n FROM listings WHERE first_seen_at >= ? AND first_seen_at < ?'),
      matched: n('SELECT count(*) AS n FROM matches WHERE passed = 1 AND evaluated_at >= ? AND evaluated_at < ?'),
      contacted: n('SELECT count(*) AS n FROM applications WHERE contacted_at >= ? AND contacted_at < ?'),
      replies: n("SELECT count(*) AS n FROM messages WHERE direction = 'in' AND at >= ? AND at < ?"),
      viewings: n("SELECT count(*) AS n FROM viewings WHERE state != 'cancelled' AND starts_at >= ? AND starts_at < ?"),
    });
  }

  const apps = rt.store.applications.list({ limit: 5000 }).filter((a) => a.contactedAt && a.contactedAt >= since);
  const perSourceMap = new Map<string, { seen7d: number; matched7d: number; contacted7d: number; replies7d: number; reactions: number[] }>();
  const bucket = (id: string) => {
    let b = perSourceMap.get(id);
    if (!b) perSourceMap.set(id, (b = { seen7d: 0, matched7d: 0, contacted7d: 0, replies7d: 0, reactions: [] }));
    return b;
  };
  for (const r of db.prepare('SELECT source_id AS s, count(*) AS n FROM listings WHERE first_seen_at >= ? GROUP BY source_id').all(since) as { s: string; n: number }[]) bucket(r.s).seen7d = r.n;
  for (const r of db.prepare('SELECT l.source_id AS s, count(DISTINCT l.property_id) AS n FROM listings l JOIN matches m ON m.property_id = l.property_id WHERE m.passed = 1 AND m.evaluated_at >= ? GROUP BY l.source_id').all(since) as { s: string; n: number }[]) bucket(r.s).matched7d = r.n;

  const perAgencyMap = new Map<string, { contacted: number; replied: number; replyHours: number[]; viewings: number }>();
  const perVariantMap = new Map<string, { sent: number; replies: number; viewings: number }>();
  for (const app of apps) {
    const src = app.channel?.sourceId ?? 'email';
    const b = bucket(src);
    b.contacted7d += 1;
    if (app.reactionMs !== undefined) b.reactions.push(app.reactionMs);
    const convs = rt.store.conversations.byApplication(app.id);
    const msgs = convs.flatMap((c) => rt.store.messages.list(c.id));
    const firstOut = msgs.find((m) => m.direction === 'out' && m.status === 'sent');
    const firstIn = msgs.find((m) => m.direction === 'in' && (!firstOut || m.at > firstOut.at));
    if (firstIn) b.replies7d += 1;
    const agency = convs[0]?.counterpart.name ?? convs[0]?.counterpart.email?.split('@')[1] ?? rt.store.listings.list({ propertyId: app.propertyId })[0]?.agent?.name ?? 'unknown';
    const ag = perAgencyMap.get(agency) ?? { contacted: 0, replied: 0, replyHours: [], viewings: 0 };
    ag.contacted += 1;
    if (firstIn && firstOut) {
      ag.replied += 1;
      ag.replyHours.push((Date.parse(firstIn.at) - Date.parse(firstOut.at)) / 3_600_000);
    }
    const booked = ['viewing_booked', 'viewed', 'offer'].includes(app.status);
    if (booked) ag.viewings += 1;
    perAgencyMap.set(agency, ag);
    const variant = /variant (\S+)/.exec(firstOut?.rationale ?? '')?.[1] ?? 'default';
    const v = perVariantMap.get(variant) ?? { sent: 0, replies: 0, viewings: 0 };
    v.sent += 1;
    if (firstIn) v.replies += 1;
    if (booked) v.viewings += 1;
    perVariantMap.set(variant, v);
  }

  const freshness = (db.prepare("SELECT source_id AS s, json_extract(data, '$.publishedAt') AS p, first_seen_at AS f FROM listings WHERE first_seen_at >= ? AND json_extract(data, '$.publishedAt') IS NOT NULL").all(since) as { s: string; p: string; f: string }[]);
  const freshBy = new Map<string, number[]>();
  for (const r of freshness) {
    const d = Date.parse(r.f) - Date.parse(r.p);
    if (Number.isFinite(d) && d >= 0 && d < 7 * 86_400_000) freshBy.set(r.s, [...(freshBy.get(r.s) ?? []), d]);
  }

  return {
    reactionMsMedian7d: median(reactions),
    daily: days,
    perSource: [...perSourceMap.entries()].map(([sourceId, b]) => ({
      sourceId, seen7d: b.seen7d, matched7d: b.matched7d, contacted7d: b.contacted7d, replies7d: b.replies7d, medianReactionMs: median(b.reactions),
    })),
    perVariant: [...perVariantMap.entries()].map(([variant, v]) => ({ variant, ...v })),
    perAgency: [...perAgencyMap.entries()]
      .map(([agency, a]) => ({ agency, contacted: a.contacted, replied: a.replied, medianReplyHours: a.replyHours.length ? Math.round((median(a.replyHours.map((h) => h * 10)) ?? 0) / 10) : null, viewings: a.viewings }))
      .sort((a, b) => b.contacted - a.contacted),
    freshness: [...freshBy.entries()].map(([sourceId, xs]) => ({ sourceId, medianDetectMs: median(xs) })),
  };
}

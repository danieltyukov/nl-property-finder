/*
 * Today's numbers in one strip: condensed tabular figures, a mono label, and
 * a 14-day sparkline from /stats. Hairlines between the numbers.
 */
import type { StatsView, StatusView } from '@nlpf/core';

export function Sparkline({ values, label }: { values: number[]; label?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 64;
  const h = 20;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - (v / max) * (h - 2)).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false" data-label={label}>
      <polyline points={points} fill="none" />
    </svg>
  );
}

type DailyKey = 'seen' | 'matched' | 'contacted' | 'replies' | 'viewings';

export function PipelineStrip({ status, stats }: { status?: StatusView; stats?: StatsView }) {
  const daily = (stats?.daily ?? []).slice(-14);
  const series = (key: DailyKey) => daily.map((d) => d[key] ?? 0);
  const counts = status?.counts;
  const cells: { label: string; value: number | undefined; key: DailyKey }[] = [
    { label: 'Seen today', value: counts?.seenToday, key: 'seen' },
    { label: 'Matched', value: counts?.matchedToday, key: 'matched' },
    { label: 'Sent', value: counts?.contactedToday, key: 'contacted' },
    { label: 'Replies', value: counts?.repliesToday, key: 'replies' },
    { label: 'Viewings', value: counts?.viewingsUpcoming, key: 'viewings' },
  ];
  return (
    <section className="strip" aria-label="Today">
      <dl className="strip-list">
        {cells.map((cell) => (
          <div className="strip-cell" key={cell.label}>
            <dt className="label">{cell.label}</dt>
            <dd>
              <span className="stat">{cell.value ?? '0'}</span>
              <Sparkline values={series(cell.key)} label={cell.label} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/*
 * The legal-rent estimate. Always says "estimate", always shows its inputs,
 * because it is a simplified point count from public data and the
 * Huurcommissie decides the real maximum.
 */
import type { RentCheck } from '@nlpf/core';
import { eur, m2 } from '../lib/format';
import { Tip } from './ui';

const SOURCE_WORDS: Record<string, string> = { bag: 'BAG', woz: 'WOZ register', 'ep-online': 'EP-Online', listing: 'the listing' };

export function rentCheckInputs(check: RentCheck): string {
  const i = check.inputs;
  const parts = [
    i.sizeM2 ? m2(i.sizeM2) : null,
    i.energyLabel ? `energy label ${i.energyLabel}` : null,
    i.wozEur ? `WOZ ${eur(i.wozEur)}` : null,
    i.buildYear ? `built ${i.buildYear}` : null,
  ].filter(Boolean);
  const from = check.sources.map((s) => SOURCE_WORDS[s] ?? s).join(', ');
  return `Estimate from ${parts.join(', ')}${from ? ` (${from})` : ''}: ${check.points} points, maximum about ${eur(check.maxRentEur)} a month. ${check.note}`;
}

export function RentCheckBadge({ check, threshold = 10 }: { check?: RentCheck; threshold?: number }) {
  if (!check || check.aboveMaxPct === undefined || check.aboveMaxPct < threshold) return null;
  return (
    <Tip tip={rentCheckInputs(check)}>
      <span className="rent-badge">about {Math.round(check.aboveMaxPct)}% above the estimated legal maximum</span>
    </Tip>
  );
}

import { createHash } from 'node:crypto';
import type { AutomationConfig } from '@nlpf/core';

/**
 * Picks a message variant by weight, deterministically per seed (the
 * property id), so a retried contact job uses the same variant and results
 * per variant can be compared. Variants with weight 0 are never picked.
 */
export function pickVariant(variants: AutomationConfig['variants'], seed: string): string | undefined {
  const live = variants.filter((v) => v.weight > 0);
  const total = live.reduce((n, v) => n + v.weight, 0);
  if (!live.length || total <= 0) return undefined;
  const r = (parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16) / 0x1_0000_0000) * total;
  let acc = 0;
  for (const v of live) {
    acc += v.weight;
    if (r < acc) return v.id;
  }
  return live[live.length - 1]!.id;
}

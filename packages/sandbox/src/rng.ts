/**
 * Seeded randomness. Every random choice in the sandbox draws from a stream
 * named after what it is for ("listing:3", "reply:sub-2:1"), so the result
 * depends only on the seed and that name, never on the order in which
 * timers happen to fire.
 */

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

/** FNV-1a over the text, as an unsigned 32-bit integer. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast and good enough for picking words and delays. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from an empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    chance: (p) => next() < p,
  };
  return rng;
}

/** The stream for one purpose under one seed. */
export function rngFor(seed: number, name: string): Rng {
  return createRng(hash32(`${seed}:${name}`));
}

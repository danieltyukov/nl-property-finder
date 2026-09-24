import { expect, test } from 'vitest';
import { pickVariant } from '../src/variants.js';

const variants = [
  { id: 'short', instruction: 'Keep it under 80 words.', weight: 3 },
  { id: 'warm', instruction: 'Open with a personal line.', weight: 1 },
  { id: 'off', instruction: 'Never used.', weight: 0 },
];

test('no variants means no variant', () => {
  expect(pickVariant([], 'p_1')).toBeUndefined();
  expect(pickVariant([{ id: 'x', instruction: 'x', weight: 0 }], 'p_1')).toBeUndefined();
});

test('the same property always gets the same variant', () => {
  for (const seed of ['p_1', 'p_2', 'p_abc'])
    expect(pickVariant(variants, seed)).toBe(pickVariant(variants, seed));
});

test('choices follow the weights and skip weight 0', () => {
  const counts: Record<string, number> = {};
  for (let i = 0; i < 4000; i += 1) {
    const v = pickVariant(variants, `p_${i}`)!;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  expect(counts.off).toBeUndefined();
  expect(counts.short! / counts.warm!).toBeGreaterThan(2.5);
  expect(counts.short! / counts.warm!).toBeLessThan(3.5);
});

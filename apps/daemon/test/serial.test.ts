import { expect, test } from 'vitest';
import { oneAtATime } from '../src/serial.js';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('work for the same key runs one at a time, in order, and other keys run alongside', async () => {
  const log: string[] = [];
  const job = (key: string, name: string, ms: number) =>
    oneAtATime(key, async () => {
      log.push(`${name} start`);
      await tick(ms);
      log.push(`${name} end`);
      return name;
    });
  const results = await Promise.all([job('funda', 'a', 30), job('funda', 'b', 5), job('pararius', 'c', 5)]);
  expect(results).toEqual(['a', 'b', 'c']);
  expect(log.indexOf('a end')).toBeLessThan(log.indexOf('b start'));
  expect(log.indexOf('c end')).toBeLessThan(log.indexOf('a end'));
});

test('a failure does not block the next piece of work for that key', async () => {
  await expect(oneAtATime('k', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  expect(await oneAtATime('k', async () => 'next')).toBe('next');
});

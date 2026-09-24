import { expect, test } from 'vitest';
import { memoryLogger, openStore } from '@nlpf/core';
import { createRunner, RetryLater } from '../src/runner.js';

test('runs due jobs, one per source at a time, retries failures, never retries contact', async () => {
  const store = openStore(':memory:');
  const clock = new Date('2026-09-24T08:00:00Z');
  const order: string[] = [];
  let concurrentForFunda = 0;
  let maxForFunda = 0;
  const runner = createRunner({
    store, log: memoryLogger(), now: () => clock, concurrency: 4,
    handlers: {
      poll: async (job) => {
        if (job.payload.sourceId === 'funda') {
          concurrentForFunda++;
          maxForFunda = Math.max(maxForFunda, concurrentForFunda);
          await new Promise((r) => setTimeout(r, 20));
          concurrentForFunda--;
        }
        order.push(job.key);
      },
      evaluate: async () => {
        throw new Error('flaky');
      },
      contact: async () => {
        throw new Error('form changed');
      },
      notify: async () => {
        throw new RetryLater(new Date('2026-09-24T09:00:00Z'), 'quiet hours');
      },
    },
  });
  store.jobs.enqueue('poll', 'poll:funda:1', { sourceId: 'funda' }, '2026-09-24T07:59:00Z');
  store.jobs.enqueue('poll', 'poll:funda:2', { sourceId: 'funda' }, '2026-09-24T07:59:00Z');
  store.jobs.enqueue('poll', 'poll:kamernet:1', { sourceId: 'kamernet' }, '2026-09-24T07:59:00Z');
  store.jobs.enqueue('evaluate', 'evaluate:p1', {}, '2026-09-24T07:59:00Z');
  store.jobs.enqueue('contact', 'contact:p1', {}, '2026-09-24T07:59:00Z');
  store.jobs.enqueue('notify', 'notify:1', {}, '2026-09-24T07:59:00Z');
  await runner.drain();
  expect(maxForFunda).toBe(1);
  expect(order).toContain('poll:kamernet:1');
  expect(store.jobs.get('evaluate:p1')?.state).toBe('pending');
  expect(store.jobs.get('contact:p1')?.state).toBe('failed');
  expect(store.jobs.get('notify:1')).toMatchObject({ state: 'pending', runAt: '2026-09-24T09:00:00.000Z' });
});

import { expect, test } from 'vitest';
import { openStore } from '../src/index.js';

test('a contact job interrupted mid-run is not retried automatically', () => {
  const s = openStore(':memory:');
  s.jobs.enqueue('contact', 'contact:p1', { propertyId: 'p1' }, '2026-09-23T10:00:00Z');
  const [job] = s.jobs.claim('2026-09-23T10:00:01Z', 10);
  expect(job?.state).toBe('running');
  const interrupted = s.jobs.recover('2026-09-23T10:05:00Z');
  expect(interrupted.map((j) => j.key)).toEqual(['contact:p1']);
  expect(s.jobs.claim('2026-09-23T10:05:01Z', 10)).toEqual([]);
  expect(s.jobs.enqueue('contact', 'contact:p1', {}, '2026-09-23T10:06:00Z')).toBeNull();
});

test('other interrupted jobs go back to pending', () => {
  const s = openStore(':memory:');
  s.jobs.enqueue('poll', 'poll:pararius:1', {}, '2026-09-23T10:00:00Z');
  s.jobs.claim('2026-09-23T10:00:01Z', 10);
  expect(s.jobs.recover('2026-09-23T10:05:00Z')).toEqual([]);
  expect(s.jobs.claim('2026-09-23T10:05:01Z', 10)).toHaveLength(1);
});

test('jobs are claimed only when due, once, and failed ones can be retried', () => {
  const s = openStore(':memory:');
  s.jobs.enqueue('evaluate', 'evaluate:a', {}, '2026-09-23T10:00:00Z');
  s.jobs.enqueue('evaluate', 'evaluate:b', {}, '2026-09-23T11:00:00Z');
  expect(s.jobs.enqueue('evaluate', 'evaluate:a', {}, '2026-09-23T10:00:00Z')).toBeNull();
  const first = s.jobs.claim('2026-09-23T10:30:00Z', 10);
  expect(first.map((j) => j.key)).toEqual(['evaluate:a']);
  expect(s.jobs.claim('2026-09-23T10:30:00Z', 10)).toEqual([]);
  s.jobs.fail(first[0]!.id, 'boom', '2026-09-23T10:31:00Z', '2026-09-23T10:40:00Z');
  expect(s.jobs.get('evaluate:a')?.state).toBe('pending');
  const again = s.jobs.claim('2026-09-23T10:41:00Z', 10);
  expect(again[0]?.attempts).toBe(2);
  s.jobs.fail(again[0]!.id, 'boom', '2026-09-23T10:42:00Z');
  expect(s.jobs.get('evaluate:a')?.state).toBe('failed');
  expect(s.jobs.enqueue('evaluate', 'evaluate:a', {}, '2026-09-23T10:50:00Z')?.state).toBe('pending');
  expect(s.jobs.nextRunAt()).toBe('2026-09-23T10:50:00Z');
});

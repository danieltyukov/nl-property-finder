import { memoryLogger, NotifySchema, type Notification, type Notifier } from '@nlpf/core';
import { expect, test } from 'vitest';
import { createNotifyDispatcher, NEUTRAL_BODY, type DigestNotifier } from '../src/dispatcher.js';

function recorder(id = 'rec'): Notifier & { sent: Notification[] } {
  const sent: Notification[] = [];
  return {
    id,
    sent,
    async send(n) {
      sent.push(n);
    },
  };
}

/** A clock the test moves by hand. Amsterdam is UTC+2 in September. */
function clock(iso: string) {
  let t = new Date(iso);
  return { now: () => t, set: (next: string) => (t = new Date(next)) };
}

const cfg = (over: Record<string, unknown> = {}) =>
  NotifySchema.parse({ minPriority: 3, quietHours: { start: '23:00', end: '07:00' }, includeDetails: true, ...over });

const note = (over: Partial<Notification> = {}): Notification => ({ title: 'Reply needed', body: 'Landlord asks a question', priority: 3, ...over });

test('quiet hours hold priority 3, pass priority 5, and release what was held when they end', async () => {
  const c = clock('2026-09-23T21:30:00Z'); // 23:30 in Amsterdam
  const rec = recorder();
  const d = createNotifyDispatcher([rec], cfg(), c.now);
  expect((await d.notify(note({ title: 'held' }))).outcome).toBe('held');
  expect((await d.notify(note({ title: 'urgent', priority: 5 }))).outcome).toBe('sent');
  expect(rec.sent.map((n) => n.title)).toEqual(['urgent']);
  expect(d.held()).toBe(1);

  c.set('2026-09-24T04:59:00Z'); // 06:59, still quiet
  await d.tick();
  expect(rec.sent.map((n) => n.title)).toEqual(['urgent']);

  c.set('2026-09-24T05:00:00Z'); // 07:00
  await d.tick();
  expect(rec.sent.map((n) => n.title)).toEqual(['urgent', 'held']);
  expect(d.held()).toBe(0);
});

test('held notifications go out first when the next one arrives after quiet hours', async () => {
  const c = clock('2026-09-23T22:00:00Z'); // 00:00 in Amsterdam
  const rec = recorder();
  const d = createNotifyDispatcher([rec], cfg(), c.now);
  await d.notify(note({ title: 'night' }));
  c.set('2026-09-24T06:00:00Z'); // 08:00
  await d.notify(note({ title: 'morning' }));
  expect(rec.sent.map((n) => n.title)).toEqual(['night', 'morning']);
});

test('priority below minPriority is dropped', async () => {
  const rec = recorder();
  const d = createNotifyDispatcher([rec], cfg({ minPriority: 3 }), () => new Date('2026-09-23T10:00:00Z'));
  expect((await d.notify(note({ priority: 2 }))).outcome).toBe('dropped');
  expect(rec.sent).toEqual([]);
});

test('the same key twice within 10 minutes is sent once', async () => {
  const c = clock('2026-09-23T10:00:00Z');
  const rec = recorder();
  const d = createNotifyDispatcher([rec], cfg(), c.now);
  expect((await d.notify(note({ key: 'task:t_1' }))).outcome).toBe('sent');
  c.set('2026-09-23T10:09:59Z');
  expect((await d.notify(note({ key: 'task:t_1' }))).outcome).toBe('deduped');
  expect((await d.notify(note({ key: 'task:t_2' }))).outcome).toBe('sent');
  c.set('2026-09-23T10:10:01Z');
  expect((await d.notify(note({ key: 'task:t_1' }))).outcome).toBe('sent');
  expect(rec.sent).toHaveLength(3);
});

test('includeDetails false replaces the body with a neutral line and keeps links off the machine', async () => {
  const rec = recorder();
  const d = createNotifyDispatcher([rec], cfg({ includeDetails: false }), () => new Date('2026-09-23T10:00:00Z'));
  await d.notify(
    note({
      title: 'Viewing booked',
      body: 'Oude Delft 12A, 2611 BC Delft on Thursday at 18:30 with Jan de Vries',
      url: 'https://www.funda.nl/detail/huur/delft/appartement-oude-delft-12-a/43123456/',
      priority: 4,
    }),
  );
  await d.notify(note({ title: 'Call now', body: 'Westvest 95', url: 'http://127.0.0.1:7431/inbox/t_9', call: '+31612345678', priority: 4 }));
  expect(rec.sent[0]).toEqual({ title: 'Viewing booked', body: NEUTRAL_BODY, priority: 4 });
  expect(JSON.stringify(rec.sent)).not.toContain('Oude Delft');
  expect(JSON.stringify(rec.sent)).not.toContain('Westvest');
  // A link to the local dashboard reveals nothing, and the call button needs its number.
  expect(rec.sent[1]).toMatchObject({ url: 'http://127.0.0.1:7431/inbox/t_9', call: '+31612345678' });
});

test('includeDetails true passes the notification through unchanged', async () => {
  const rec = recorder();
  const d = createNotifyDispatcher([rec], cfg({ includeDetails: true }), () => new Date('2026-09-23T10:00:00Z'));
  const n = note({ body: 'Oude Delft 12A', url: 'https://example.test/x' });
  await d.notify(n);
  expect(rec.sent[0]).toEqual(n);
});

test('a failing notifier does not stop the others and the failure is reported', async () => {
  const log = memoryLogger();
  const broken: Notifier = {
    id: 'broken',
    async send() {
      throw new Error('HTTP 502');
    },
  };
  const rec = recorder('ok');
  const d = createNotifyDispatcher([broken, rec], cfg(), () => new Date('2026-09-23T10:00:00Z'), { log });
  const r = await d.notify(note());
  expect(r).toMatchObject({ outcome: 'sent', sent: ['ok'], failed: [{ id: 'broken', error: 'HTTP 502' }] });
  expect(rec.sent).toHaveLength(1);
  expect(log.entries.some((e) => e.lvl === 'warn' && e.data?.notifier === 'broken')).toBe(true);
});

test('a daily digest channel gets one batch the next morning at 08:00; priority 5 still goes at once', async () => {
  const c = clock('2026-09-23T10:00:00Z'); // 12:00 in Amsterdam
  const batches: string[][] = [];
  const instant: string[] = [];
  const digest: DigestNotifier = {
    id: 'email',
    digest: 'daily',
    async send(n) {
      instant.push(n.title);
    },
    async sendDigest(items) {
      batches.push(items.map((n) => n.title));
    },
  };
  const d = createNotifyDispatcher([digest], cfg({ quietHours: undefined }), c.now);
  expect((await d.notify(note({ title: 'a' }))).queued).toEqual(['email']);
  await d.notify(note({ title: 'b' }));
  await d.notify(note({ title: 'now', priority: 5 }));
  expect(instant).toEqual(['now']);
  c.set('2026-09-23T18:00:00Z');
  await d.tick();
  c.set('2026-09-24T05:59:00Z'); // 07:59 next day
  await d.tick();
  expect(batches).toEqual([]);
  c.set('2026-09-24T06:01:00Z'); // 08:01
  await d.tick();
  await d.tick();
  expect(batches).toEqual([['a', 'b']]);
});

test('the config can be read on every call, so a reload applies without a restart', async () => {
  let current = cfg({ minPriority: 3 });
  const rec = recorder();
  const d = createNotifyDispatcher([rec], () => current, () => new Date('2026-09-23T10:00:00Z'));
  expect((await d.notify(note({ priority: 3 }))).outcome).toBe('sent');
  current = cfg({ minPriority: 4 });
  expect((await d.notify(note({ priority: 3, key: 'other' }))).outcome).toBe('dropped');
});

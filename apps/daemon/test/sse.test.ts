import { expect, test } from 'vitest';
import { createApp } from '../src/api/app.js';
import { fakeContext, req } from './helpers.js';

async function readEvents(res: Response, count: number): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events: string[] = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const p of parts) {
      const ev = p.split('\n').find((l) => l.startsWith('event:'));
      if (ev) events.push(ev.slice(6).trim());
    }
  }
  await reader.cancel();
  return events;
}

test('a reconnecting client gets what it missed, then live events', async () => {
  const ctx = fakeContext();
  const app = createApp(ctx);
  const first = ctx.bus.emit('daemon.started', 'Started');
  ctx.bus.emit('listing.new', 'Found Oude Delft 12A');
  const res = await app.fetch(req('/api/v1/events', { headers: { 'last-event-id': String(first.id) } }));
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const pending = readEvents(res, 3);
  setTimeout(() => ctx.bus.emit('message.sent', 'Sent'), 50);
  expect(await pending).toEqual(['listing.new', 'ready', 'message.sent']);
});

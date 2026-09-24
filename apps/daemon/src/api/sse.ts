import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventBus, NlpfEvent, Store } from '@nlpf/core';

/**
 * Server-sent events. A reconnecting client sends Last-Event-ID (EventSource
 * does this itself), and everything it missed is replayed from the store
 * before live events continue, so the dashboard feed never has gaps.
 */
export function sseHandler(c: Context, store: Store, bus: EventBus) {
  const lastId = Number(c.req.header('last-event-id') ?? c.req.query('since') ?? 0) || 0;
  return streamSSE(c, async (stream) => {
    const queue: NlpfEvent[] = [];
    let wake: (() => void) | undefined;
    const unsubscribe = bus.subscribe((e) => {
      queue.push(e);
      wake?.();
    });
    stream.onAbort(() => {
      unsubscribe();
      wake?.();
    });
    let sent = lastId;
    const send = async (e: NlpfEvent) => {
      if (e.id <= sent) return;
      sent = e.id;
      await stream.writeSSE({ id: String(e.id), event: e.type, data: JSON.stringify(e) });
    };
    if (lastId > 0) for (const e of store.events.since(lastId, 1000)) await send(e);
    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ lastId: sent }) });
    while (!stream.aborted) {
      while (queue.length) await send(queue.shift()!);
      await Promise.race([
        new Promise<void>((resolve) => (wake = resolve)),
        stream.sleep(25_000).then(() => stream.writeSSE({ event: 'ping', data: '{}' })),
      ]);
      wake = undefined;
    }
    unsubscribe();
  });
}

import type { Store } from './store/store.js';
import type { EventType, NlpfEvent } from './types.js';

export interface EventBus {
  /** Appends to the store's event log, then notifies subscribers synchronously. */
  emit(type: EventType, summary: string, data?: Record<string, unknown>): NlpfEvent;
  subscribe(fn: (e: NlpfEvent) => void): () => void;
}

export function createEventBus(store: Store, now: () => string = () => new Date().toISOString()): EventBus {
  const subs = new Set<(e: NlpfEvent) => void>();
  return {
    emit(type, summary, data = {}) {
      const event = store.events.append(type, summary, data, now());
      for (const fn of subs) {
        try {
          fn(event);
        } catch {
          // One broken subscriber (a closed SSE socket, say) must not stop the others.
        }
      }
      return event;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

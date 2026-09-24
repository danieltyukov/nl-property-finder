/*
 * The live connection to the daemon: one EventSource on /api/v1/events.
 *
 * The daemon writes `event: <type>`, `id: <n>` and `data: <NlpfEvent json>`, so
 * a listener is registered per event type (EventSource only hands unnamed
 * events to onmessage). Each event is kept for the live feed, passed to
 * subscribers, and turned into cache invalidations, batched so a burst of
 * polls refetches once. The browser resends Last-Event-ID on reconnect, so the
 * daemon can replay what the page missed.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EventType, NlpfEvent } from '@nlpf/core';
import { API_PREFIX, ROUTES } from '../core';
import { apiToken } from '../env';

export const EVENT_TYPES = [
  'listing.new', 'listing.changed', 'listing.gone',
  'property.matched', 'property.rejected', 'property.scam',
  'application.updated',
  'message.sent', 'message.received', 'message.failed', 'message.drafted',
  'task.created', 'task.updated',
  'viewing.booked', 'viewing.cancelled',
  'source.polled', 'source.health',
  'automation.paused', 'automation.resumed',
  'config.updated', 'mail.status', 'daemon.started',
  'applications.withdrawn', 'followup.sent', 'action.received',
] as const satisfies readonly EventType[];

// Fails to compile when core adds an event type this list does not know.
type MissingEventType = Exclude<EventType, (typeof EVENT_TYPES)[number]>;
export const eventTypesComplete: [MissingEventType] extends [never] ? true : never = true;

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  readonly readyState: number;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export const browserEventSource: EventSourceFactory = (url) => new EventSource(url) as EventSourceLike;

export type StreamState = 'connecting' | 'open' | 'closed';

interface StreamValue {
  state: StreamState;
  /** Newest first, capped at MAX_EVENTS. */
  events: NlpfEvent[];
  subscribe(fn: (event: NlpfEvent) => void): () => void;
}

const MAX_EVENTS = 300;

const StreamContext = createContext<StreamValue>({
  state: 'closed',
  events: [],
  subscribe: () => () => undefined,
});

export function eventsUrl(): string {
  return `${API_PREFIX}${ROUTES.events.path}?token=${encodeURIComponent(apiToken())}`;
}

/** Which cached queries an event makes stale. */
export function invalidationsFor(type: string): string[][] {
  const keys: string[][] = [['activity']];
  const add = (...names: string[]) => names.forEach((name) => keys.push([name]));
  if (type.startsWith('listing.')) add('properties', 'property', 'status');
  else if (type.startsWith('property.')) add('properties', 'property', 'applications', 'status');
  else if (type === 'application.updated') add('applications', 'properties', 'property', 'status');
  else if (type.startsWith('message.') || type === 'followup.sent') add('conversations', 'conversation', 'applications', 'property', 'status');
  else if (type.startsWith('task.') || type === 'action.received') add('tasks', 'status');
  else if (type.startsWith('viewing.')) add('viewings', 'applications', 'property', 'status');
  else if (type.startsWith('source.')) add('sources', 'status');
  else if (type.startsWith('automation.')) add('status', 'config');
  else if (type === 'config.updated') add('config', 'status', 'sources');
  else if (type === 'mail.status') add('status');
  else if (type === 'applications.withdrawn') add('applications', 'conversations', 'status', 'config');
  else if (type === 'daemon.started') add('status', 'tasks', 'sources', 'config', 'properties', 'applications');
  return keys;
}

export function EventStreamProvider(props: { children: ReactNode; factory?: EventSourceFactory; url?: string }) {
  const { children, factory = browserEventSource, url } = props;
  const client = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');
  const [events, setEvents] = useState<NlpfEvent[]>([]);
  const subscribers = useRef(new Set<(event: NlpfEvent) => void>());

  useEffect(() => {
    let source: EventSourceLike | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const pending = new Map<string, string[]>();

    const flush = () => {
      flushTimer = undefined;
      for (const key of pending.values()) void client.invalidateQueries({ queryKey: key });
      pending.clear();
    };

    const onEvent = (message: MessageEvent) => {
      let event: NlpfEvent;
      try {
        event = JSON.parse(String(message.data)) as NlpfEvent;
      } catch {
        return;
      }
      if (!event || typeof event !== 'object') return;
      if (!event.type && message.type !== 'message') event.type = message.type as EventType;
      if (!event.id && message.lastEventId) event.id = Number(message.lastEventId);
      if (!event.type) return;
      setEvents((previous) =>
        previous.some((p) => p.id === event.id) ? previous : [event, ...previous].slice(0, MAX_EVENTS),
      );
      for (const key of invalidationsFor(event.type)) pending.set(key.join('/'), key);
      flushTimer ??= setTimeout(flush, 250);
      for (const fn of subscribers.current) fn(event);
    };

    const connect = () => {
      if (stopped) return;
      setState('connecting');
      try {
        source = factory(url ?? eventsUrl());
      } catch {
        setState('closed');
        retry = setTimeout(connect, 5000);
        return;
      }
      source.onopen = () => setState('open');
      source.onerror = () => {
        // readyState 2 means the browser gave up (for example a 401); retry ourselves.
        if (source?.readyState === 2) {
          setState('closed');
          source.close();
          retry = setTimeout(connect, 5000);
        } else {
          setState('connecting');
        }
      };
      for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);
      source.addEventListener('message', onEvent);
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(flushTimer);
      source?.close();
    };
  }, [client, factory, url]);

  const subscribe = useCallback((fn: (event: NlpfEvent) => void) => {
    subscribers.current.add(fn);
    return () => {
      subscribers.current.delete(fn);
    };
  }, []);
  const value = useMemo<StreamValue>(() => ({ state, events, subscribe }), [state, events, subscribe]);
  return createElement(StreamContext.Provider, { value }, children);
}

export function useEventStream(): StreamValue {
  return useContext(StreamContext);
}

/** Calls `fn` for every live event while the component is mounted. */
export function useOnEvent(fn: (event: NlpfEvent) => void) {
  const { subscribe } = useEventStream();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}

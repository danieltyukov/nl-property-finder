/*
 * Test helpers: an Api whose every method is a vi.fn answering from the mock
 * fixtures, a fake EventSource the test can push events into, and a render
 * of the whole app at a given path.
 */
import { render } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { vi } from 'vitest';
import { memoryLocation } from 'wouter/memory-location';
import type { EventType, NlpfEvent } from '@nlpf/core';
import type { Api } from '../api/client';
import type { EventSourceLike } from '../api/sse';
import { Root } from '../app';
import { applicationsOf, buildWorld, statusOf, type World } from '../mock/fixtures';

export function makeApi(world: World = buildWorld()): Api {
  const api: Api = {
    status: vi.fn(async () => statusOf(world)),
    pause: vi.fn(async () => {
      world.paused = true;
      return statusOf(world);
    }),
    resume: vi.fn(async () => {
      world.paused = false;
      return statusOf(world);
    }),
    properties: vi.fn(async () => ({ items: world.properties })),
    property: vi.fn(async (id: string) => {
      const found = world.properties.find((p) => p.property.id === id);
      if (!found) throw new Error('not found');
      return found;
    }),
    contactProperty: vi.fn(async () => ({ ok: true })),
    skipProperty: vi.fn(async () => ({ ok: true })),
    applications: vi.fn(async () => ({ items: applicationsOf(world) })),
    withdrawAll: vi.fn(async () => ({ withdrawn: 1 })),
    tasks: vi.fn(async () => ({ items: world.tasks.filter((t) => t.state === 'open') })),
    resolveTask: vi.fn(async (id: string) => {
      const task = world.tasks.find((t) => t.id === id);
      if (task) task.state = 'done';
      return task;
    }),
    conversations: vi.fn(async () => ({ items: world.conversations })),
    conversation: vi.fn(async (id: string) => {
      const conversation = world.conversations.find((c) => c.id === id)!;
      return { conversation, messages: world.messages.filter((m) => m.conversationId === id), property: null, application: null };
    }),
    sendMessage: vi.fn(async (conversationId: string, body: { body: string }) => ({
      id: 'm_test', conversationId, direction: 'out' as const, author: 'human' as const, channel: 'email' as const, body: body.body, at: new Date().toISOString(), status: 'sent' as const,
    })),
    draft: vi.fn(async () => ({ body: 'Beste heer, mevrouw,', rationale: 'test' })),
    viewings: vi.fn(async () => ({ items: world.viewings })),
    sources: vi.fn(async () => ({ items: world.sources })),
    patchSource: vi.fn(async () => ({ ok: true })),
    testSource: vi.fn(async () => ({ ok: true, count: 3 })),
    connectSource: vi.fn(async () => ({ started: true })),
    pollSource: vi.fn(async () => ({ started: true })),
    config: vi.fn(async () => world.config),
    patchConfig: vi.fn(async (section: string, value: unknown) => {
      (world.config as unknown as Record<string, unknown>)[section] = value;
      return world.config;
    }),
    activity: vi.fn(async () => ({ items: [] })),
    stats: vi.fn(async () => world.stats),
    documents: vi.fn(async () => ({ items: world.documents })),
    uploadDocument: vi.fn(async () => ({ ok: true })),
    deleteDocument: vi.fn(async () => ({ ok: true })),
    tenantProfilePdf: vi.fn(async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    notifyTest: vi.fn(async () => ({ ok: true })),
  };
  return api;
}

export class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    });
  }

  static latest(): FakeEventSource {
    const last = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!last) throw new Error('no EventSource was opened');
    return last;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  close() {
    this.readyState = 2;
  }

  emit(type: EventType, summary: string, data: Record<string, unknown> = {}, id = Math.floor(Math.random() * 1e6) + 10_000): NlpfEvent {
    const event: NlpfEvent = { id, type, at: new Date().toISOString(), summary, data };
    const message = new MessageEvent(type, { data: JSON.stringify(event), lastEventId: String(id) });
    for (const listener of this.listeners.get(type) ?? []) listener(message);
    return event;
  }
}

export const fakeEventSource = (url: string) => new FakeEventSource(url);

export function renderApp(options: { path?: string; api?: Api; undoMs?: number } = {}) {
  const api = options.api ?? makeApi();
  const { hook } = memoryLocation({ path: options.path ?? '/' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: 0 } } });
  const view = render(<Root api={api} eventSource={fakeEventSource} undoMs={options.undoMs ?? 40} location={hook} client={client} />);
  return { ...view, api, client };
}

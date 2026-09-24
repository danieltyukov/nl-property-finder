import type {
  Config,
  EventBus,
  Logger,
  Mailbox,
  Notification,
  Paths,
  SourceAdapter,
  SourceContext,
  Store,
  Task,
} from '@nlpf/core';
import type { FetchJson } from '@nlpf/agent';
import type { NlpfAiProvider } from '@nlpf/ai';
import type { Scheduler } from './scheduler.js';

/**
 * Everything the pipelines need, built once by startDaemon. Pipelines are
 * plain async functions over this object, which is what makes them testable
 * with an in-memory store, the sandbox and the demo AI.
 */
export interface Runtime {
  paths: Paths;
  store: Store;
  bus: EventBus;
  log: Logger;
  config(): Config;
  secrets(): Record<string, string>;
  now(): Date;
  demo: boolean;

  adapters(): SourceAdapter[];                 // enabled, in priority order
  adapter(id: string): SourceAdapter | undefined;
  sourceContext(adapter: SourceAdapter, signal?: AbortSignal): SourceContext;
  scheduler: Scheduler;

  ai(): NlpfAiProvider;
  mailbox(): Mailbox | undefined;
  geocode(addr: import('@nlpf/core').Address): Promise<import('@nlpf/core').Address>;
  fetchJson: FetchJson;

  notify(n: Notification): Promise<void>;
  /** Hook for opening a URL on the user's screen (Holland2Stay's assisted booking). */
  openOnScreen?(url: string): Promise<void>;
}

/** Opens (or finds) a task and announces it once. */
export function openTask(
  rt: Runtime,
  t: Omit<Task, 'id' | 'state' | 'createdAt' | 'updatedAt'>,
  dedupeKey?: string,
): Task {
  const { task, created } = rt.store.tasks.open(t, rt.now().toISOString(), dedupeKey);
  if (created) rt.bus.emit('task.created', task.title, { taskId: task.id, kind: task.kind, priority: task.priority, propertyId: task.propertyId });
  return task;
}

export const euro = (n: number | undefined) =>
  n === undefined ? '' : `EUR ${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(n)}`;

export function startOfToday(now: Date): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

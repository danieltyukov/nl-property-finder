/*
 * Response shapes the dashboard reads that @nlpf/core does not pin down yet.
 * core/api.ts fixes PropertyView, ConversationView, StatusView, StatsView and
 * Page<T>; the ones below are what the dashboard expects from the daemon for
 * the other routes. Every field beyond the core types is optional, and the
 * pages render without it, so a daemon that returns less still works.
 */
import type {
  Application,
  Config,
  Message,
  NlpfEvent,
  Page,
  Property,
  RawListing,
  SourceCapabilities,
  SourceConfig,
  SourceState,
} from '@nlpf/core';

/** GET /applications: one card on the Applications board. */
export interface ApplicationView {
  application: Application;
  property: Property | null;
  conversationId?: string | null;
  counterpart?: { name?: string; email?: string; sourceId?: string } | null;
  lastMessage?: Pick<Message, 'direction' | 'author' | 'body' | 'at'> | null;
  nextFollowUpAt?: string | null;
}

/** GET /sources: the source state plus what the adapter declares and what the user chose. */
export interface SourceView extends SourceState {
  homepage?: string;
  capabilities?: SourceCapabilities;
  intervalSec?: number;
  contactMode?: 'auto' | 'watch_only';
  config?: Partial<SourceConfig>;
  termsNote?: string;
}

/** GET /documents */
export interface DocumentView {
  name: string;
  sensitivity: 'public' | 'private' | 'identity';
  kind?: string;
  size?: number;
  addedAt?: string;
}

/** GET /config: the config with the names of the secrets that are set, never their values. */
export type ConfigView = Config & { secretsPresent?: string[] };

/** POST /sources/:id/test */
export interface TestSourceResult {
  ok: boolean;
  count?: number;
  ms?: number;
  error?: string;
  sample?: Pick<RawListing, 'title' | 'url' | 'priceEur'>[];
}

/** POST /draft */
export interface DraftResult {
  subject?: string;
  body: string;
  rationale?: string;
}

export type ActivityPage = Page<NlpfEvent>;

/** List routes may answer with a bare array or a Page; both read the same. */
export function items<T>(value: T[] | Page<T> | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : (value.items ?? []);
}

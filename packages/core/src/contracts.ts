import type { Page } from 'playwright-core';
import type { Config, NamedSearch, Profile, SearchConfig, SourceConfig } from './config/schema.js';
import type { Logger } from './log.js';
import type {
  Attachment, ChannelKind, ContactMethod, Intent, Lang, Listing, Message, Property, RawListing, Requirements,
} from './types.js';

/* ---------- sources ---------- */

export interface FetchResult {
  status: number;
  url: string;
  headers: Headers;
  text: string;
  notModified: boolean;
  json<T = unknown>(): T;
}

export interface BrowserSession { page: Page; close(): Promise<void> }

export interface SourceContext {
  fetch(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<FetchResult>;
  browser(opts?: { headed?: boolean }): Promise<BrowserSession>;
  log: Logger;
  profile: Profile;
  searches: NamedSearch[];          // enabled searches only
  source: SourceConfig;
  now(): Date;
  signal: AbortSignal;
}

export interface SearchRequest { key: string; label: string; url?: string; params?: Record<string, string | number | boolean> }

export interface OutboundMessage {
  subject?: string;
  body: string;
  language: Lang;
  profile: Profile;
  attachments?: Attachment[];
  dryRun: boolean;
}

export interface ContactResult {
  ok: boolean;
  channel: ChannelKind;
  externalId?: string;
  error?: string;
  needs?: 'login' | 'captcha' | 'paid' | 'human';
  evidence?: string;                // e.g. confirmation text or screenshot path
}

export interface SourceCapabilities {
  search: 'json' | 'html' | 'browser' | 'email-alert';
  detail: boolean;
  contact: ContactMethod;
  login: 'none' | 'optional' | 'required';
  paid?: { feature: 'contact' | 'early-access' | 'alerts'; plan: string };
  terms: 'allows' | 'forbids' | 'unknown';   // what the platform's terms say about automated access (docs/research/platforms.md section 5)
  browser?: 'headless' | 'headed';  // 'headed' runs in a real window on a private Xvfb display (Cloudflare-managed sites)
  landlordPortal?: boolean;         // the landlord's own application channel (MVGM, Vesteda): it wins over the same home on a listing platform, where such landlords answer "apply on our website"
}

export interface SourceAdapter {
  id: string;
  name: string;
  homepage: string;
  regions: 'nl' | string[];         // municipalities, lowercased
  defaultIntervalSec: number;
  capabilities: SourceCapabilities;
  buildSearches(searches: NamedSearch[], source: SourceConfig): SearchRequest[];   // union over searches, deduped by key
  search(req: SearchRequest, ctx: SourceContext): Promise<RawListing[]>;
  detail?(listing: RawListing, ctx: SourceContext): Promise<RawListing>;
  contact?(listing: Listing, message: OutboundMessage, ctx: SourceContext): Promise<ContactResult>;
  inbox?(ctx: SourceContext, since: Date): Promise<InboundMessage[]>;
  reply?(threadId: string, message: OutboundMessage, ctx: SourceContext): Promise<ContactResult>;
  checkSession?(ctx: SourceContext): Promise<'ok' | 'expired' | 'none'>;
  isAvailable?(listing: Listing, ctx: SourceContext): Promise<boolean>;   // cheap re-check right before contact; default uses detail() or a GET of the URL
  loginUrl?: string;
  parseAlertEmail?(mail: InboundMessage): RawListing[];   // alert-email ingestion
  alertSenders?: string[];                                // e.g. ["noreply@pararius.nl"]
}

/* ---------- mail ---------- */

export interface InboundMessage {
  id: string;                       // RFC Message-ID or `${sourceId}:${platformId}`
  channel: 'email' | 'platform';
  sourceId?: string;
  threadId?: string;
  from: { name?: string; address?: string };
  to?: string[];
  subject?: string;
  text: string;
  html?: string;
  at: string;
  inReplyTo?: string;
  references?: string[];
  autoSubmitted?: boolean;          // Auto-Submitted, X-Autoreply, Precedence: auto_reply/bulk; never auto-answered
  attachments: Attachment[];
}

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; path: string }[];
}

export interface MailStatus { connected: boolean; address?: string; lastIdleAt?: string; error?: string }

export interface Mailbox {
  readonly address: string;
  start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  send(mail: OutboundEmail): Promise<{ messageId: string }>;
  status(): MailStatus;
}

/* ---------- ai ---------- */

export interface ProposedSlot { start: string; end?: string; text: string; certain: boolean }

export interface ExtractInput { listing: Listing; profile: Profile; search: SearchConfig }
export interface ExtractOutput {
  requirements: Requirements;
  score: number;
  reasons: string[];
  scamSignals: string[];
  language: Lang;
  summary: string;
}

export interface ComposeInput {
  listing: Listing;
  profile: Profile;
  template: string;
  language: Lang;
  channel: ChannelKind;
  maxChars?: number;
  variant?: string;                 // message A/B variant id
}
export interface ComposeOutput { subject?: string; body: string; rationale: string }

export interface ClassifyInput { message: InboundMessage; property?: Property; lastOutbound?: Message; now: string }
export interface ClassifyOutput {
  intent: Intent;
  confidence: number;               // 0-1
  slots: ProposedSlot[];
  questions: string[];
  documents: string[];
  deadline?: string;
  addressMention?: string;
  summary: string;
}

export interface ReplyInput {
  message: InboundMessage;
  classification: ClassifyOutput;
  profile: Profile;
  property?: Property;
  language: Lang;
  purpose: 'answer' | 'confirm_viewing' | 'decline_viewing' | 'send_documents' | 'withdraw';
  chosenSlot?: ProposedSlot;
}
export interface ReplyOutput { subject?: string; body: string; unanswerable: string[]; rationale: string }

export interface ContractReviewInput { text: string; property?: Property; priceEur?: number; language: Lang }
export interface ContractReview {
  summary: string;
  findings: { severity: 'info' | 'warning' | 'illegal'; topic: string; text: string }[];  // e.g. deposit above 2x base rent, bemiddelingskosten, temporary-contract rules
}

export interface AiUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; calls: number }

export interface AiProvider {
  readonly id: 'claude' | 'rules' | 'demo';
  extract(input: ExtractInput): Promise<ExtractOutput>;
  compose(input: ComposeInput): Promise<ComposeOutput>;
  classify(input: ClassifyInput): Promise<ClassifyOutput>;
  reply(input: ReplyInput): Promise<ReplyOutput>;
  reviewContract(input: ContractReviewInput): Promise<ContractReview>;
  usage(): AiUsage;
}

/* ---------- notify ---------- */

export interface Notification {
  title: string;
  body: string;
  priority: 1 | 2 | 3 | 4 | 5;      // ntfy scale, 5 = urgent
  url?: string;
  tags?: string[];
  key?: string;                     // dedupe key
  taskId?: string;
  actions?: { id: string; label: string }[];   // e.g. approve, dismiss, snooze; delivered as buttons where the channel supports them
  call?: string;                    // phone number for a "call now" button (tel: link)
}

export interface Notifier { readonly id: string; send(n: Notification): Promise<void> }

/** Button presses and replies coming back from the phone over outbound-only connections. */
export interface ActionEvent { taskId: string; action: string; text?: string; channel: string; at: string }
export interface ActionChannel {
  readonly id: string;
  start(onAction: (a: ActionEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export type { Config };

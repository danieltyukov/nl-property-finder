import { z } from 'zod';
import type { AiProvider, AiUsage, MailStatus, SourceCapabilities } from './contracts.js';
import type { SourceConfig } from './config/schema.js';
import type { Application, Conversation, Listing, Match, Message, Property, SourceState, Viewing } from './types.js';

/*
 * The HTTP contract shared by the daemon, the dashboard, the CLI and the MCP
 * server. Response shapes are TypeScript types; request bodies are zod schemas
 * so the daemon validates them and the OpenAPI document is generated from them.
 */

export const API_PREFIX = '/api/v1';

export interface PropertyView { property: Property; listings: Listing[]; match: Match | null; application: Application | null; viewings: Viewing[]; conversationIds: string[] }
export interface ConversationView { conversation: Conversation; messages: Message[]; property: Property | null; application: Application | null }
export interface StatusView {
  version: string; startedAt: string; paused: boolean; dryRun: boolean; demo: boolean;
  sources: SourceState[]; mail: MailStatus; ai: { provider: AiProvider['id']; usageThisMonth: AiUsage; budget?: number };
  counts: { openTasks: number; seenToday: number; matchedToday: number; contactedToday: number; repliesToday: number; viewingsUpcoming: number };
  nextPollAt?: string;
}
export interface StatsView {
  reactionMsMedian7d: number | null;
  daily: { date: string; seen: number; matched: number; contacted: number; replies: number; viewings: number }[];
  perSource: { sourceId: string; seen7d: number; matched7d: number; contacted7d: number; replies7d: number; medianReactionMs: number | null }[];
  perVariant: { variant: string; sent: number; replies: number; viewings: number }[];
  perAgency: { agency: string; contacted: number; replied: number; medianReplyHours: number | null; viewings: number }[];
  freshness: { sourceId: string; medianDetectMs: number | null }[];   // publishedAt to first seen, where the source reports publishedAt
}
export interface Page<T> { items: T[]; next?: string }

/** GET /sources: health plus what the adapter declares and what the user chose. */
export interface SourceView extends SourceState {
  homepage?: string;
  capabilities?: SourceCapabilities;
  regions?: 'nl' | string[];
  intervalSec?: number;
  contactMode?: 'auto' | 'watch_only';
  config?: Partial<SourceConfig>;
  termsNote?: string;
}

export const ResolveTaskBody = z.object({
  action: z.enum(['done', 'dismiss', 'snooze', 'approve', 'reject', 'send_draft']),
  until: z.string().optional(),
  draft: z.string().optional(),
  slot: z.number().int().optional(),
});
export const SendMessageBody = z.object({ body: z.string().min(1), subject: z.string().optional(), send: z.boolean().default(true) });
export const DraftBody = z.object({ propertyId: z.string().optional(), conversationId: z.string().optional(), instructions: z.string().optional() });
export const ContactBody = z.object({ message: z.string().optional(), force: z.boolean().default(false) });
export const SourcePatchBody = z.object({ enabled: z.boolean().optional(), intervalSec: z.number().int().min(30).optional(), contact: z.enum(['auto', 'watch_only']).optional(), paidPlan: z.string().nullable().optional() });
export const ConfigPatchBody = z.object({ section: z.enum(['profile', 'searches', 'registrations', 'rentCheck', 'sources', 'automation', 'mail', 'notify', 'ai', 'agencies', 'server']), value: z.unknown() });
export const WithdrawAllBody = z.object({ foundAddress: z.string().optional(), message: z.string().optional(), pause: z.boolean().default(true) });

/** Every route, for the OpenAPI generator, the dashboard client, the CLI and MCP. */
export const ROUTES = {
  status:            { method: 'GET',   path: '/status' },
  pause:             { method: 'POST',  path: '/pause' },
  resume:            { method: 'POST',  path: '/resume' },
  properties:        { method: 'GET',   path: '/properties' },            // ?status&q&limit&before
  property:          { method: 'GET',   path: '/properties/:id' },
  contactProperty:   { method: 'POST',  path: '/properties/:id/contact' },
  skipProperty:      { method: 'POST',  path: '/properties/:id/skip' },
  applications:      { method: 'GET',   path: '/applications' },          // pipeline board
  withdrawAll:       { method: 'POST',  path: '/applications/withdraw-all' },
  tasks:             { method: 'GET',   path: '/tasks' },                 // ?state
  resolveTask:       { method: 'POST',  path: '/tasks/:id/resolve' },
  conversations:     { method: 'GET',   path: '/conversations' },
  conversation:      { method: 'GET',   path: '/conversations/:id' },
  sendMessage:       { method: 'POST',  path: '/conversations/:id/messages' },
  draft:             { method: 'POST',  path: '/draft' },
  viewings:          { method: 'GET',   path: '/viewings' },
  sources:           { method: 'GET',   path: '/sources' },
  patchSource:       { method: 'PATCH', path: '/sources/:id' },
  testSource:        { method: 'POST',  path: '/sources/:id/test' },
  connectSource:     { method: 'POST',  path: '/sources/:id/connect' },
  pollSource:        { method: 'POST',  path: '/sources/:id/poll' },
  config:            { method: 'GET',   path: '/config' },
  patchConfig:       { method: 'PATCH', path: '/config' },
  activity:          { method: 'GET',   path: '/activity' },              // ?since&types
  events:            { method: 'GET',   path: '/events' },                // SSE
  stats:             { method: 'GET',   path: '/stats' },
  documents:         { method: 'GET',   path: '/documents' },
  uploadDocument:    { method: 'POST',  path: '/documents' },
  deleteDocument:    { method: 'DELETE',path: '/documents/:name' },
  tenantProfilePdf:  { method: 'GET',   path: '/profile.pdf' },
  notifyTest:        { method: 'POST',  path: '/notify/test' },
  openapi:           { method: 'GET',   path: '/openapi.json' },
} as const;

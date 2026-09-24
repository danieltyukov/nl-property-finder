import { z } from 'zod';
import { API_PREFIX, ROUTES, ResolveTaskBody, SendMessageBody, DraftBody, ContactBody, SourcePatchBody, ConfigPatchBody, WithdrawAllBody } from '@nlpf/core';

const BODIES: Partial<Record<keyof typeof ROUTES, z.ZodType>> = {
  resolveTask: ResolveTaskBody,
  sendMessage: SendMessageBody,
  draft: DraftBody,
  contactProperty: ContactBody,
  patchSource: SourcePatchBody,
  patchConfig: ConfigPatchBody,
  withdrawAll: WithdrawAllBody,
};

const DESCRIPTIONS: Partial<Record<keyof typeof ROUTES, string>> = {
  status: 'Health of the agent: sources, mail, AI usage, counts for today.',
  pause: 'Stop automatic sending. Sources keep being read.',
  resume: 'Resume automatic sending.',
  properties: 'Homes the agent has seen, newest first. Query: status, q, limit, before.',
  property: 'One home with its listings on every source, the match, the application and viewings.',
  contactProperty: 'Contact a home now through the best channel. This messages a real person.',
  skipProperty: 'Mark a home as skipped so the agent never contacts it.',
  applications: 'Every pursuit by status, for the pipeline board.',
  withdrawAll: 'Politely withdraw every open application, for when you found a place. This messages real people.',
  tasks: 'The Action inbox. Query: state (open, snoozed, done, dismissed, active).',
  resolveTask: 'Act on an inbox item: done, dismiss, snooze, approve, reject, send_draft.',
  conversations: 'Conversations with landlords and agents, most recent first.',
  conversation: 'One conversation with every message.',
  sendMessage: 'Send (or with send=false, save as draft) a message in a conversation. This messages a real person.',
  draft: 'Draft a message for a home or a conversation without sending it.',
  viewings: 'Booked and proposed viewings.',
  sources: 'Every source with its health.',
  patchSource: 'Enable or disable a source, change its interval, contact mode or paid plan.',
  testSource: 'Run one search on a source now and return what it found, without storing it.',
  connectSource: 'Open a browser window to log in to a source. Returns immediately.',
  pollSource: 'Check a source now.',
  config: 'The configuration, without secrets. secretsPresent lists which secrets are set.',
  patchConfig: 'Replace one section of the configuration.',
  activity: 'The event log. Query: since (event id), types (comma separated).',
  events: 'Server-sent events: every change as it happens. Supports Last-Event-ID.',
  stats: 'Reaction times, reply rates per agency, message variants, freshness per source.',
  documents: 'Your documents and their sensitivity.',
  uploadDocument: 'Upload a document (multipart: file, sensitivity, kind).',
  deleteDocument: 'Delete a document.',
  tenantProfilePdf: 'Your one-page tenant profile as a PDF.',
  openapi: 'This document.',
};

/** OpenAPI 3.1 document generated from the shared route table and zod schemas. */
export function buildOpenApi(version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [name, route] of Object.entries(ROUTES) as [keyof typeof ROUTES, (typeof ROUTES)[keyof typeof ROUTES]][]) {
    const path = API_PREFIX + route.path.replace(/:(\w+)/g, '{$1}');
    const params = [...route.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const body = BODIES[name];
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = {
      operationId: name,
      summary: DESCRIPTIONS[name] ?? name,
      ...(params.length ? { parameters: params } : {}),
      ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(body, { io: 'input' }) } } } } : {}),
      responses: { '200': { description: 'OK' }, '400': { description: 'Invalid request' }, '401': { description: 'Missing or wrong token' } },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'nl-property-finder local API', version, description: 'The API of the agent running on this machine. Every request needs the X-NLPF-Token header.' },
    servers: [{ url: 'http://127.0.0.1:7431' }],
    components: { securitySchemes: { token: { type: 'apiKey', in: 'header', name: 'X-NLPF-Token' } } },
    security: [{ token: [] }],
    paths,
  };
}

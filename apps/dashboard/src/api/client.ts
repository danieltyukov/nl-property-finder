/*
 * The HTTP client. Every call goes through one transport that adds the
 * X-NLPF-Token header, turns the daemon's `{ error: { code, message } }` into an
 * ApiError, and builds paths from ROUTES so the dashboard can never drift from
 * the contract the daemon, the CLI and the MCP server share.
 */
import { createContext, useContext } from 'react';
import type {
  Conversation,
  ConversationView,
  Message,
  NlpfEvent,
  Page,
  PropertyView,
  StatsView,
  StatusView,
  Task,
  Viewing,
} from '@nlpf/core';
import {
  API_PREFIX,
  ROUTES,
  type ContactInput,
  type DraftInput,
  type ResolveTaskInput,
  type SendMessageInput,
  type SourcePatchInput,
  type WithdrawAllInput,
} from '../core';
import { apiToken } from '../env';
import type {
  ApplicationView,
  ConfigView,
  DocumentView,
  DraftResult,
  SourceView,
  TestSourceResult,
} from './views';

export interface Route {
  method: string;
  path: string;
}

/*
 * Routes the dashboard needs that ROUTES does not list yet. The daemon should
 * add them to core/api.ts; until then the path lives here, in one place.
 */
export const EXTRA_ROUTES = {
  notifyTest: { method: 'POST', path: '/notify/test' },
} as const satisfies Record<string, Route>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestInit_ {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  form?: FormData;
  accept?: 'json' | 'blob' | 'text';
}

export type Transport = (route: Route, init?: RequestInit_) => Promise<unknown>;

export function buildPath(route: Route, init: RequestInit_ = {}): string {
  let path = route.path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    const value = init.params?.[key];
    if (value === undefined) throw new Error(`Missing path parameter "${key}" for ${route.path}`);
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  path = `${API_PREFIX}${path}${qs ? `?${qs}` : ''}`;
  return path;
}

export function httpTransport(opts: { base?: string; token?: () => string; fetch?: typeof fetch } = {}): Transport {
  const base = opts.base ?? '';
  const token = opts.token ?? apiToken;
  return async (route, init = {}) => {
    const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const headers: Record<string, string> = { 'X-NLPF-Token': token() };
    let body: BodyInit | undefined;
    if (init.form) {
      body = init.form;
    } else if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    if ((init.accept ?? 'json') === 'json') headers.Accept = 'application/json';
    const small = typeof body === 'string' && body.length < 60_000;
    const res = await doFetch(`${base}${buildPath(route, init)}`, {
      method: route.method,
      headers,
      body,
      // keepalive lets an action committed while the tab closes still reach the daemon.
      keepalive: route.method !== 'GET' && small,
    });
    if (!res.ok) {
      let code = `http_${res.status}`;
      let message = res.statusText || `Request failed with status ${res.status}`;
      try {
        const data = (await res.json()) as { error?: { code?: string; message?: string } };
        if (data?.error?.message) message = data.error.message;
        if (data?.error?.code) code = data.error.code;
      } catch {
        // Not JSON. The status text is the best we have.
      }
      throw new ApiError(message, res.status, code);
    }
    if (init.accept === 'blob') return res.blob();
    if (init.accept === 'text') return res.text();
    if (res.status === 204) return undefined;
    const type = res.headers.get('content-type') ?? '';
    return type.includes('json') ? res.json() : res.text();
  };
}

export function createApi(t: Transport) {
  const call = <T>(route: Route, init?: RequestInit_) => t(route, init) as Promise<T>;
  const id = (value: string) => ({ id: value });
  return {
    status: () => call<StatusView>(ROUTES.status),
    pause: () => call<unknown>(ROUTES.pause),
    resume: () => call<unknown>(ROUTES.resume),
    properties: (query: { status?: string; q?: string; limit?: number; before?: string } = {}) =>
      call<Page<PropertyView> | PropertyView[]>(ROUTES.properties, { query }),
    property: (propertyId: string) => call<PropertyView>(ROUTES.property, { params: id(propertyId) }),
    contactProperty: (propertyId: string, body: ContactInput = {}) =>
      call<unknown>(ROUTES.contactProperty, { params: id(propertyId), body }),
    skipProperty: (propertyId: string) => call<unknown>(ROUTES.skipProperty, { params: id(propertyId) }),
    applications: () => call<Page<ApplicationView | PropertyView> | (ApplicationView | PropertyView)[]>(ROUTES.applications),
    withdrawAll: (body: WithdrawAllInput) => call<unknown>(ROUTES.withdrawAll, { body }),
    tasks: (query: { state?: string } = {}) => call<Page<Task> | Task[]>(ROUTES.tasks, { query }),
    resolveTask: (taskId: string, body: ResolveTaskInput) =>
      call<Task | undefined>(ROUTES.resolveTask, { params: id(taskId), body }),
    conversations: () => call<Page<Conversation> | Conversation[]>(ROUTES.conversations),
    conversation: (conversationId: string) =>
      call<ConversationView>(ROUTES.conversation, { params: id(conversationId) }),
    sendMessage: (conversationId: string, body: SendMessageInput) =>
      call<Message>(ROUTES.sendMessage, { params: id(conversationId), body }),
    draft: (body: DraftInput) => call<DraftResult>(ROUTES.draft, { body }),
    viewings: () => call<Page<Viewing> | Viewing[]>(ROUTES.viewings),
    sources: () => call<Page<SourceView> | SourceView[]>(ROUTES.sources),
    patchSource: (sourceId: string, body: SourcePatchInput) =>
      call<unknown>(ROUTES.patchSource, { params: id(sourceId), body }),
    testSource: (sourceId: string) => call<TestSourceResult>(ROUTES.testSource, { params: id(sourceId) }),
    connectSource: (sourceId: string) => call<unknown>(ROUTES.connectSource, { params: id(sourceId) }),
    pollSource: (sourceId: string) => call<unknown>(ROUTES.pollSource, { params: id(sourceId) }),
    config: () => call<ConfigView>(ROUTES.config),
    patchConfig: (section: string, value: unknown) =>
      call<ConfigView | undefined>(ROUTES.patchConfig, { body: { section, value } }),
    activity: (query: { since?: string; before?: string; types?: string; limit?: number } = {}) =>
      call<Page<NlpfEvent> | NlpfEvent[]>(ROUTES.activity, { query }),
    stats: () => call<StatsView>(ROUTES.stats),
    documents: () => call<Page<DocumentView> | DocumentView[]>(ROUTES.documents),
    uploadDocument: (form: FormData) => call<unknown>(ROUTES.uploadDocument, { form }),
    deleteDocument: (name: string) => call<unknown>(ROUTES.deleteDocument, { params: { name } }),
    tenantProfilePdf: () => call<Blob>(ROUTES.tenantProfilePdf, { accept: 'blob' }),
    notifyTest: () => call<unknown>(EXTRA_ROUTES.notifyTest),
  };
}

export type Api = ReturnType<typeof createApi>;

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi needs an <ApiContext.Provider>');
  return api;
}

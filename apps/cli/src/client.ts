import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import {
  API_PREFIX,
  ConfigPatchBody,
  ContactBody,
  DraftBody,
  ResolveTaskBody,
  ROUTES,
  SendMessageBody,
  SourcePatchBody,
  WithdrawAllBody,
  loadConfig,
  type Config,
  type Conversation,
  type ConversationView,
  type NlpfEvent,
  type Page,
  type Paths,
  type PropertyView,
  type SourceState,
  type StatsView,
  type StatusView,
  type Task,
  type Viewing,
} from '@nlpf/core';

/*
 * The CLI and the MCP server talk to the daemon only through this client.
 * Every request carries the API token from the data directory; a daemon that
 * does not answer becomes one clear message instead of a socket error.
 */

export type RouteName = keyof typeof ROUTES;
export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  params?: Record<string, string>;
  query?: Query;
  body?: unknown;
  timeoutMs?: number;
}

export class DaemonNotRunningError extends Error {
  readonly code = 'daemon_not_running';
  constructor(options?: { cause?: unknown }) {
    super('The agent is not running. Start it with nlpf on.', options);
    this.name = 'DaemonNotRunningError';
  }
}

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

/** `GET /config` answers with the config plus the names (never the values) of the secrets that are set. */
export type ConfigView = Config & { secretsPresent?: string[] };

export interface PropertyQuery {
  status?: string;
  q?: string;
  limit?: number;
  before?: string;
}

export interface NlpfClient {
  readonly baseUrl: string;
  request<T = unknown>(route: RouteName, opts?: RequestOptions): Promise<T>;
  status(): Promise<StatusView>;
  pause(): Promise<unknown>;
  resume(): Promise<unknown>;
  properties(query?: PropertyQuery): Promise<Page<PropertyView>>;
  property(id: string): Promise<PropertyView>;
  contactProperty(id: string, body?: z.input<typeof ContactBody>): Promise<unknown>;
  applications(): Promise<unknown>;
  withdrawAll(body: z.input<typeof WithdrawAllBody>): Promise<unknown>;
  tasks(query?: { state?: Task['state'] }): Promise<Page<Task>>;
  resolveTask(id: string, body: z.input<typeof ResolveTaskBody>): Promise<unknown>;
  conversations(): Promise<Page<Conversation>>;
  conversation(id: string): Promise<ConversationView>;
  sendMessage(id: string, body: z.input<typeof SendMessageBody>): Promise<unknown>;
  draft(body: z.input<typeof DraftBody>): Promise<unknown>;
  viewings(): Promise<Page<Viewing>>;
  sources(): Promise<Page<SourceState>>;
  patchSource(id: string, body: z.input<typeof SourcePatchBody>): Promise<unknown>;
  testSource(id: string): Promise<unknown>;
  connectSource(id: string): Promise<unknown>;
  config(): Promise<ConfigView>;
  patchConfig(body: z.input<typeof ConfigPatchBody>): Promise<unknown>;
  activity(query?: { since?: string; types?: string }): Promise<Page<NlpfEvent>>;
  stats(): Promise<StatsView>;
}

export interface ClientOptions {
  baseUrl: string;
  /** Read on every request, so a daemon started after the client was made is still found. Null means no token yet. */
  token: () => string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
// A source test runs a real search, sometimes through a browser.
const SOURCE_TEST_TIMEOUT_MS = 180_000;

function buildPath(route: RouteName, params: Record<string, string> = {}): string {
  const path = ROUTES[route].path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path parameter ${name} for ${route}`);
    return encodeURIComponent(value);
  });
  return API_PREFIX + path;
}

function buildQuery(query: Query = {}): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** Accepts either a bare array or a `Page`, so the CLI does not depend on which one a route returns. */
export function toPage<T>(value: unknown): Page<T> {
  if (Array.isArray(value)) return { items: value as T[] };
  if (value && typeof value === 'object' && Array.isArray((value as Page<T>).items)) return value as Page<T>;
  return { items: [] };
}

function isNetworkError(e: unknown): boolean {
  // Node's fetch reports refused and reset connections as a TypeError with the socket error as cause.
  return e instanceof TypeError && e.cause !== undefined;
}

export function createClient(opts: ClientOptions): NlpfClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;

  async function request<T = unknown>(route: RouteName, ro: RequestOptions = {}): Promise<T> {
    const token = opts.token();
    if (!token) throw new DaemonNotRunningError();
    const headers: Record<string, string> = { 'X-NLPF-Token': token, Accept: 'application/json' };
    let body: string | undefined;
    if (ro.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(ro.body);
    }
    const url = baseUrl + buildPath(route, ro.params) + buildQuery(ro.query);
    let res: Response;
    try {
      res = await doFetch(url, {
        method: ROUTES[route].method,
        headers,
        body,
        signal: AbortSignal.timeout(ro.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (e) {
      if (isNetworkError(e)) throw new DaemonNotRunningError({ cause: e });
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        throw new ApiError(`The agent did not answer ${ROUTES[route].path} in time.`, 0, 'timeout');
      }
      throw e;
    }
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
      const message =
        err?.message ??
        (res.status === 401
          ? 'The agent rejected the API token. Restart it with nlpf off and nlpf on.'
          : `The agent answered ${res.status} ${res.statusText}.`);
      throw new ApiError(message, res.status, err?.code ?? `http_${res.status}`);
    }
    return data as T;
  }

  const list = async <T>(route: RouteName, ro?: RequestOptions) => toPage<T>(await request(route, ro));

  return {
    baseUrl,
    request,
    status: () => request<StatusView>('status'),
    pause: () => request('pause'),
    resume: () => request('resume'),
    properties: (query = {}) => list<PropertyView>('properties', { query: { ...query } }),
    property: (id) => request<PropertyView>('property', { params: { id } }),
    contactProperty: async (id, body = {}) =>
      request('contactProperty', { params: { id }, body: ContactBody.parse(body) }),
    applications: () => request('applications'),
    withdrawAll: async (body) => request('withdrawAll', { body: WithdrawAllBody.parse(body) }),
    tasks: (query = {}) => list<Task>('tasks', { query: { ...query } }),
    resolveTask: async (id, body) => request('resolveTask', { params: { id }, body: ResolveTaskBody.parse(body) }),
    conversations: () => list<Conversation>('conversations'),
    conversation: (id) => request<ConversationView>('conversation', { params: { id } }),
    sendMessage: async (id, body) =>
      request('sendMessage', { params: { id }, body: SendMessageBody.parse(body) }),
    draft: async (body) => request('draft', { body: DraftBody.parse(body) }),
    viewings: () => list<Viewing>('viewings'),
    sources: () => list<SourceState>('sources'),
    patchSource: async (id, body) => request('patchSource', { params: { id }, body: SourcePatchBody.parse(body) }),
    testSource: (id) => request('testSource', { params: { id }, timeoutMs: SOURCE_TEST_TIMEOUT_MS }),
    connectSource: (id) => request('connectSource', { params: { id } }),
    config: () => request<ConfigView>('config'),
    patchConfig: async (body) => request('patchConfig', { body: ConfigPatchBody.parse(body) }),
    activity: (query = {}) => list<NlpfEvent>('activity', { query: { ...query } }),
    stats: () => request<StatsView>('stats'),
  };
}

/** Reads the API token the daemon wrote on its first start, or null when there is none yet. */
export function readToken(paths: Paths): string | null {
  try {
    const token = readFileSync(paths.tokenFile, 'utf8').trim();
    return token || null;
  } catch {
    return null;
  }
}

/** The daemon's address: `NLPF_URL` when set (demo daemons, tests), otherwise 127.0.0.1 and the configured port. */
export function daemonUrl(paths: Paths, env: NodeJS.ProcessEnv): string {
  if (env.NLPF_URL) return env.NLPF_URL.replace(/\/+$/, '');
  return `http://127.0.0.1:${loadConfig(paths).config.server.port}`;
}

export function clientFromPaths(paths: Paths, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): NlpfClient {
  return createClient({
    baseUrl: daemonUrl(paths, env),
    token: () => env.NLPF_TOKEN || readToken(paths),
    fetch: fetchImpl,
  });
}

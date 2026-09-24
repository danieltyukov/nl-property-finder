import type { FetchResult, Logger } from '@nlpf/core';
import { SourceBlockedError, SourceHttpError } from './errors.js';

/**
 * Major version used in the desktop user agent. Keep it close to current
 * stable Chrome: a UA that is years old stands out as much as a bot UA.
 */
export const CHROME_MAJOR = 151;

export const ACCEPT_LANGUAGE = 'nl-NL,nl;q=0.9,en;q=0.8';
const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7';

/** A desktop Chrome user agent in Chrome's reduced format, for the platform we run on. */
export function desktopUserAgent(platform: NodeJS.Platform = process.platform, major: number = CHROME_MAJOR): string {
  const os =
    platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export const DEFAULT_USER_AGENT = desktopUserAgent();

export type FetchInit = RequestInit & { timeoutMs?: number };
export type PoliteFetch = (url: string, init?: FetchInit) => Promise<FetchResult>;

export interface PoliteFetchOptions {
  /** Minimum time between the starts of two requests to the same host. Default 4000 ms. */
  minGapMs?: number;
  userAgent?: string;
  log: Logger;
  /** Clock in epoch milliseconds, for tests. */
  now?: () => number;
  /** Default per-request timeout. Default 20 s; `init.timeoutMs` overrides it per call. */
  timeoutMs?: number;
  /** How many URLs keep a cached body for conditional requests. Default 200. */
  cacheSize?: number;
  /** The underlying fetch, for tests. Default: global fetch. */
  fetchImpl?: typeof fetch;
}

interface CacheEntry {
  etag?: string;
  lastModified?: string;
  text: string;
  url: string;
}

const MAX_CACHED_BODY = 2_000_000;

/**
 * A fetch for polling other people's websites without being a nuisance:
 * requests to one host start at least `minGapMs` apart, repeated GETs are
 * conditional (If-None-Match / If-Modified-Since) so an unchanged page costs
 * the site a 304, headers look like a Dutch desktop browser, and refusals are
 * classified so the scheduler can back off. A host that answered with
 * `Retry-After` is not contacted again until that time has passed.
 */
export function createPoliteFetch(opts: PoliteFetchOptions): PoliteFetch {
  const gap = opts.minGapMs ?? 4000;
  const now = opts.now ?? Date.now;
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const defaultTimeout = opts.timeoutMs ?? 20_000;
  const cacheSize = opts.cacheSize ?? 200;
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const nextStart = new Map<string, number>();
  const blockedUntil = new Map<string, number>();
  const cache = new Map<string, CacheEntry>();

  return async (url, init = {}) => {
    const { timeoutMs = defaultTimeout, ...rest } = init;
    const host = new URL(url).host;
    const method = (rest.method ?? 'GET').toUpperCase();
    const callerSignal = rest.signal ?? undefined;
    callerSignal?.throwIfAborted();

    const until = blockedUntil.get(host);
    if (until !== undefined) {
      if (until > now()) {
        const retryAfterSec = Math.ceil((until - now()) / 1000);
        throw new SourceBlockedError(`${host} asked us to wait, ${retryAfterSec} s left`, { status: 429, retryAfterSec, url });
      }
      blockedUntil.delete(host);
    }

    // Reserve the next start slot for this host before waiting, so concurrent
    // callers queue up behind each other instead of starting together.
    const t = now();
    const start = Math.max(t, nextStart.get(host) ?? 0);
    nextStart.set(host, start + gap);
    if (start > t) await sleep(start - t, callerSignal);

    const headers = new Headers(rest.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', userAgent);
    if (!headers.has('accept-language')) headers.set('accept-language', ACCEPT_LANGUAGE);
    if (!headers.has('accept')) headers.set('accept', ACCEPT);

    const cacheable = method === 'GET' && rest.body == null;
    const cached = cacheable ? cache.get(url) : undefined;
    if (cached) {
      if (cached.etag && !headers.has('if-none-match')) headers.set('if-none-match', cached.etag);
      if (cached.lastModified && !headers.has('if-modified-since')) headers.set('if-modified-since', cached.lastModified);
    }

    const signals = [AbortSignal.timeout(timeoutMs)];
    if (callerSignal) signals.push(callerSignal);
    const started = now();
    let res: Response;
    let text: string;
    try {
      res = await fetchImpl(url, { ...rest, method, headers, signal: AbortSignal.any(signals) });
      text = await readText(res);
    } catch (e) {
      if (callerSignal?.aborted) throw callerSignal.reason ?? e;
      const err = e as Error;
      if (err.name === 'TimeoutError') {
        throw new SourceHttpError(`${method} ${url} timed out after ${timeoutMs} ms`, { status: 0, url, cause: e });
      }
      const detail = err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message;
      throw new SourceHttpError(`${method} ${url} failed: ${detail}`, { status: 0, url, cause: e });
    }
    opts.log.debug('fetch', { method, url, status: res.status, ms: now() - started });

    try {
      checkResponse({ status: res.status, headers: res.headers, text, url });
    } catch (e) {
      if (e instanceof SourceBlockedError) {
        if (e.retryAfterSec !== undefined) blockedUntil.set(host, now() + e.retryAfterSec * 1000);
        opts.log.warn('source refused the request', { url, status: e.status, marker: e.marker, retryAfterSec: e.retryAfterSec });
      }
      throw e;
    }

    const finalUrl = res.url || url;
    if (res.status === 304) {
      if (cached) {
        cache.delete(url);
        cache.set(url, cached);
      }
      return makeResult({ status: 304, url: cached?.url ?? finalUrl, headers: res.headers, text: cached?.text ?? '', notModified: true });
    }

    if (cacheable && res.status === 200) {
      const etag = res.headers.get('etag') ?? undefined;
      const lastModified = res.headers.get('last-modified') ?? undefined;
      cache.delete(url);
      if ((etag || lastModified) && text.length <= MAX_CACHED_BODY) {
        cache.set(url, { etag, lastModified, text, url: finalUrl });
        while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
      }
    }
    return makeResult({ status: res.status, url: finalUrl, headers: res.headers, text, notModified: false });
  };
}

export function makeResult(r: { status: number; url: string; headers: Headers; text: string; notModified: boolean }): FetchResult {
  return {
    ...r,
    json<T = unknown>(): T {
      try {
        return JSON.parse(r.text) as T;
      } catch (e) {
        throw new Error(`${r.url} did not return JSON (${(e as Error).message}); it starts with ${JSON.stringify(r.text.slice(0, 80))}`);
      }
    },
  };
}

/**
 * Throws the error the scheduler expects for a response: `SourceBlockedError`
 * for 403, 429, `cf-mitigated: challenge` or a challenge page, and
 * `SourceHttpError` for other statuses outside 2xx and 304.
 */
export function checkResponse(r: { status: number; headers: Headers; text: string; url: string }): void {
  const retryAfterSec = parseRetryAfter(r.headers.get('retry-after'));
  const blocked = (why: string, marker?: string) =>
    new SourceBlockedError(`${r.url} ${why}`, { status: r.status, retryAfterSec, marker, url: r.url });
  if (r.status === 403 || r.status === 429) throw blocked(`refused with HTTP ${r.status}`);
  if (r.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') throw blocked('returned a Cloudflare challenge', 'cf-mitigated');
  const marker = detectChallenge(r.text, r.headers.get('content-type') ?? undefined);
  if (marker) throw blocked(`returned a bot challenge page (${marker})`, marker);
  if (r.status === 304 || (r.status >= 200 && r.status < 300)) return;
  throw new SourceHttpError(`${r.url} returned HTTP ${r.status}`, { status: r.status, url: r.url });
}

/** `Retry-After` in seconds, from either a number of seconds or an HTTP date. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

const SMALL_PAGE = 20_000;
const CHALLENGE_TITLE =
  /<title[^>]*>[^<]*(just a moment|even geduld|attention required|access denied|verify you are human|are you a robot|ben je een robot|toegang geweigerd)[^<]*<\/title>/i;

/** True when the page loads a frame or script from DataDome's challenge host. */
function loadsFromDataDome(text: string): boolean {
  if (!/captcha-delivery/i.test(text)) return false;
  for (const m of text.matchAll(/\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) {
    let host: string;
    try {
      host = new URL(m[1]!, 'https://page.invalid/').hostname;
    } catch {
      continue;
    }
    if (host === 'captcha-delivery.com' || host.endsWith('.captcha-delivery.com')) return true;
  }
  return false;
}

/**
 * Names the bot-challenge marker in a page, or undefined for an ordinary
 * page. JSON bodies are never challenges. Cloudflare (`cf-chl`), PerimeterX
 * (`px-captcha`) and a frame or script served from DataDome's challenge host
 * count anywhere. The bare words "captcha" and "datadome" only count on a
 * small page, because ordinary pages load reCAPTCHA or the DataDome tag for
 * their forms. Adapters that read pages in a browser can call this on
 * `page.content()` too.
 */
export function detectChallenge(text: string, contentType?: string): string | undefined {
  if (contentType?.includes('json')) return undefined;
  const head = text.trimStart().slice(0, 1);
  if (!contentType && (head === '{' || head === '[')) return undefined;
  if (/cf[-_]chl/i.test(text)) return 'cf-chl';
  if (/px-captcha/i.test(text)) return 'px-captcha';
  if (loadsFromDataDome(text)) return 'datadome';
  if (CHALLENGE_TITLE.test(text.slice(0, 5000))) return 'challenge';
  if (text.length < SMALL_PAGE) {
    const stripped = text.replace(/g?recaptcha|hcaptcha/gi, '');
    if (/datadome/i.test(stripped)) return 'datadome';
    if (/captcha/i.test(stripped)) return 'captcha';
  }
  return undefined;
}

/** Decodes a body with the charset from the header or a `<meta charset>`; older agency sites still serve Latin-1. */
async function readText(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  let charset = /charset=["']?([\w.:-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.subarray(0, 2048));
    charset = /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset?.toLowerCase() ?? 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** Resolves after `ms`, or rejects with the signal's reason when it aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

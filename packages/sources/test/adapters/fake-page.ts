/**
 * A stand-in for a Playwright page, for adapter tests that read pages in a
 * browser: it serves fixture HTML per URL and never opens a browser or a
 * network connection. It implements only what the browser adapters use to
 * read pages (goto, content, url, response events, evaluate hooks).
 */
import type { Page } from 'playwright-core';
import type { BrowserSession } from '@nlpf/core';
import { readFixture } from '../../src/testing.js';

export interface FakeRoute {
  /** Fixture file, relative to packages/sources/fixtures/. */
  file?: string;
  html?: string;
  status?: number;
  /** Serve this URL's route instead, and report that URL as the page URL. */
  redirect?: string;
  /** Make `goto` throw this message, like a failed navigation ("net::ERR_NAME_NOT_RESOLVED"). */
  error?: string;
}

/** One route, or a sequence the page steps through on each look at its content (a challenge that clears, for example). */
export type FakeRouteSpec = string | FakeRoute | FakeRoute[];

export interface FakeBrowser {
  (opts?: { headed?: boolean }): Promise<BrowserSession>;
  /** Every URL a page was sent to, in order. */
  visits: string[];
  /** Options of every session opened. */
  sessions: { headed?: boolean }[];
  /** Sessions still open. */
  open(): number;
  /** Result for `page.evaluate` calls, by call order; the default returns undefined. */
  evaluate?: (fn: unknown, arg: unknown, page: FakePageState) => unknown;
}

export interface FakePageState {
  url: string;
  html: string;
  initScripts: number;
}

const htmlOf = (r: FakeRoute) => (r.file ? readFixture(r.file) : (r.html ?? ''));

export function fakeBrowser(routes: Record<string, FakeRouteSpec>): FakeBrowser {
  const visits: string[] = [];
  const sessions: { headed?: boolean }[] = [];
  let openCount = 0;

  const resolve = (url: string): { steps: FakeRoute[]; url: string } => {
    let spec = routes[url];
    let at = url;
    const seen = new Set<string>();
    for (;;) {
      if (spec === undefined) return { steps: [{ status: 404, html: '<!doctype html><title>Niet gevonden</title><h1>404</h1>' }], url: at };
      const steps = typeof spec === 'string' ? [{ file: spec }] : Array.isArray(spec) ? spec : [spec];
      const redirect = steps[0]?.redirect;
      if (!redirect || seen.has(redirect)) return { steps, url: at };
      seen.add(redirect);
      at = redirect;
      spec = routes[redirect];
    }
  };

  const browser = (async (opts?: { headed?: boolean }) => {
    sessions.push(opts ?? {});
    openCount += 1;
    const state: FakePageState = { url: 'about:blank', html: '', initScripts: 0 };
    let steps: FakeRoute[] = [];
    let step = 0;
    const listeners = new Map<string, Set<(arg: unknown) => void>>();
    const mainFrame = {};
    let closed = false;
    const emit = (event: string, arg: unknown) => {
      for (const l of listeners.get(event) ?? []) l(arg);
    };
    const current = () => steps[Math.min(step, steps.length - 1)] ?? {};
    const page = {
      async goto(url: string) {
        visits.push(url);
        const r = resolve(url);
        steps = r.steps;
        step = 0;
        if (steps[0]?.error) throw new Error(`page.goto: ${steps[0].error} at ${url}`);
        state.url = r.url;
        state.html = htmlOf(current());
        const status = current().status ?? 200;
        const response = {
          status: () => status,
          url: () => r.url,
          headers: () => ({}),
          frame: () => mainFrame,
          request: () => ({ isNavigationRequest: () => true, method: () => 'GET' }),
        };
        emit('response', response);
        return response;
      },
      async content() {
        const html = htmlOf(current());
        if (step < steps.length - 1) {
          step += 1;
          const status = current().status ?? 200;
          emit('response', {
            status: () => status,
            url: () => state.url,
            headers: () => ({}),
            frame: () => mainFrame,
            request: () => ({ isNavigationRequest: () => true, method: () => 'GET' }),
          });
        }
        state.html = html;
        return html;
      },
      url: () => state.url,
      mainFrame: () => mainFrame,
      on(event: string, fn: (arg: unknown) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)?.add(fn);
        return page;
      },
      off(event: string, fn: (arg: unknown) => void) {
        listeners.get(event)?.delete(fn);
        return page;
      },
      async addInitScript() {
        state.initScripts += 1;
      },
      async evaluate(fn: unknown, arg: unknown) {
        return browser.evaluate?.(fn, arg, state);
      },
      async title() {
        return /<title[^>]*>([^<]*)<\/title>/i.exec(state.html)?.[1] ?? '';
      },
      isClosed: () => closed,
      async close() {
        closed = true;
      },
      context: () => ({ cookies: async () => [] }),
    };
    let released = false;
    return {
      page: page as unknown as Page,
      close: async () => {
        if (!released) openCount -= 1;
        released = true;
        closed = true;
      },
    };
  }) as FakeBrowser;
  browser.visits = visits;
  browser.sessions = sessions;
  browser.open = () => openCount;
  return browser;
}

/*
 * What the page learns from the server that served it. The daemon (and the
 * mock server) inject `window.__NLPF__ = { token }` into index.html, so the
 * token never sits in the bundle or in local storage. The API is same-origin.
 * `tiles` is optional: false turns the map tiles off (tests), a string is a
 * Leaflet URL template for another tile server.
 */
declare global {
  interface Window {
    __NLPF__?: { token?: string; tiles?: string | false };
  }
}

export function apiToken(): string {
  return typeof window === 'undefined' ? '' : (window.__NLPF__?.token ?? '');
}

/** Absolute origin of the daemon, for links the user copies elsewhere (ICS, REST). */
export function apiOrigin(): string {
  return typeof window === 'undefined' ? 'http://127.0.0.1:7431' : window.location.origin;
}

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

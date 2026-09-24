import { trimTrailingSlashes } from '@nlpf/core';

export type FetchFn = typeof fetch;

/** Raised for a non-2xx answer. The message never contains the request URL, which may hold a bot token. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`HTTP ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'HttpError';
  }
}

/** fetch with a timeout; rejects on a non-2xx status with a short excerpt of the answer. */
export async function request(fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const res = await fetchFn(url, { ...init, signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(res.status, text.replace(/\s+/g, ' ').trim().slice(0, 200));
  }
  return res;
}

/**
 * A header value that survives HTTP: CR and LF are removed, and anything
 * outside printable ASCII is sent as an RFC 2047 encoded word, which ntfy
 * decodes.
 */
export function headerValue(s: string): string {
  const flat = s.replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${Buffer.from(flat, 'utf8').toString('base64')}?=`;
}

export const trimSlash = (s: string): string => trimTrailingSlashes(s);

/** Digits and a leading plus only, for tel: links. */
export const phoneForTel = (phone: string): string => phone.replace(/(?!^\+)[^\d]/g, '');

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

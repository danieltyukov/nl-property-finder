/**
 * Errors every adapter and the scheduler agree on. The scheduler backs off on
 * `SourceBlockedError`, marks the source `needs_login` on `NeedsLoginError`,
 * and counts `SourceHttpError` as an ordinary failure.
 */

/** The site refused us: HTTP 403 or 429, or a bot challenge page. */
export class SourceBlockedError extends Error {
  override readonly name = 'SourceBlockedError';
  /** HTTP status of the refusing response (200 when a challenge page came back with 200). */
  readonly status: number;
  /** Seconds the site asked us to wait (from `Retry-After`), when it said so. */
  readonly retryAfterSec?: number;
  /** Which challenge marker matched, when the block was detected from page content. */
  readonly marker?: string;
  readonly url?: string;

  constructor(message: string, opts: { status: number; retryAfterSec?: number; marker?: string; url?: string; cause?: unknown }) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.status = opts.status;
    if (opts.retryAfterSec !== undefined) this.retryAfterSec = opts.retryAfterSec;
    if (opts.marker !== undefined) this.marker = opts.marker;
    if (opts.url !== undefined) this.url = opts.url;
  }
}

/** Any other failed request. `status` is 0 when no response arrived (timeout, DNS, refused connection). */
export class SourceHttpError extends Error {
  override readonly name = 'SourceHttpError';
  readonly status: number;
  readonly url?: string;

  constructor(message: string, opts: { status: number; url?: string; cause?: unknown }) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.status = opts.status;
    if (opts.url !== undefined) this.url = opts.url;
  }
}

/** The action needs a logged-in session that we do not have (or that expired). */
export class NeedsLoginError extends Error {
  override readonly name = 'NeedsLoginError';
  readonly loginUrl?: string;

  constructor(message = 'login required', opts: { loginUrl?: string; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    if (opts.loginUrl !== undefined) this.loginUrl = opts.loginUrl;
  }
}

/** No Chromium or Chrome executable could be found for the browser pool. */
export class BrowserUnavailableError extends Error {
  override readonly name = 'BrowserUnavailableError';
}

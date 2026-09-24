/*
 * Links that come from outside (listing URLs, portal links in task payloads,
 * agency homepages) are untrusted text. A "javascript:" URL in one of them
 * would run in this page, which holds the API token, so only web, mail and
 * phone links are ever rendered as hrefs.
 */
const ALLOWED = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function safeHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, 'https://invalid.example/');
    if (!ALLOWED.has(url.protocol)) return undefined;
    // Relative input resolves against the placeholder base; that is not a real link.
    if (url.hostname === 'invalid.example') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

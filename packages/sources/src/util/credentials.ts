/**
 * Credential shapes that must never land in a committed file. A recorded page
 * carries the site's own keys (Rotsvast puts a Google Maps browser key in a
 * data attribute, Huurzone one in a static map URL), and GitHub's secret
 * scanning reports those as leaks even though the site publishes them. The
 * recorder runs every saved page through scrubCredentials, and a unit test
 * scans the repository with the same list.
 *
 * Each replacement keeps the prefix readable and cannot match its own pattern,
 * so scrubbing twice changes nothing.
 */
export const CREDENTIAL_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{35}/g, replacement: 'AIza-redacted' },
  { name: 'Anthropic API key', pattern: /sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/g, replacement: 'sk-ant-redacted' },
  { name: 'OpenAI project key', pattern: /sk-proj-[A-Za-z0-9_-]{40,}/g, replacement: 'sk-proj-redacted' },
  { name: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g, replacement: 'gh-redacted' },
  { name: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: 'AKIA-redacted' },
  { name: 'Slack token', pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g, replacement: 'xox-redacted' },
  { name: 'Stripe live key', pattern: /\b[rs]k_live_[0-9A-Za-z]{20,}/g, replacement: 'sk_live_redacted' },
  { name: 'Mapbox secret token', pattern: /\bsk\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, replacement: 'sk.redacted' },
  { name: 'Telegram bot token', pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g, replacement: 'telegram-redacted' },
  {
    name: 'private key',
    pattern: /-----BEGIN ((?:[A-Z]+ )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    replacement: '-----REDACTED PRIVATE KEY-----',
  },
];

export interface CredentialHit {
  name: string;
  /** 1-based line of the match. */
  line: number;
  /** The first characters of the match, enough to find it without repeating it. */
  preview: string;
}

/** Every credential-shaped string in the text. */
export function findCredentials(text: string): CredentialHit[] {
  const hits: CredentialHit[] = [];
  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ name, line, preview: `${m[0].slice(0, 8)}...` });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** The text with every credential-shaped string replaced by a placeholder. */
export function scrubCredentials(text: string): string {
  let out = text;
  for (const { pattern, replacement } of CREDENTIAL_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Trimming without regular expressions. `s.replace(/\/+$/, '')` looks linear
 * but is quadratic: on a long run of slashes followed by anything else, the
 * engine retries the run from every starting position. These walk the string
 * once.
 */

const isSpace = (ch: string): boolean => ch.trim() === '';

/** The string without trailing characters from `chars` (and whitespace, when `spaces` is set). */
export function trimCharsEnd(s: string, chars: string, spaces = false): string {
  let end = s.length;
  while (end > 0) {
    const ch = s[end - 1]!;
    if (!chars.includes(ch) && !(spaces && isSpace(ch))) break;
    end--;
  }
  return s.slice(0, end);
}

/** The string without leading or trailing characters from `chars` (and whitespace, when `spaces` is set). */
export function trimChars(s: string, chars: string, spaces = false): string {
  const end = trimCharsEnd(s, chars, spaces).length;
  let start = 0;
  while (start < end) {
    const ch = s[start]!;
    if (!chars.includes(ch) && !(spaces && isSpace(ch))) break;
    start++;
  }
  return s.slice(start, end);
}

/** "https://example.nl///" -> "https://example.nl". */
export const trimTrailingSlashes = (s: string): string => trimCharsEnd(s, '/');

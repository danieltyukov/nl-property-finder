import { describe, expect, test } from 'vitest';
import { trimChars, trimCharsEnd, trimTrailingSlashes } from '../src/index.js';

describe('trimming', () => {
  test('trailing slashes, and nothing else', () => {
    expect(trimTrailingSlashes('https://example.nl///')).toBe('https://example.nl');
    expect(trimTrailingSlashes('https://example.nl/a/b')).toBe('https://example.nl/a/b');
    expect(trimTrailingSlashes('///')).toBe('');
    expect(trimTrailingSlashes('')).toBe('');
  });

  test('a set of characters, with or without whitespace', () => {
    expect(trimCharsEnd('12 maart, ', ',.', true)).toBe('12 maart');
    expect(trimCharsEnd('12 maart, ', ',.')).toBe('12 maart, ');
    expect(trimChars(' , Delft ,', ',', true)).toBe('Delft');
    expect(trimChars('\t\n', ',', true)).toBe('');
  });

  test('stays fast on the inputs that make the regular expression quadratic', () => {
    const slashes = `${'/'.repeat(200_000)}x`;
    const spaces = `${' ,'.repeat(100_000)}x`;
    const t0 = performance.now();
    expect(trimTrailingSlashes(slashes)).toBe(slashes);
    expect(trimChars(spaces, ',', true)).toBe('x');
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

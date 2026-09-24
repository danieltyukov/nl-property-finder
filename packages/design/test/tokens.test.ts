import { readFileSync, existsSync } from 'node:fs';
import { expect, test } from 'vitest';

const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const block = (re: RegExp) => (css.match(re)?.[1] ?? '').replace(/\s+/g, ' ').trim();

test('the media-query dark block and the explicit dark block are identical', () => {
  const media = block(/:root:not\(\[data-theme='light'\]\)\s*\{([^}]*)\}/);
  const explicit = block(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/);
  expect(media.length).toBeGreaterThan(200);
  expect(media).toBe(explicit);
});

test('every token the dashboard and site rely on exists', () => {
  for (const name of ['--bg', '--surface', '--text', '--muted', '--accent-text', '--st-needs-you', '--grad-dusk', '--bleed', '--font-display', '--font-mono', '--ease-out', '--r-md']) {
    expect(css).toContain(`${name}:`);
  }
});

test('the fonts and logo files exist', () => {
  for (const f of ['../fonts.css', '../logo/mark.svg', '../logo/mark-color.svg', '../logo/favicon.svg', '../logo/app-icon.svg']) {
    expect(existsSync(new URL(f, import.meta.url))).toBe(true);
  }
});

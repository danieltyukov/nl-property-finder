import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/*
 * The copy rules as a test. The page is read as source, the way a reviewer
 * would: every line of index.html, and every source file of the site for the
 * rules that also apply to comments.
 */
const site = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(site, 'index.html'), 'utf8');
/** What a reader sees: no scripts, styles, comments or tags. */
const visible = html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|css|json|html)$/.test(name) ? [p] : [];
  });
}
const files = [join(site, 'index.html'), ...sources(join(site, 'src')), ...sources(join(site, 'scripts')), ...sources(join(site, 'test'))];

// Written as escapes so this file does not contain the characters it looks for.
const DASHES = new RegExp('[\\u2013\\u2014]');
const EMOJI = new RegExp('\\p{Extended_Pictographic}|\\uFE0F', 'u');
const BANNED = ['unlock', 'supercharge', 'seamless', 'effortless', 'game-changer', 'ai-powered', "isn't just", 'not only', "whether you're", 'revolutionise'];

describe('copy rules', () => {
  test('no em dash or en dash anywhere in the site source', () => {
    for (const f of files) expect({ f, bad: DASHES.test(readFileSync(f, 'utf8')) }).toEqual({ f, bad: false });
  });

  test('no emoji code points', () => {
    for (const f of files) expect({ f, bad: EMOJI.test(readFileSync(f, 'utf8')) }).toEqual({ f, bad: false });
  });

  test('none of the banned phrases', () => {
    const text = html.toLowerCase();
    for (const phrase of BANNED) expect(text, phrase).not.toContain(phrase);
  });

  test('no questions in the copy, rhetorical or otherwise', () => {
    expect(visible).not.toContain('?');
  });

  test('no exclamation marks in the copy', () => {
    expect(visible).not.toContain('!');
  });

  test('the fine print is exact', () => {
    expect(visible).toContain('MIT licence. Node 22.12 or newer. No account, no server.');
  });

  test('the reaction-time claim appears once, in the marked span, as a target', () => {
    expect(html.match(/within a minute/g)).toHaveLength(1);
    expect(html).toMatch(/<span data-claim="reaction">aims to [^<]*within a minute<\/span>/);
  });

  test('samples are labelled as samples', () => {
    expect(visible).toContain('Addresses are made up.');
    expect(visible).toContain('Sample run.');
    expect(visible).toContain('A sample day.');
  });

  test('footer credits the fonts, GSAP with its licence link, and three.js', () => {
    expect(visible).toContain('SIL Open Font License 1.1');
    expect(html).toContain('href="https://gsap.com/standard-license"');
    expect(visible).toMatch(/three\.js, under the MIT licence/);
    expect(visible).toContain('This page makes no third-party requests and sets no cookie.');
  });

  test('all 21 MCP tools are listed by their real names', () => {
    const tools = [...html.matchAll(/<li>([a-z_]+)<\/li>/g)].map((m) => m[1]);
    expect(tools).toHaveLength(21);
    expect(tools).toContain('withdraw_all');
    expect(tools).toContain('list_tasks');
  });
});

describe('markup', () => {
  test('every img has width, height and alt', () => {
    const imgs = html.match(/<img\b[^>]*>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(10);
    for (const img of imgs) {
      expect(img, img).toMatch(/\swidth="\d+"/);
      expect(img, img).toMatch(/\sheight="\d+"/);
      expect(img, img).toMatch(/\salt="[^"]*"/);
    }
  });

  test('one h1, and every section is labelled by a heading that exists', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const labels = [...html.matchAll(/<(?:section|footer)\b[^>]*aria-labelledby="([^"]+)"/g)].map((m) => m[1]!);
    expect(labels.length).toBe(10);
    for (const id of labels) expect(html, id).toMatch(new RegExp(`<h[12][^>]*id="${id}"`));
  });

  test('ten keyed sections, K0 to K9', () => {
    const keys = [...html.matchAll(/\sdata-key="(\d)"/g)].map((m) => Number(m[1]));
    expect(keys).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('no third-party resources: everything the page loads is on its own origin', () => {
    const loads = [...html.matchAll(/<(?:img|source|script|link)\b[^>]*?\s(?:src|srcset|href)="([^"]+)"/g)].map((m) => m[1]!);
    const tags = html.match(/<link\b[^>]*>/g) ?? [];
    const canonical = tags.filter((t) => /rel="canonical"/.test(t)).map((t) => /href="([^"]+)"/.exec(t)?.[1]);
    for (const url of loads.filter((u) => !canonical.includes(u))) expect(url, url).toMatch(/^(\/|\.\.\/)/);
  });

  test('the theme and motion keys follow the owner pattern', () => {
    expect(html).toContain("localStorage.getItem('nlpf-theme')");
    expect(html).toContain("localStorage.getItem('nlpf-motion')");
    expect(html).toMatch(/<button type="button" class="toggle js-only" id="theme" aria-pressed="false">/);
  });

  test('skip link first, main focusable', () => {
    expect(html).toMatch(/<body>\s*<a class="skip" href="#main">Skip to content<\/a>/);
    expect(html).toContain('<main id="main" tabindex="-1">');
  });
});

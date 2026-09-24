import { expect, test } from 'vitest';
import { desktopUserAgent, freeDisplayNumber, profileDirName, resolveChromium } from '../src/index.js';

const env = { PLAYWRIGHT_BROWSERS_PATH: '/nonexistent-cache' } as NodeJS.ProcessEnv;

test('an explicit executablePath wins, and only when it exists', () => {
  expect(resolveChromium({ executablePath: '/opt/chrome', exists: (p) => p === '/opt/chrome', env, platform: 'linux' })).toBe('/opt/chrome');
  expect(resolveChromium({ executablePath: '/opt/chrome', exists: () => false, env, platform: 'linux' })).toBeUndefined();
});

test("Playwright's cache comes before PLAYWRIGHT_CHROMIUM_EXECUTABLE, which comes before system Chrome", () => {
  const all = new Set(['/pw/chromium-1243/chrome-linux64/chrome', '/env/chrome', '/usr/bin/google-chrome']);
  const exists = (p: string) => all.has(p);
  const withEnv = { ...env, PLAYWRIGHT_CHROMIUM_EXECUTABLE: '/env/chrome' };
  const pw = () => '/pw/chromium-1243/chrome-linux64/chrome';
  expect(resolveChromium({ env: withEnv, exists, platform: 'linux', playwrightPath: pw })).toBe('/pw/chromium-1243/chrome-linux64/chrome');
  all.delete('/pw/chromium-1243/chrome-linux64/chrome');
  expect(resolveChromium({ env: withEnv, exists, platform: 'linux', playwrightPath: pw })).toBe('/env/chrome');
  all.delete('/env/chrome');
  expect(resolveChromium({ env: withEnv, exists, platform: 'linux', playwrightPath: pw })).toBe('/usr/bin/google-chrome');
  all.clear();
  expect(resolveChromium({ env: withEnv, exists, platform: 'linux', playwrightPath: pw })).toBeUndefined();
});

test('freeDisplayNumber skips numbers with a lock file or a socket', () => {
  const taken = new Set(['/tmp/.X99-lock', '/tmp/.X11-unix/X100', '/tmp/.X101-lock']);
  expect(freeDisplayNumber(99, 110, (p) => taken.has(p))).toBe(102);
  expect(freeDisplayNumber(99, 101, (p) => taken.has(p))).toBeUndefined();
});

test('user agents and profile folder names', () => {
  expect(desktopUserAgent('linux', 150)).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36');
  expect(desktopUserAgent('darwin')).toContain('Macintosh');
  expect(desktopUserAgent('win32')).toContain('Windows NT 10.0');
  expect(profileDirName('agency:de-gracht')).toBe('agency_de-gracht');
  expect(profileDirName('ogonline:verra.nl')).toBe('ogonline_verra.nl');
  expect(profileDirName('../../etc')).toBe('.._.._etc');
});

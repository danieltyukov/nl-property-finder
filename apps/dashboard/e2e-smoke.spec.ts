/*
 * Smoke test of the built dashboard against the mock daemon, in a real
 * browser. It starts the mock server itself (building the dashboard first
 * when dist/ is missing), with map tiles off so nothing leaves 127.0.0.1.
 *
 *   npx playwright test apps/dashboard/e2e-smoke.spec.ts
 *
 * The full product walkthrough against the real daemon is e2e/tests
 * (Task 15); this file only proves the dashboard itself holds together.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NLPF_SMOKE_PORT ?? 7439);
const BASE = `http://127.0.0.1:${PORT}`;
const PAGES: [string, RegExp][] = [
  ['/', /things? need you\.$|^Nothing needs you\.$/],
  ['/overview', /^How the search is going\.$/],
  ['/properties', /^Every home the agent has seen\.$/],
  ['/applications', /^Everything the agent is pursuing\.$/],
  ['/conversations', /^Every message, sent and received\.$/],
  ['/viewings', /viewings? ahead\.$|^No viewings planned\.$/],
  ['/sources', /sources on\.$/],
  ['/search', /^What the agent looks for\.$/],
  ['/profile', /^Who the agent writes as\.$/],
  ['/automation', /^How much the agent does alone\.$/],
  ['/settings', /^Settings$/],
  ['/activity', /^What the agent did on its own\.$/],
];

let server: ChildProcess | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!existsSync(join(DIR, 'dist', 'index.html'))) {
    const built = spawnSync('npx', ['vite', 'build'], { cwd: DIR, stdio: 'inherit' });
    if (built.status !== 0) throw new Error('vite build failed');
  }
  server = spawn(process.execPath, ['--import', 'tsx', 'src/mock/server.ts'], {
    cwd: DIR,
    env: { ...process.env, NLPF_MOCK_PORT: String(PORT), NLPF_MOCK_EVERY_MS: '1500', NLPF_MOCK_TILES: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mock server did not start')), 20_000);
    server!.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('nlpf mock daemon on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server!.on('exit', (code) => reject(new Error(`mock server exited with ${code}`)));
  });
});

test.afterAll(() => {
  server?.kill();
});

test.beforeEach(async ({ page }) => {
  await fetch(`${BASE}/_mock/reset`, { method: 'POST' });
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      // Storage refused; the tests do not depend on it.
    }
  });
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('every page renders its heading without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  for (const [path, heading] of PAGES) {
    await page.goto(`${BASE}${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  }
  expect(errors).toEqual([]);
});

test('the inbox acts on A and offers undo', async ({ page }) => {
  await page.goto(BASE);
  const first = page.getByRole('article').first();
  await expect(first.getByRole('heading', { level: 3 })).toHaveText(/^Viewing booked/);
  await first.focus();
  await page.keyboard.press('a');
  const toast = page.getByRole('region', { name: 'Notifications' });
  await expect(toast.getByText(/^Viewing confirmed:/)).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('article').first().getByRole('heading', { level: 3 })).toHaveText(/^Viewing booked/);
});

test('the pause switch pauses the agent and the header says so', async ({ page }) => {
  await page.goto(BASE);
  const banner = page.getByRole('banner');
  await banner.getByRole('button', { name: 'Pause' }).click();
  await expect(banner.getByTestId('agent-status')).toHaveText('Paused');
  await banner.getByRole('button', { name: 'Resume' }).click();
  await expect(banner.getByTestId('agent-status')).not.toHaveText('Paused');
});

test('the live feed gains rows from the event stream', async ({ page }) => {
  await page.goto(BASE);
  const feed = page.getByRole('list', { name: 'Agent events, newest first' });
  await expect(feed).toBeVisible();
  const before = await feed.getByRole('listitem').count();
  await expect.poll(async () => feed.getByRole('listitem').count(), { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(feed.locator('[data-type="listing.new"]').first()).toBeVisible();
});

test('Ctrl K opens the palette and goes to a page', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill('overview');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How the search is going.');
});

test('the theme toggle switches and remembers dark mode', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Dark mode' });
  const before = await toggle.getAttribute('aria-pressed');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  const stored = await page.evaluate(() => localStorage.getItem('nlpf-theme'));
  expect(stored).toBe(before === 'true' ? 'light' : 'dark');
});

test('I found a place previews the withdrawals and pauses', async ({ page }) => {
  await page.goto(`${BASE}/applications`);
  await page.getByRole('button', { name: 'I found a place' }).click();
  const dialog = page.getByRole('dialog', { name: 'I found a place' });
  const previews = dialog.getByRole('list', { name: 'Withdrawal previews' }).getByRole('listitem');
  await expect(previews.first()).toBeVisible();
  const count = await previews.count();
  await dialog.getByRole('button', { name: new RegExp(`^Withdraw ${count} applications?$`) }).click();
  await expect(page.getByRole('banner').getByTestId('agent-status')).toHaveText('Paused');
});

test('the first-run wizard shows for an empty profile and finishes', async ({ page }) => {
  await fetch(`${BASE}/_mock/reset?fresh=1`, { method: 'POST' });
  await page.goto(BASE);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who is looking?');
  await page.getByLabel('First name').fill('Sam');
  await page.getByLabel('Last name').fill('de Vries');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox', { name: 'Delft' }).check();
  await page.getByRole('checkbox', { name: 'Rotterdam' }).check();
  await page.getByLabel('Maximum rent (EUR)').fill('1400');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Which sites, and how?');
  await page.getByRole('checkbox', { name: /contact landlords on Funda automatically/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ready to start.');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/needs? you\.$/);
  const config = await (await fetch(`${BASE}/api/v1/config`, { headers: { 'X-NLPF-Token': 'mock-token' } })).json();
  expect(config.profile.firstName).toBe('Sam');
  expect(config.sources.funda.termsAcknowledgedAt).toBeTruthy();
});

test('no page scrolls sideways on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  for (const [path] of PAGES) {
    await page.goto(`${BASE}${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
  await context.close();
});

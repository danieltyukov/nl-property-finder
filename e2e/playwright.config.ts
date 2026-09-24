import { defineConfig, devices } from '@playwright/test';

/*
 * Two projects.
 *
 * `site` serves the built project site with `vite preview` under the same base
 * path GitHub Pages uses, and checks it the way a visitor meets it: phone and
 * desktop, both themes, reduced motion, and no JavaScript at all.
 *
 * `walkthrough` starts the whole product in demo mode (the daemon against the
 * sandbox, the fake rental market) and drives the dashboard through every
 * feature. It never touches the internet: the sandbox is on 127.0.0.1 and map
 * tiles are switched off.
 */
const SITE_PORT = 4174;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './test-results',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'site',
      testMatch: /site\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${SITE_PORT}/nl-property-finder/` },
    },
    {
      name: 'walkthrough',
      testMatch: /(walkthrough|cli)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, video: process.env.NLPF_RECORD ? 'on' : 'retain-on-failure' },
    },
  ],
  webServer: [
    {
      command: `npm run preview -w @nlpf/site -- --port ${SITE_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${SITE_PORT}/nl-property-finder/`,
      cwd: '..',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

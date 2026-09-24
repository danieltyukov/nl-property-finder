import { defineConfig } from 'vitest/config';

// Two projects. Unit tests run anywhere with no network. Integration tests
// start the sandbox, the daemon and a GreenMail container, so they run
// serially with generous timeouts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'site/test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'dashboard',
          include: ['apps/dashboard/src/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.int.test.ts', 'apps/*/test/**/*.int.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema, createEventBus, memoryLogger, openStore, resolvePaths, type Config } from '@nlpf/core';
import type { DaemonActions, DaemonContext } from '../src/context.js';

export const TOKEN = 'a'.repeat(64);

export function fakeContext(over: Partial<DaemonContext> = {}): DaemonContext {
  const paths = resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-daemon-')) });
  const store = openStore(':memory:');
  let config: Config = ConfigSchema.parse({});
  const actions = new Proxy({} as DaemonActions, {
    get: (_t, name) => () => {
      throw new Error(`action ${String(name)} not stubbed`);
    },
  });
  return {
    version: '0.1.0-test',
    startedAt: '2026-09-24T10:00:00.000Z',
    demo: false,
    paths,
    port: 7431,
    token: TOKEN,
    store,
    bus: createEventBus(store),
    log: memoryLogger(),
    config: () => config,
    secrets: () => ({ ANTHROPIC_API_KEY: 'sk-ant-secret-value-123' }),
    updateConfig: (section, value) => (config = ConfigSchema.parse({ ...config, [section]: value })),
    mailStatus: () => ({ connected: false }),
    ai: () => ({ provider: 'rules', usageThisMonth: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0 } }),
    nextPollAt: () => undefined,
    actions,
    ...over,
  };
}

export const req = (path: string, init: RequestInit & { token?: string | null; host?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set('host', init.host ?? '127.0.0.1:7431');
  if (init.token !== null) headers.set('x-nlpf-token', init.token ?? TOKEN);
  return new Request(`http://127.0.0.1:7431${path}`, { ...init, headers });
};

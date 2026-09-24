import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';

/**
 * The whole product in demo mode: `nlpf demo` as a real child process, the
 * daemon talking to the sandbox (a fake rental platform, a fake estate agent
 * and landlords who answer). Nothing leaves 127.0.0.1: map tiles are off and
 * the demo never geocodes.
 */
export interface Demo {
  url: string;
  token: string;
  sandbox: string;
  home: string;
  /** Calls the daemon's API with the token. */
  api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  /** Calls the sandbox's control API. */
  control<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  /** Polls until `check` returns something truthy. */
  until<T>(check: () => Promise<T | undefined | null | false>, what: string, ms?: number): Promise<T>;
}

const ROOT = resolve(import.meta.dirname, '..', '..');

async function waitForOk(url: string, headers: Record<string, string>, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not come up`);
}

export async function startDemo(opts: { port: number; sandboxPort: number; blank?: boolean; env?: Record<string, string> }): Promise<Demo & { stop(): Promise<void>; child: ChildProcess }> {
  const home = mkdtempSync(join(tmpdir(), 'nlpf-e2e-'));
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'apps/cli/src/main.ts'), 'demo', '--port', String(opts.port), '--sandbox-port', String(opts.sandboxPort), '--no-open'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NLPF_HOME: home,
        NLPF_TILES: '0',
        NLPF_DEMO_DRIP: '0',
        NLPF_DEMO_SPEED: '20',
        ...(opts.blank ? { NLPF_DEMO_BLANK: '1' } : {}),
        ...opts.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  child.stdout?.on('data', (d) => (log += String(d)));
  child.stderr?.on('data', (d) => (log += String(d)));
  const tokenFile = join(home, 'data', 'api-token');
  const end = Date.now() + 60_000;
  while (!existsSync(tokenFile) && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
  if (!existsSync(tokenFile)) throw new Error(`the demo did not start:\n${log}`);
  const token = readFileSync(tokenFile, 'utf8').trim();
  const url = `http://127.0.0.1:${opts.port}`;
  const sandbox = `http://127.0.0.1:${opts.sandboxPort}`;
  await waitForOk(`${url}/api/v1/status`, { 'x-nlpf-token': token }, 30_000);

  const call = async <T>(base: string, path: string, headers: Record<string, string>, init: { method?: string; body?: unknown } = {}) => {
    const r = await fetch(base + path, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { ...headers, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  };

  return {
    url,
    token,
    sandbox,
    home,
    child,
    api: (path, init) => call(url, `/api/v1${path}`, { 'x-nlpf-token': token }, init),
    control: (path, init) => call(sandbox, `/_control${path}`, {}, init),
    async until(check, what, ms = 30_000) {
      const stop = Date.now() + ms;
      let last: unknown;
      while (Date.now() < stop) {
        last = await check();
        if (last) return last as never;
        await new Promise((r) => setTimeout(r, 300));
      }
      throw new Error(`timed out waiting for ${what}\n--- daemon log tail ---\n${log.split('\n').slice(-30).join('\n')}`);
    },
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((r) => {
          const t = setTimeout(() => (child.kill('SIGKILL'), r()), 8000);
          child.once('exit', () => (clearTimeout(t), r()));
        });
      }
    },
  };
}

export const test = base.extend<{ demo: Demo }, { demoWorker: Demo & { stop(): Promise<void> } }>({
  demoWorker: [
    async ({}, use) => {
      const d = await startDemo({ port: 7491, sandboxPort: 7492, blank: true });
      await use(d);
      await d.stop();
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  demo: async ({ demoWorker }, use) => use(demoWorker),
});

export { expect };

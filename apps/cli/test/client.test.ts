import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { ConfigSchema, resolvePaths, saveConfig } from '@nlpf/core';
import { ApiError, DaemonNotRunningError, clientFromPaths, createClient } from '../src/client.js';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = undefined;
});

/** A tiny stand-in for the daemon: records every request and answers from `reply`. */
async function fakeDaemon(
  reply: (seen: Seen) => { status?: number; json?: unknown } = () => ({ json: { ok: true } }),
): Promise<{ url: string; port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const s: Seen = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      seen.push(s);
      const r = reply(s);
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(r.json === undefined ? '' : JSON.stringify(r.json));
    });
  });
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', () => done()));
  const port = (server!.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, port, seen };
}

async function closedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((done) => s.listen(0, '127.0.0.1', () => done()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((done) => s.close(() => done()));
  return port;
}

describe('createClient', () => {
  test('sends the API token in X-NLPF-Token on every request', async () => {
    const d = await fakeDaemon(() => ({ json: { version: '0.1.0', paused: false } }));
    const client = createClient({ baseUrl: d.url, token: () => 'secret-token-123' });
    const status = await client.status();
    expect(status).toMatchObject({ version: '0.1.0' });
    expect(d.seen[0]?.method).toBe('GET');
    expect(d.seen[0]?.url).toBe('/api/v1/status');
    expect(d.seen[0]?.headers['x-nlpf-token']).toBe('secret-token-123');
    expect(d.seen[0]?.headers.host).toBe(`127.0.0.1:${d.port}`);
  });

  test('fills path parameters, drops empty query values and sends JSON bodies', async () => {
    const d = await fakeDaemon(() => ({ json: {} }));
    const client = createClient({ baseUrl: d.url, token: () => 't0ken' });
    await client.resolveTask('t_1/2', { action: 'dismiss' });
    await client.properties({ q: 'Oude Delft', status: undefined, limit: 5 });
    expect(d.seen[0]?.method).toBe('POST');
    expect(d.seen[0]?.url).toBe('/api/v1/tasks/t_1%2F2/resolve');
    expect(d.seen[0]?.headers['content-type']).toContain('application/json');
    expect(JSON.parse(d.seen[0]!.body)).toEqual({ action: 'dismiss' });
    expect(d.seen[1]?.url).toBe('/api/v1/properties?q=Oude+Delft&limit=5');
  });

  test('list endpoints come back as pages whether the daemon sends an array or a page', async () => {
    const d = await fakeDaemon((s) =>
      s.url.startsWith('/api/v1/tasks')
        ? { json: [{ id: 't_1' }] }
        : { json: { items: [{ id: 's_1' }], next: 'c2' } },
    );
    const client = createClient({ baseUrl: d.url, token: () => 't0ken' });
    expect(await client.tasks()).toEqual({ items: [{ id: 't_1' }] });
    expect(await client.sources()).toEqual({ items: [{ id: 's_1' }], next: 'c2' });
  });

  test('a refused connection means the agent is not running', async () => {
    const port = await closedPort();
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}`, token: () => 't0ken' });
    const err = await client.status().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DaemonNotRunningError);
    expect((err as Error).message).toBe('The agent is not running. Start it with nlpf on.');
  });

  test('no token file yet also means the agent is not running', async () => {
    const d = await fakeDaemon();
    const client = createClient({ baseUrl: d.url, token: () => null });
    await expect(client.status()).rejects.toBeInstanceOf(DaemonNotRunningError);
    expect(d.seen).toHaveLength(0);
  });

  test('daemon errors surface their code and message', async () => {
    const d = await fakeDaemon(() => ({
      status: 404,
      json: { error: { code: 'not_found', message: 'No task t_9.' } },
    }));
    const client = createClient({ baseUrl: d.url, token: () => 't0ken' });
    const err = (await client.resolveTask('t_9', { action: 'done' }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('No task t_9.');
  });

  test('request bodies are validated before anything is sent', async () => {
    const d = await fakeDaemon();
    const client = createClient({ baseUrl: d.url, token: () => 't0ken' });
    await expect(client.resolveTask('t_1', { action: 'explode' as never })).rejects.toThrow();
    await expect(client.sendMessage('c_1', { body: '' })).rejects.toThrow();
    expect(d.seen).toHaveLength(0);
  });
});

describe('clientFromPaths', () => {
  test('reads the token file and the port from config', async () => {
    const d = await fakeDaemon(() => ({ json: { ok: true } }));
    const paths = resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-cli-')) });
    saveConfig(paths, ConfigSchema.parse({ server: { port: d.port } }));
    writeFileSync(paths.tokenFile, 'abc123\n');
    const client = clientFromPaths(paths, {});
    expect(client.baseUrl).toBe(`http://127.0.0.1:${d.port}`);
    await client.pause();
    expect(d.seen[0]?.method).toBe('POST');
    expect(d.seen[0]?.url).toBe('/api/v1/pause');
    expect(d.seen[0]?.headers['x-nlpf-token']).toBe('abc123');
  });

  test('NLPF_URL overrides the address, for demo daemons on other ports', () => {
    const paths = resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-cli-')) });
    const client = clientFromPaths(paths, { NLPF_URL: 'http://127.0.0.1:9999/' });
    expect(client.baseUrl).toBe('http://127.0.0.1:9999');
  });
});

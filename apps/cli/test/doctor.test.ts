import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ConfigSchema, resolvePaths, saveConfig, setSecret, type Config, type Paths } from '@nlpf/core';
import { DaemonNotRunningError, type NlpfClient } from '../src/client.js';
import {
  findChromium,
  imapLoginOverSocket,
  runDoctor,
  type Check,
  type DoctorDeps,
} from '../src/commands/doctor.js';
import type { ServiceManager, ServiceStatus } from '../src/service/index.js';

const home = (): Paths => resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-doc-')) });

function service(status: Partial<ServiceStatus>): ServiceManager {
  return {
    kind: 'systemd',
    file: '/home/sam/.config/systemd/user/nl-property-finder.service',
    on: async () => ({ kind: 'systemd', file: '', changed: false, restarted: false }),
    off: async () => ({ kind: 'systemd', file: '', wasInstalled: false }),
    status: async () => ({
      kind: 'systemd',
      file: '/x',
      installed: false,
      enabled: false,
      active: false,
      ...status,
    }),
  };
}

function deps(paths: Paths, over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    paths,
    env: {},
    platform: 'linux',
    home: '/home/sam',
    nodeVersion: '22.17.1',
    fileExists: (p) => p === '/usr/bin/google-chrome',
    listDir: () => [],
    fetch: vi.fn(async () => new Response('{"healthy":true}', { status: 200 })) as unknown as typeof fetch,
    imapLogin: vi.fn(async () => {}),
    client: {
      status: async () => ({ version: '0.1.0', paused: false, sources: [] }),
    } as unknown as NlpfClient,
    service: service({ installed: true, enabled: true, active: true, upToDate: true }),
    push: false,
    ...over,
  };
}

function withConfig(paths: Paths, partial: Record<string, unknown>): Config {
  return saveConfig(paths, ConfigSchema.parse(partial));
}

const byId = (checks: Check[], id: string) => checks.find((c) => c.id === id)!;

describe('runDoctor', () => {
  test('a complete setup passes every check', async () => {
    const paths = home();
    withConfig(paths, {
      profile: { firstName: 'Sam' },
      mail: { provider: 'imap', address: 'sam@gmail.com' },
      ai: { provider: 'claude' },
      notify: { ntfy: { topic: 'nlpf-abc' } },
    });
    setSecret(paths, 'NLPF_MAIL_PASSWORD', 'app pass word');
    setSecret(paths, 'ANTHROPIC_API_KEY', 'sk-ant-1234567');
    const d = deps(paths);
    const checks = await runDoctor(d);
    expect(checks.map((c) => c.id)).toEqual([
      'node',
      'chromium',
      'config',
      'secrets',
      'mailbox',
      'ntfy',
      'daemon',
      'service',
    ]);
    expect(checks.filter((c) => c.status !== 'ok')).toEqual([]);
    expect(d.imapLogin).toHaveBeenCalledWith({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      user: 'sam@gmail.com',
      password: 'app pass word',
    });
    expect(d.fetch).toHaveBeenCalledWith('https://ntfy.sh/v1/health', expect.anything());
    expect(JSON.stringify(checks)).not.toContain('app pass word');
  });

  test('an old Node is a failure', async () => {
    const checks = await runDoctor(deps(home(), { nodeVersion: '20.11.0' }));
    expect(byId(checks, 'node')).toMatchObject({ status: 'fail' });
    expect(byId(checks, 'node').detail).toMatch(/22\.12/);
  });

  test('no config yet points at nlpf init; an invalid one names the problem', async () => {
    const paths = home();
    expect(byId(await runDoctor(deps(paths)), 'config')).toMatchObject({ status: 'warn' });
    expect(byId(await runDoctor(deps(paths)), 'config').detail).toMatch(/nlpf init/);
    withConfig(paths, {});
    writeFileSync(paths.configFile, 'automation:\n  dailyCap: lots\n');
    const config = byId(await runDoctor(deps(paths)), 'config');
    expect(config.status).toBe('fail');
    expect(config.detail).toContain('automation.dailyCap');
  });

  test('missing secrets fail and name the variable, and a readable secrets file is a warning', async () => {
    const paths = home();
    withConfig(paths, { ai: { provider: 'claude' }, mail: { provider: 'imap', address: 'sam@gmail.com' } });
    const missing = byId(await runDoctor(deps(paths)), 'secrets');
    expect(missing.status).toBe('fail');
    expect(missing.detail).toContain('ANTHROPIC_API_KEY');
    expect(missing.detail).toContain('NLPF_MAIL_PASSWORD');

    setSecret(paths, 'ANTHROPIC_API_KEY', 'sk-ant-1234567');
    setSecret(paths, 'NLPF_MAIL_PASSWORD', 'secret-pass');
    chmodSync(paths.secretsFile, 0o644);
    const loose = byId(await runDoctor(deps(paths)), 'secrets');
    expect(loose.status).toBe('warn');
    expect(loose.detail).toMatch(/chmod 600/);
  });

  test('a mailbox that refuses the login fails with the server reason', async () => {
    const paths = home();
    withConfig(paths, { mail: { provider: 'imap', address: 'sam@gmail.com' } });
    setSecret(paths, 'NLPF_MAIL_PASSWORD', 'wrong-pass');
    const checks = await runDoctor(
      deps(paths, { imapLogin: async () => Promise.reject(new Error('Invalid credentials (Failure)')) }),
    );
    expect(byId(checks, 'mailbox')).toMatchObject({ status: 'fail' });
    expect(byId(checks, 'mailbox').detail).toContain('Invalid credentials');
  });

  test('mail that is not set up is a warning, and the demo mailbox is skipped', async () => {
    const paths = home();
    withConfig(paths, {});
    expect(byId(await runDoctor(deps(paths)), 'mailbox').status).toBe('warn');
    withConfig(paths, { mail: { provider: 'memory' } });
    expect(byId(await runDoctor(deps(paths)), 'mailbox').status).toBe('skip');
  });

  test('with push it sends a test message to the ntfy topic', async () => {
    const paths = home();
    withConfig(paths, { notify: { ntfy: { server: 'https://ntfy.example', topic: 'nlpf-abc' } } });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const checks = await runDoctor(deps(paths, { push: true, fetch: fetchMock as unknown as typeof fetch }));
    expect(byId(checks, 'ntfy').status).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ntfy.example/nlpf-abc');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toMatch(/nlpf doctor/);
  });

  test('an unreachable ntfy server fails', async () => {
    const paths = home();
    withConfig(paths, { notify: { ntfy: { topic: 'nlpf-abc' } } });
    const failing = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND ntfy.sh') });
    });
    const ntfy = byId(await runDoctor(deps(paths, { fetch: failing as unknown as typeof fetch })), 'ntfy');
    expect(ntfy.status).toBe('fail');
    expect(ntfy.detail).toContain('ENOTFOUND');
  });

  test('a stopped daemon and a missing service are warnings that say what to run', async () => {
    const checks = await runDoctor(
      deps(home(), {
        client: { status: () => Promise.reject(new DaemonNotRunningError()) } as unknown as NlpfClient,
        service: service({ installed: false }),
      }),
    );
    expect(byId(checks, 'daemon')).toMatchObject({ status: 'warn' });
    expect(byId(checks, 'daemon').detail).toMatch(/nlpf on/);
    expect(byId(checks, 'service')).toMatchObject({ status: 'warn' });
    expect(byId(checks, 'service').detail).toMatch(/nlpf on/);
  });

  test('a service unit that points at an old path is a warning', async () => {
    const checks = await runDoctor(
      deps(home(), { service: service({ installed: true, enabled: true, upToDate: false }) }),
    );
    expect(byId(checks, 'service').status).toBe('warn');
    expect(byId(checks, 'service').detail).toMatch(/nlpf on again/);
  });
});

describe('findChromium', () => {
  const none = () => false;
  test('prefers PLAYWRIGHT_CHROMIUM_EXECUTABLE', () => {
    expect(
      findChromium({
        env: { PLAYWRIGHT_CHROMIUM_EXECUTABLE: '/opt/chrome' },
        platform: 'linux',
        home: '/h',
        exists: (p) => p === '/opt/chrome',
        listDir: () => [],
      }),
    ).toBe('/opt/chrome');
  });

  test('then the newest Chromium in the Playwright cache', () => {
    const cache = '/h/.cache/ms-playwright';
    const found = findChromium({
      env: {},
      platform: 'linux',
      home: '/h',
      exists: (p) =>
        p === `${cache}/chromium-1234/chrome-linux64/chrome` ||
        p === `${cache}/chromium-1243/chrome-linux64/chrome`,
      listDir: (d) =>
        d === cache ? ['chromium_headless_shell-1243', 'chromium-1234', 'chromium-1243', 'ffmpeg-1011'] : [],
    });
    expect(found).toBe(`${cache}/chromium-1243/chrome-linux64/chrome`);
  });

  test('then a system Chrome, else nothing', () => {
    expect(
      findChromium({
        env: {},
        platform: 'linux',
        home: '/h',
        exists: (p) => p === '/usr/bin/chromium',
        listDir: () => [],
      }),
    ).toBe('/usr/bin/chromium');
    expect(
      findChromium({ env: {}, platform: 'linux', home: '/h', exists: none, listDir: () => [] }),
    ).toBeNull();
  });
});

describe('imapLoginOverSocket', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  /** A fake IMAP server that accepts one user and password. */
  async function fakeImap(user: string, password: string): Promise<{ port: number; lines: string[] }> {
    const lines: string[] = [];
    server = createServer((sock: Socket) => {
      sock.write('* OK IMAP ready\r\n');
      let buf = '';
      sock.on('data', (d) => {
        buf += String(d);
        let i: number;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          lines.push(line);
          const [tag, cmd] = line.split(' ');
          const quoted = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
          if (cmd === 'LOGIN') {
            const ok = line === `${tag} LOGIN ${quoted(user)} ${quoted(password)}`;
            sock.write('* CAPABILITY IMAP4rev1\r\n');
            sock.write(
              ok
                ? `${tag} OK LOGIN completed\r\n`
                : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n`,
            );
          } else if (cmd === 'LOGOUT') {
            sock.end(`* BYE\r\n${tag} OK\r\n`);
          }
        }
      });
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', () => done()));
    return { port: (server!.address() as AddressInfo).port, lines };
  }

  test('logs in with quoted credentials and logs out', async () => {
    const pass = 'abcd "efgh" \\ ijkl';
    const imap = await fakeImap('sam@gmail.com', pass);
    const sock = connect(imap.port, '127.0.0.1');
    await imapLoginOverSocket(sock, { user: 'sam@gmail.com', password: pass, timeoutMs: 2000 });
    sock.destroy();
    expect(imap.lines[0]).toMatch(/^A1 LOGIN "sam@gmail.com" "abcd \\"efgh\\" \\\\ ijkl"$/);
  });

  test('a refused login rejects with the server reason and not the password', async () => {
    const imap = await fakeImap('sam@gmail.com', 'right');
    const sock = connect(imap.port, '127.0.0.1');
    const err = (await imapLoginOverSocket(sock, {
      user: 'sam@gmail.com',
      password: 'wrong-pass',
      timeoutMs: 2000,
    }).catch((e: unknown) => e)) as Error;
    sock.destroy();
    expect(err.message).toContain('Invalid credentials');
    expect(err.message).not.toContain('wrong-pass');
  });
});

import { existsSync, statSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';
import { loadConfig, loadSecrets, trimTrailingSlashes, type Paths } from '@nlpf/core';
import { DaemonNotRunningError, type NlpfClient } from '../client.js';
import type { ServiceManager, ServiceSpec } from '../service/index.js';

/*
 * `nlpf doctor`: checks the things that have to be true for the agent to
 * work, in the order a new user sets them up, and says what to run for each
 * one that is not. It never prints a secret.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface Check {
  id: 'node' | 'chromium' | 'config' | 'secrets' | 'mailbox' | 'ntfy' | 'daemon' | 'service';
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ImapLoginOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface DoctorDeps {
  paths: Paths;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  nodeVersion: string;
  fileExists: (p: string) => boolean;
  listDir: (p: string) => string[];
  fetch: typeof fetch;
  imapLogin: (opts: ImapLoginOptions) => Promise<void>;
  client: NlpfClient;
  service: ServiceManager;
  /** What `nlpf on` would install now, to tell whether the installed unit is current. */
  serviceSpec?: ServiceSpec;
  /** Send a test notification instead of only checking that the ntfy server answers. */
  push: boolean;
}

const MIN_NODE: [number, number] = [22, 12];

const message = (e: unknown) => {
  if (e instanceof Error) {
    const cause = e.cause instanceof Error ? `: ${e.cause.message}` : '';
    return `${e.message}${cause}`;
  }
  return String(e);
};

/** Finds a Chromium the browser pool can use: an explicit path, Playwright's cache, then a system Chrome. */
export function findChromium(o: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  exists: (p: string) => boolean;
  listDir: (p: string) => string[];
}): string | null {
  const explicit = o.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (explicit && o.exists(explicit)) return explicit;

  const cache =
    o.env.PLAYWRIGHT_BROWSERS_PATH && o.env.PLAYWRIGHT_BROWSERS_PATH !== '0'
      ? o.env.PLAYWRIGHT_BROWSERS_PATH
      : o.platform === 'darwin'
        ? join(o.home, 'Library', 'Caches', 'ms-playwright')
        : o.platform === 'win32'
          ? join(o.env.LOCALAPPDATA ?? join(o.home, 'AppData', 'Local'), 'ms-playwright')
          : join(o.env.XDG_CACHE_HOME ?? join(o.home, '.cache'), 'ms-playwright');
  const inside =
    o.platform === 'darwin'
      ? [
          'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        ]
      : o.platform === 'win32'
        ? ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']
        : ['chrome-linux64/chrome', 'chrome-linux/chrome'];
  let dirs: string[] = [];
  try {
    dirs = o.listDir(cache);
  } catch {
    dirs = [];
  }
  const revisions = dirs
    .map((d) => d.match(/^chromium-(\d+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const m of revisions) {
    for (const sub of inside) {
      const candidate = join(cache, m[0], sub);
      if (o.exists(candidate)) return candidate;
    }
  }

  const system =
    o.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : o.platform === 'win32'
        ? [o.env.ProgramFiles, o.env['ProgramFiles(x86)'], o.env.LOCALAPPDATA]
            .filter((d): d is string => Boolean(d))
            .map((d) => join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
          ];
  return system.find((p) => o.exists(p)) ?? null;
}

function versionAtLeast(version: string, [major, minor]: [number, number]): boolean {
  const [a = 0, b = 0] = version.split('.').map(Number);
  return a > major || (a === major && b >= minor);
}

export async function runDoctor(d: DoctorDeps): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  add(
    versionAtLeast(d.nodeVersion, MIN_NODE)
      ? { id: 'node', label: 'Node.js', status: 'ok', detail: d.nodeVersion }
      : {
          id: 'node',
          label: 'Node.js',
          status: 'fail',
          detail: `${d.nodeVersion} is too old. Install Node 22.12 or newer.`,
        },
  );

  const chromium = findChromium({
    env: d.env,
    platform: d.platform,
    home: d.home,
    exists: d.fileExists,
    listDir: d.listDir,
  });
  add(
    chromium
      ? { id: 'chromium', label: 'Chromium', status: 'ok', detail: chromium }
      : {
          id: 'chromium',
          label: 'Chromium',
          status: 'warn',
          detail:
            'Not found, so sources that need a browser will not work. Install it with npx playwright install chromium.',
        },
  );

  const hasConfig = existsSync(d.paths.configFile);
  const loaded = loadConfig(d.paths);
  const cfg = loaded.config;
  if (!hasConfig) {
    add({ id: 'config', label: 'Config', status: 'warn', detail: 'No config yet. Run nlpf init.' });
  } else if (loaded.errors.length) {
    add({
      id: 'config',
      label: 'Config',
      status: 'fail',
      detail: `${loaded.errors.join('; ')}. The agent keeps using the last good config until this is fixed (nlpf config edit).`,
    });
  } else {
    add({ id: 'config', label: 'Config', status: 'ok', detail: d.paths.configFile });
  }

  const secrets = loadSecrets(d.paths);
  const needed: [string, string][] = [];
  if (cfg.ai.provider === 'claude') needed.push([cfg.ai.keyEnv, 'Claude']);
  if (cfg.mail.provider === 'imap') needed.push([cfg.mail.passwordEnv, 'the mailbox']);
  if (cfg.notify.telegram) needed.push([cfg.notify.telegram.tokenEnv, 'Telegram']);
  const missing = needed.filter(([name]) => !secrets[name]);
  let looseMode = false;
  if (d.platform !== 'win32' && existsSync(d.paths.secretsFile)) {
    looseMode = (statSync(d.paths.secretsFile).mode & 0o077) !== 0;
  }
  if (missing.length) {
    add({
      id: 'secrets',
      label: 'Secrets',
      status: 'fail',
      detail: `Missing ${missing.map(([n, what]) => `${n} (for ${what})`).join(', ')}. Run nlpf init to add them.`,
    });
  } else if (looseMode) {
    add({
      id: 'secrets',
      label: 'Secrets',
      status: 'warn',
      detail: `${d.paths.secretsFile} can be read by other users. Fix it with chmod 600 ${d.paths.secretsFile}.`,
    });
  } else {
    add({
      id: 'secrets',
      label: 'Secrets',
      status: 'ok',
      detail: needed.length ? `${needed.map(([n]) => n).join(', ')} present` : 'None needed with this config',
    });
  }

  if (cfg.mail.provider === 'imap') {
    const user = cfg.mail.user || cfg.mail.address;
    const password = secrets[cfg.mail.passwordEnv];
    if (!password) {
      add({
        id: 'mailbox',
        label: 'Mailbox',
        status: 'fail',
        detail: `No app password saved in ${cfg.mail.passwordEnv}.`,
      });
    } else {
      try {
        await d.imapLogin({
          host: cfg.mail.imap.host,
          port: cfg.mail.imap.port,
          secure: cfg.mail.imap.secure,
          user,
          password,
        });
        add({
          id: 'mailbox',
          label: 'Mailbox',
          status: 'ok',
          detail: `Logged in to ${cfg.mail.imap.host} as ${user}`,
        });
      } catch (e) {
        add({
          id: 'mailbox',
          label: 'Mailbox',
          status: 'fail',
          detail: `${cfg.mail.imap.host}: ${message(e)}`,
        });
      }
    }
  } else if (cfg.mail.provider === 'memory') {
    add({ id: 'mailbox', label: 'Mailbox', status: 'skip', detail: 'In-memory mailbox (demo)' });
  } else {
    add({
      id: 'mailbox',
      label: 'Mailbox',
      status: 'warn',
      detail: 'Not set up, so the agent cannot read replies from landlords. Run nlpf init.',
    });
  }

  const ntfy = cfg.notify.ntfy;
  if (!ntfy) {
    add(
      cfg.notify.telegram
        ? { id: 'ntfy', label: 'ntfy', status: 'skip', detail: 'Not used; alerts go to Telegram' }
        : {
            id: 'ntfy',
            label: 'ntfy',
            status: 'warn',
            detail: 'No phone alerts configured. Run nlpf init to add an ntfy topic.',
          },
    );
  } else {
    const server = trimTrailingSlashes(ntfy.server);
    try {
      const res = d.push
        ? await d.fetch(`${server}/${encodeURIComponent(ntfy.topic)}`, {
            method: 'POST',
            headers: { Title: 'NL Property Finder', Priority: 'low', Tags: 'house' },
            body: 'Test message from nlpf doctor. Alerts from your agent will arrive here.',
            signal: AbortSignal.timeout(10_000),
          })
        : await d.fetch(`${server}/v1/health`, { signal: AbortSignal.timeout(10_000) });
      add(
        res.ok
          ? {
              id: 'ntfy',
              label: 'ntfy',
              status: 'ok',
              detail: d.push
                ? `Sent a test message to ${ntfy.topic}. Check your phone.`
                : `${server} is reachable`,
            }
          : { id: 'ntfy', label: 'ntfy', status: 'fail', detail: `${server} answered ${res.status}` },
      );
    } catch (e) {
      add({ id: 'ntfy', label: 'ntfy', status: 'fail', detail: `Could not reach ${server}: ${message(e)}` });
    }
  }

  try {
    const status = await d.client.status();
    add({
      id: 'daemon',
      label: 'Agent',
      status: 'ok',
      detail: `Running at ${d.client.baseUrl}, version ${status.version}${status.paused ? ', paused' : ''}`,
    });
  } catch (e) {
    add(
      e instanceof DaemonNotRunningError
        ? { id: 'daemon', label: 'Agent', status: 'warn', detail: e.message }
        : { id: 'daemon', label: 'Agent', status: 'fail', detail: message(e) },
    );
  }

  try {
    const s = await d.service.status(d.serviceSpec);
    if (!s.installed) {
      add({
        id: 'service',
        label: 'Service',
        status: 'warn',
        detail: 'Not installed. nlpf on installs it so the agent starts at login.',
      });
    } else if (!s.enabled) {
      add({
        id: 'service',
        label: 'Service',
        status: 'warn',
        detail: 'Installed but switched off. nlpf on turns it on.',
      });
    } else if (s.upToDate === false) {
      add({
        id: 'service',
        label: 'Service',
        status: 'warn',
        detail:
          'Installed, but it runs a different Node or CLI path than this one. Run nlpf on again to update it.',
      });
    } else {
      add({
        id: 'service',
        label: 'Service',
        status: 'ok',
        detail: `${s.kind}, ${s.active ? 'running' : 'enabled'} (${s.file})`,
      });
    }
  } catch (e) {
    add({ id: 'service', label: 'Service', status: 'warn', detail: message(e) });
  }

  return checks;
}

/* ---------- a minimal IMAP login, so doctor needs no mail library ---------- */

function quote(s: string): string {
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

function lineReader(socket: Duplex, timeoutMs: number): { next(): Promise<string>; detach(): void } {
  let buf = '';
  const lines: string[] = [];
  const waiting: { resolve: (l: string) => void; reject: (e: Error) => void }[] = [];
  let failure: Error | null = null;
  const onData = (chunk: Buffer | string) => {
    buf += String(chunk);
    let i: number;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const w = waiting.shift();
      if (w) w.resolve(line);
      else lines.push(line);
    }
  };
  const onEnd = (e?: Error) => {
    failure = e ?? new Error('The mail server closed the connection.');
    for (const w of waiting.splice(0)) w.reject(failure);
  };
  const onError = (e: Error) => onEnd(e);
  const onClose = () => onEnd();
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);
  return {
    next() {
      const queued = lines.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('The mail server did not answer in time.')),
          timeoutMs,
        );
        waiting.push({
          resolve: (l) => {
            clearTimeout(timer);
            resolve(l);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
      });
    },
    detach() {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    },
  };
}

async function tagged(r: { next(): Promise<string> }, tag: string): Promise<string> {
  for (;;) {
    const line = await r.next();
    if (line.startsWith(`${tag} `)) return line;
  }
}

/** Logs in and out over an already connected socket. Rejects with the server's reason, never with the password. */
export async function imapLoginOverSocket(
  socket: Duplex,
  o: { user: string; password: string; timeoutMs: number; greeted?: boolean },
): Promise<void> {
  const r = lineReader(socket, o.timeoutMs);
  try {
    if (!o.greeted) {
      const greeting = await r.next();
      if (!/^\* (OK|PREAUTH)/i.test(greeting)) throw new Error(`Unexpected greeting: ${greeting}`);
    }
    socket.write(`A1 LOGIN ${quote(o.user)} ${quote(o.password)}\r\n`);
    const res = await tagged(r, 'A1');
    if (!/^A1 OK/i.test(res)) {
      throw new Error(`Login refused: ${res.replace(/^A1 (NO|BAD)\s*/i, '').replace(/\[[A-Z-]+\]\s*/g, '')}`);
    }
    socket.write('A2 LOGOUT\r\n');
  } finally {
    r.detach();
  }
}

/** The real login check: TLS on the configured port, or STARTTLS when the port is not implicitly secure. */
export async function imapLogin(o: ImapLoginOptions, timeoutMs = 15_000): Promise<void> {
  if (o.secure) {
    const socket = tlsConnect({ host: o.host, port: o.port, servername: o.host });
    try {
      await imapLoginOverSocket(socket, { user: o.user, password: o.password, timeoutMs });
    } finally {
      socket.destroy();
    }
    return;
  }
  const plain = netConnect({ host: o.host, port: o.port });
  try {
    const r = lineReader(plain, timeoutMs);
    const greeting = await r.next();
    if (!/^\* OK/i.test(greeting)) throw new Error(`Unexpected greeting: ${greeting}`);
    plain.write('A0 STARTTLS\r\n');
    const res = await tagged(r, 'A0');
    r.detach();
    if (!/^A0 OK/i.test(res))
      throw new Error('The server does not offer STARTTLS, and a password is never sent unencrypted.');
    const secure = tlsConnect({ socket: plain, servername: o.host });
    try {
      await imapLoginOverSocket(secure, { user: o.user, password: o.password, timeoutMs, greeted: true });
    } finally {
      secure.destroy();
    }
  } finally {
    plain.destroy();
  }
}

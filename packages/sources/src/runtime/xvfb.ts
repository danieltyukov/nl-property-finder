import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Logger } from '@nlpf/core';

/** First executable called `name` on PATH, or undefined. */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}

/** The lowest display number from `from` whose lock file and socket are both absent. */
export function freeDisplayNumber(from = 99, to = 599, exists: (path: string) => boolean = existsSync): number | undefined {
  for (let n = from; n <= to; n++) {
    if (!exists(`/tmp/.X${n}-lock`) && !exists(`/tmp/.X11-unix/X${n}`)) return n;
  }
  return undefined;
}

export interface XvfbDisplay {
  /** Value for DISPLAY, like ":101". */
  display: string;
  number: number;
  pid: number;
  /** Cookie file for XAUTHORITY when `xauth` was available; clients without it are refused. */
  xauthority?: string;
  running(): boolean;
  stop(): Promise<void>;
}

export interface StartXvfbOptions {
  log: Logger;
  executable?: string;
  /** Default "1440x900x24". */
  screen?: string;
  /** First display number to try. Default 99. */
  from?: number;
  timeoutMs?: number;
}

function lockOwner(n: number): number | undefined {
  try {
    return Number.parseInt(readFileSync(`/tmp/.X${n}-lock`, 'utf8').trim(), 10);
  } catch {
    return undefined;
  }
}

async function makeCookie(n: number, env: NodeJS.ProcessEnv): Promise<{ file: string; cleanup(): void } | undefined> {
  const xauth = findExecutable('xauth', env);
  if (!xauth) return undefined;
  const dir = mkdtempSync(join(tmpdir(), 'nlpf-xvfb-'));
  const file = join(dir, 'Xauthority');
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const ok = await new Promise<boolean>((resolve) =>
    execFile(xauth, ['-q', '-f', file, 'add', `:${n}`, '.', randomBytes(16).toString('hex')], (err) => resolve(!err)),
  );
  if (!ok || !existsSync(file)) {
    cleanup();
    return undefined;
  }
  return { file, cleanup };
}

/**
 * Starts a private X server (`Xvfb :<n> -screen 0 1440x900x24 -nolisten tcp`)
 * on the first free display number, found by looking for `/tmp/.X<n>-lock`.
 * If another server grabs the same number first, the next one is tried. With
 * `xauth` installed the server only accepts clients holding its cookie, so
 * other local users cannot look at the pages drawn on it. The server is also
 * killed when this process exits, even without `stop()`.
 */
export async function startXvfb(opts: StartXvfbOptions): Promise<XvfbDisplay> {
  const exe = opts.executable ?? findExecutable('Xvfb');
  if (!exe) throw new Error('Xvfb is not installed');
  const screen = opts.screen ?? '1440x900x24';
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let from = opts.from ?? 99;

  for (let attempt = 0; attempt < 10; attempt++) {
    const n = freeDisplayNumber(from);
    if (n === undefined) break;
    from = n + 1;
    const cookie = await makeCookie(n, process.env);
    const args = [`:${n}`, '-screen', '0', screen, '-nolisten', 'tcp'];
    if (cookie) args.push('-auth', cookie.file);
    const child: ChildProcess = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
    let exited = false;
    const exit = new Promise<void>((resolve) => {
      child.once('exit', () => {
        exited = true;
        resolve();
      });
      child.once('error', () => {
        exited = true;
        resolve();
      });
    });

    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (!exited && Date.now() < deadline) {
      if (existsSync(`/tmp/.X11-unix/X${n}`) && lockOwner(n) === child.pid) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    if (!ready) {
      child.kill('SIGKILL');
      await exit;
      cookie?.cleanup();
      opts.log.debug('Xvfb did not start on this display, trying the next', { display: `:${n}`, stderr: stderr.trim().slice(-300) });
      continue;
    }

    // Never keep Node alive for Xvfb's sake, and never leave it behind.
    child.unref();
    (child.stderr as { unref?: () => void } | null)?.unref?.();
    const onExit = () => {
      if (!exited) child.kill('SIGTERM');
    };
    process.once('exit', onExit);
    opts.log.info('started a private X display for headed browsers', { display: `:${n}`, pid: child.pid, auth: !!cookie });

    return {
      display: `:${n}`,
      number: n,
      pid: child.pid ?? -1,
      ...(cookie ? { xauthority: cookie.file } : {}),
      running: () => !exited,
      async stop() {
        process.removeListener('exit', onExit);
        if (!exited) {
          child.kill('SIGTERM');
          const killer = setTimeout(() => child.kill('SIGKILL'), 3000);
          await exit;
          clearTimeout(killer);
        }
        cookie?.cleanup();
      },
    };
  }
  throw new Error('could not start Xvfb on any free display number');
}

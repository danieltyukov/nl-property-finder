import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { TZ, resolvePaths, type Paths } from '@nlpf/core';
import type { StartDaemonOptions, DaemonHandle } from '@nlpf/daemon';
import { ApiError, DaemonNotRunningError, clientFromPaths, type NlpfClient } from '../client.js';
import { runMcpStdio } from '../mcp/server.js';
import {
  ServiceError,
  createServiceManager,
  execFileRunner,
  resolveCliEntry,
  type ExecFn,
  type ServiceManager,
} from '../service/index.js';
import { imapLogin, type ImapLoginOptions } from './doctor.js';
import { InitAborted, InitError, createReadlinePrompter, type Prompter } from './init.js';

/*
 * Everything a command touches outside its own logic goes through CliDeps, so
 * the whole program can be driven in tests with stubs: no real service
 * manager, browser, network or daemon.
 */

export type StartDaemonFn = (opts: StartDaemonOptions) => Promise<DaemonHandle>;

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
}

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  version: string;
  nodeVersion: string;
  io: CliIO;
  setExitCode(code: number): void;
  paths(): Paths;
  client(paths: Paths): NlpfClient;
  service(): ServiceManager;
  fetch: typeof fetch;
  exec: ExecFn;
  imapLogin(o: ImapLoginOptions): Promise<void>;
  openUrl(url: string): Promise<void>;
  prompter(opts: { json: boolean }): Prompter;
  spawnEditor(command: string, args: string[]): Promise<number>;
  /** Loads the daemon lazily, so every other command starts without it. */
  loadStartDaemon(): Promise<StartDaemonFn>;
  /** Resolves when the process is asked to stop (SIGINT or SIGTERM). */
  waitForExit(): Promise<void>;
  sleep(ms: number): Promise<void>;
  cliEntry(): string;
  makeTempDir(prefix: string): string;
  fileExists(p: string): boolean;
  listDir(p: string): string[];
  now(): Date;
  runMcp(client: NlpfClient): Promise<void>;
}

/** What a command produced: `data` for --json, `text` for people. */
export interface Outcome {
  data: unknown;
  text?: string | string[];
  exitCode?: number;
  /** The command already wrote its own output (streams, the MCP server), so print nothing more. */
  printed?: boolean;
}

export function describeError(e: unknown): { code: string; message: string } {
  if (e instanceof DaemonNotRunningError) return { code: e.code, message: e.message };
  if (e instanceof ApiError) return { code: e.code, message: e.message };
  if (e instanceof InitError || e instanceof InitAborted) return { code: 'init', message: e.message };
  if (e instanceof ServiceError) return { code: 'service', message: e.message };
  if (e instanceof UsageError) return { code: 'usage', message: e.message };
  if (e instanceof ZodError) {
    return {
      code: 'invalid',
      message: e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'),
    };
  }
  return { code: 'error', message: e instanceof Error ? e.message : String(e) };
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Runs one command body and prints its outcome as JSON or text. Errors become a message and exit code 1. */
export async function run(
  deps: CliDeps,
  json: boolean | undefined,
  body: () => Promise<Outcome>,
): Promise<void> {
  try {
    const r = await body();
    if (r.printed) {
      // nothing more to print
    } else if (json) deps.io.out(JSON.stringify(r.data ?? null, null, 2));
    else if (r.text !== undefined && r.text !== '')
      deps.io.out(Array.isArray(r.text) ? r.text.join('\n') : r.text);
    if (r.exitCode) deps.setExitCode(r.exitCode);
  } catch (e) {
    const err = describeError(e);
    if (json) deps.io.out(JSON.stringify({ error: err }, null, 2));
    else deps.io.err(err.message);
    deps.setExitCode(1);
  }
}

/** Pads columns so a list reads as a table in a terminal. */
export function table(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** An ISO time as a person in the Netherlands reads it. */
export function localTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFormat.format(d);
}

function openCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  return ['xdg-open', [url]];
}

export function defaultDeps(version: string): CliDeps {
  const env = process.env;
  const platform = process.platform;
  const deps: CliDeps = {
    env,
    platform,
    home: homedir(),
    version,
    nodeVersion: process.versions.node,
    io: {
      out: (t) => process.stdout.write(`${t}\n`),
      err: (t) => process.stderr.write(`${t}\n`),
    },
    setExitCode: (code) => {
      process.exitCode = code;
    },
    paths: () => resolvePaths(env, platform),
    client: (paths) => clientFromPaths(paths, env),
    service: () => createServiceManager({ platform, env, home: homedir(), exec: execFileRunner }),
    fetch: (...args) => fetch(...args),
    exec: execFileRunner,
    imapLogin: (o) => imapLogin(o),
    openUrl: (url) =>
      new Promise((resolve, reject) => {
        const [cmd, args] = openCommand(platform, url);
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', (e) =>
          reject(new Error(`Could not open a browser (${cmd}): ${e.message}. Open ${url} yourself.`)),
        );
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      }),
    prompter: ({ json }) => createReadlinePrompter({ output: json ? process.stderr : process.stdout }),
    spawnEditor: (command, args) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit' });
        child.once('error', (e) =>
          reject(new Error(`Could not start ${command}: ${e.message}. Set $EDITOR to your editor.`)),
        );
        child.once('exit', (code) => resolve(code ?? 0));
      }),
    loadStartDaemon: async () => (await import('@nlpf/daemon')).startDaemon,
    waitForExit: () =>
      new Promise((resolve) => {
        const done = () => {
          process.off('SIGINT', done);
          process.off('SIGTERM', done);
          resolve();
        };
        process.once('SIGINT', done);
        process.once('SIGTERM', done);
      }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    cliEntry: () => resolveCliEntry(),
    makeTempDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    fileExists: existsSync,
    listDir: (p) => readdirSync(p),
    now: () => new Date(),
    runMcp: (client) => runMcpStdio(client, { version }),
  };
  return deps;
}

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Paths } from '@nlpf/core';
import {
  ServiceError,
  type ExecFn,
  type ServiceDeps,
  type ServiceManager,
  type ServiceSpec,
} from './common.js';
import { createLaunchdManager } from './launchd.js';
import { createSchtasksManager } from './schtasks.js';
import { createSystemdManager } from './systemd.js';

/*
 * The background service: a systemd user unit on Linux, a LaunchAgent on
 * macOS, a Task Scheduler entry on Windows. What gets written is produced by
 * pure render functions; what gets run goes through execFile with an argument
 * array, never through a shell.
 */

export * from './common.js';

export function createServiceManager(deps: ServiceDeps): ServiceManager {
  switch (deps.platform) {
    case 'darwin':
      return createLaunchdManager(deps);
    case 'win32':
      return createSchtasksManager(deps);
    default:
      return createSystemdManager(deps);
  }
}

/** The real runner: execFile with an argument array. No shell is involved at any point. */
export const execFileRunner: ExecFn = (file, args) =>
  new Promise((done) => {
    execFile(file, args, { windowsHide: true, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error && typeof error.code === 'string') {
        // The program itself could not be started, for example ENOENT when systemctl is missing.
        done({ code: 127, stdout: '', stderr: `${file}: ${error.message}` });
        return;
      }
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      done({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/**
 * The script the service runs. From the bundle that is the bundle itself.
 * From source (tsx) it is the bundle next to the sources, because a service
 * cannot run TypeScript.
 */
export function resolveCliEntry(
  moduleUrl: string = import.meta.url,
  exists: (p: string) => boolean = existsSync,
): string {
  const here = fileURLToPath(moduleUrl);
  if (/\.(mjs|cjs|js)$/.test(here)) {
    if (basename(here) === 'nlpf.mjs') return here;
    // This code sits in a shared chunk of the bundle (dist/chunks/); the entry is next to it or one folder up.
    const entry = [join(dirname(here), 'nlpf.mjs'), join(dirname(here), '..', 'nlpf.mjs')].find(exists);
    return entry ? resolve(entry) : here;
  }
  const dist = resolve(dirname(here), '..', '..', 'dist', 'nlpf.mjs');
  if (exists(dist)) return dist;
  throw new ServiceError(
    `The service runs the built CLI, and ${dist} does not exist yet. Build it with npm run build -w @nlpf/cli, then run nlpf on again.`,
  );
}

export function buildServiceSpec(
  paths: Paths,
  env: NodeJS.ProcessEnv,
  entry: string,
  node: string = process.execPath,
): ServiceSpec {
  const spec: ServiceSpec = { node, entry, logsDir: paths.logsDir };
  if (env.NLPF_HOME) spec.home = resolve(env.NLPF_HOME);
  return spec;
}

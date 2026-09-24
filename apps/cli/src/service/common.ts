import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/* Types and helpers shared by the three service backends. */

export const SERVICE_NAME = 'nl-property-finder';

export type ServiceKind = 'systemd' | 'launchd' | 'schtasks';

/** What the service runs: `<node> <entry> daemon`, with NLPF_HOME passed through when it is set. */
export interface ServiceSpec {
  node: string;
  entry: string;
  logsDir: string;
  home?: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program with arguments. Never throws for a non-zero exit; the caller reads `code`. */
export type ExecFn = (file: string, args: string[]) => Promise<ExecResult>;

export interface ServiceDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exec: ExecFn;
  /** The user id for the launchd `gui/<uid>` domain. */
  uid?: number;
}

export interface ServiceStatus {
  kind: ServiceKind;
  file: string;
  installed: boolean;
  enabled: boolean;
  active: boolean;
  /** Present when a spec was given: whether the installed file matches what `nlpf on` would write now. */
  upToDate?: boolean;
}

export interface OnResult {
  kind: ServiceKind;
  file: string;
  changed: boolean;
  restarted: boolean;
}

export interface OffResult {
  kind: ServiceKind;
  file: string;
  wasInstalled: boolean;
}

export interface ServiceManager {
  readonly kind: ServiceKind;
  /** The unit file, plist, or (on Windows) the task name. */
  readonly file: string;
  on(spec: ServiceSpec): Promise<OnResult>;
  off(): Promise<OffResult>;
  status(spec?: ServiceSpec): Promise<ServiceStatus>;
}

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

/** Throws a ServiceError carrying the tool's own message when a command failed. */
export async function mustRun(exec: ExecFn, file: string, args: string[]): Promise<ExecResult> {
  const r = await exec(file, args);
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout).trim() || `exit code ${r.code}`;
    throw new ServiceError(`${file} ${args.join(' ')} failed: ${detail}`);
  }
  return r;
}

export function readIfExists(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Writes a file only when its content changed. Returns whether it changed. */
export function writeIfChanged(file: string, content: string): boolean {
  if (readIfExists(file) === content) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}

import { appendFileSync } from 'node:fs';
import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  file?: string;
  level?: LogLevel;
  secrets?: () => string[];
  stderr?: boolean;
  bindings?: Record<string, unknown>;
}

/**
 * JSON lines to a file (for `nlpf logs` and bug reports) and a short text line
 * to stderr (for journalctl). Both go through `redact`, so a secret that ends
 * up in an error message never reaches disk.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? ((process.env.NLPF_LOG_LEVEL as LogLevel | undefined) ?? 'info');
  const bindings = opts.bindings ?? {};
  const write = (lvl: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const secrets = opts.secrets?.() ?? [];
    const entry = redact({ t: new Date().toISOString(), lvl, msg, ...bindings, ...(data ?? {}) }, secrets);
    if (opts.file) {
      try {
        appendFileSync(opts.file, JSON.stringify(entry) + '\n');
      } catch {
        // A full disk or a missing folder must not take the daemon down with it.
      }
    }
    if (opts.stderr !== false) {
      const scope = bindings.scope ? `[${String(bindings.scope)}] ` : '';
      const extra = data && Object.keys(data).length ? ' ' + JSON.stringify(redact(data, secrets)) : '';
      process.stderr.write(`${lvl.padEnd(5)} ${scope}${redact(msg, secrets)}${extra}\n`);
    }
  };
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: (b) => createLogger({ ...opts, bindings: { ...bindings, ...b } }),
  };
}

/** A logger that records entries in memory, for tests. */
export function memoryLogger(): Logger & { entries: { lvl: LogLevel; msg: string; data?: Record<string, unknown> }[] } {
  const entries: { lvl: LogLevel; msg: string; data?: Record<string, unknown> }[] = [];
  const make = (bindings: Record<string, unknown>): Logger => ({
    debug: (msg, data) => entries.push({ lvl: 'debug', msg, data: { ...bindings, ...data } }),
    info: (msg, data) => entries.push({ lvl: 'info', msg, data: { ...bindings, ...data } }),
    warn: (msg, data) => entries.push({ lvl: 'warn', msg, data: { ...bindings, ...data } }),
    error: (msg, data) => entries.push({ lvl: 'error', msg, data: { ...bindings, ...data } }),
    child: (b) => make({ ...bindings, ...b }),
  });
  return Object.assign(make({}), { entries });
}

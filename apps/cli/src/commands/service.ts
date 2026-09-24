import { readToken } from '../client.js';
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  unwatchFile,
  watchFile,
} from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { TZ, loadConfig, type StatusView } from '@nlpf/core';
import { ApiError, DaemonNotRunningError } from '../client.js';
import { buildServiceSpec } from '../service/index.js';
import { UsageError, localTime, run, table, type CliDeps } from './context.js';

/* nlpf on, off, status, open and logs: the agent as a background service. */

const NOT_RUNNING = new DaemonNotRunningError().message;

/** The machine's private IPv4 address, for the LAN URL when server.lan is on. */
export function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
    }
  }
  return undefined;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatStatus(s: StatusView, url: string, lanUrl?: string): string[] {
  const lines = [`Running at ${url} (version ${s.version}, since ${localTime(s.startedAt)})`];
  if (lanUrl) lines.push(`On your network: ${lanUrl}`);
  const automation = s.paused ? 'paused: sources are still read, nothing is sent' : 'on';
  lines.push(
    `Automation: ${automation}${s.dryRun ? ', dry run (messages are drafted, not sent)' : ''}${s.demo ? ', demo mode' : ''}`,
  );
  lines.push(
    `Mail: ${s.mail.connected ? `connected${s.mail.address ? ` as ${s.mail.address}` : ''}` : `not connected${s.mail.error ? ` (${s.mail.error})` : ''}`}`,
  );
  lines.push(
    `AI: ${s.ai.provider}${s.ai.usageThisMonth.calls ? `, ${plural(s.ai.usageThisMonth.calls, 'call')} this month` : ''}`,
  );
  const c = s.counts;
  lines.push(
    `Today: ${c.seenToday} seen, ${c.matchedToday} matched, ${c.contactedToday} contacted, ${plural(c.repliesToday, 'reply', 'replies')}. ${plural(c.openTasks, 'open task')}, ${plural(c.viewingsUpcoming, 'upcoming viewing')}.`,
  );
  if (s.nextPollAt) lines.push(`Next check: ${localTime(s.nextPollAt)}`);
  if (s.sources.length) {
    lines.push('Sources:');
    lines.push(
      table(
        s.sources.map((src) => [
          `  ${src.sourceId}`,
          src.enabled ? src.health : 'disabled',
          src.lastRunAt ? `last run ${localTime(src.lastRunAt)}` : 'not run yet',
          src.lastCount !== undefined ? plural(src.lastCount, 'listing') : '',
          src.lastError ?? '',
        ]),
      ),
    );
  }
  return lines;
}

/** The daemon's log file: daemon.log when present, otherwise the newest log in the folder. */
export function findLogFile(logsDir: string): string | null {
  if (!existsSync(logsDir)) return null;
  const preferred = join(logsDir, 'daemon.log');
  if (existsSync(preferred)) return preferred;
  const files = readdirSync(logsDir)
    .filter((f) => /\.(log|jsonl)$/.test(f))
    .map((f) => ({ f, t: statSync(join(logsDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? join(logsDir, files[0].f) : null;
}

export function tailLines(file: string, n: number): string[] {
  const size = statSync(file).size;
  const length = Math.min(size, 512 * 1024);
  const buf = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  const lines = buf.toString('utf8').split('\n').filter(Boolean);
  if (length < size) lines.shift(); // the first line may be cut in half
  return lines.slice(-n);
}

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function parseLogLine(line: string): Record<string, unknown> {
  try {
    const v = JSON.parse(line) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // not JSON: fall through
  }
  return { raw: line };
}

/** One JSON log entry as a short line: time, level, scope, message and the remaining fields. */
export function formatLogLine(line: string): string {
  const e = parseLogLine(line);
  if ('raw' in e && Object.keys(e).length === 1) return String(e.raw);
  const { t, lvl, msg, scope, ...rest } = e;
  const time = typeof t === 'string' && !Number.isNaN(Date.parse(t)) ? clock.format(new Date(t)) : '';
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
  return `${time} ${String(lvl ?? '').padEnd(5)} ${scope ? `[${String(scope)}] ` : ''}${String(msg ?? '')}${extra}`.trim();
}

/** Prints lines appended to `file` until `stop` resolves. Handles the file being truncated or replaced. */
async function follow(file: string, emit: (line: string) => void, stop: Promise<void>): Promise<void> {
  let pos = statSync(file).size;
  let partial = '';
  const onChange = () => {
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size < pos) pos = 0;
    if (size === pos) return;
    const buf = Buffer.alloc(size - pos);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buf, 0, buf.length, pos);
    } finally {
      closeSync(fd);
    }
    pos = size;
    const text = partial + buf.toString('utf8');
    const lines = text.split('\n');
    partial = lines.pop() ?? '';
    for (const l of lines) if (l) emit(l);
  };
  watchFile(file, { interval: 500 }, onChange);
  try {
    await stop;
  } finally {
    unwatchFile(file, onChange);
  }
}

export function registerLifecycle(program: Command, deps: CliDeps): void {
  program
    .command('on')
    .description('Install the background service and start the agent, now and at every login')
    .option('--json', 'print JSON')
    .action((o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const paths = deps.paths();
        const { config } = loadConfig(paths);
        if (!config.profile.firstName) {
          deps.io.err(
            'Your profile is empty, so the agent has nobody to introduce yet. Run nlpf init, or finish the setup in the dashboard with nlpf open.',
          );
        }
        const spec = buildServiceSpec(paths, deps.env, deps.cliEntry());
        const service = await deps.service().on(spec);
        const client = deps.client(paths);
        let running = false;
        for (let i = 0; i < 40 && !running; i++) {
          try {
            await client.status();
            running = true;
          } catch (e) {
            if (e instanceof ApiError) running = true;
            else if (!(e instanceof DaemonNotRunningError)) throw e;
            else await deps.sleep(500);
          }
        }
        const text = [
          running
            ? `The agent is running at ${client.baseUrl}. It starts by itself at every login. Open the dashboard with nlpf open.`
            : `The service is installed (${service.file}), but the agent has not answered yet. Check nlpf logs, or run nlpf status in a moment.`,
        ];
        if (service.restarted) text.push('The service definition changed, so the agent was restarted.');
        return { data: { service, running, url: client.baseUrl }, text, exitCode: running ? 0 : 1 };
      }),
    );

  program
    .command('off')
    .description('Stop the agent and keep it from starting at login')
    .option('--json', 'print JSON')
    .action((o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const r = await deps.service().off();
        return {
          data: r,
          text: r.wasInstalled
            ? 'The agent is stopped and will not start at login. Start it again with nlpf on.'
            : 'The service is not installed, so there was nothing to stop.',
        };
      }),
    );

  program
    .command('status')
    .description('Show whether the agent runs, the health of every source, and what happened today')
    .option('--json', 'print JSON')
    .action((o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const paths = deps.paths();
        const client = deps.client(paths);
        try {
          const s = await client.status();
          const { config } = loadConfig(paths);
          const lan = config.server.lan ? lanAddress() : undefined;
          const lanUrl = lan ? `http://${lan}:${config.server.port}/` : undefined;
          return {
            data: { running: true, url: client.baseUrl, ...(lanUrl ? { lanUrl } : {}), ...s },
            text: formatStatus(s, client.baseUrl, lanUrl),
          };
        } catch (e) {
          if (!(e instanceof DaemonNotRunningError)) throw e;
          const service = await deps
            .service()
            .status()
            .catch(() => undefined);
          const text = [NOT_RUNNING];
          if (service?.installed)
            text.push(
              `The service is installed (${service.file}) but the agent is not answering. See nlpf logs.`,
            );
          return { data: { running: false, service }, text, exitCode: 1 };
        }
      }),
    );

  program
    .command('open')
    .description('Open the dashboard in your browser')
    .option('--json', 'print JSON')
    .action((o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const paths = deps.paths();
        const client = deps.client(paths);
        await client.status();
        const url = `${client.baseUrl}/`;
        // The token rides along once; the daemon swaps it for a session cookie
        // and redirects, so it does not stay in the address bar or history.
        const token = process.env.NLPF_TOKEN ?? readToken(paths);
        await deps.openUrl(token ? `${url}?t=${encodeURIComponent(token)}` : url);
        return { data: { url }, text: `Opened ${url}` };
      }),
    );

  program
    .command('logs')
    .description("Show the agent's log")
    .option('-f, --follow', 'keep printing new lines until Ctrl+C')
    .option('-n, --lines <count>', 'how many lines to show', '50')
    .option('--json', 'print log entries as JSON (one per line with --follow)')
    .action((o: { follow?: boolean; lines: string; json?: boolean }) =>
      run(deps, o.json, async () => {
        const n = Number(o.lines);
        if (!Number.isInteger(n) || n < 0) throw new UsageError('--lines takes a whole number.');
        const paths = deps.paths();
        const file = findLogFile(paths.logsDir);
        if (!file) {
          const hint =
            deps.platform === 'linux'
              ? ' The service also logs to the journal: journalctl --user -u nl-property-finder'
              : '';
          return { data: [], text: `No log file yet in ${paths.logsDir}.${hint}` };
        }
        const lines = tailLines(file, n);
        if (!o.follow) {
          return { data: lines.map(parseLogLine), text: lines.map(formatLogLine) };
        }
        const emit = (l: string) => deps.io.out(o.json ? JSON.stringify(parseLogLine(l)) : formatLogLine(l));
        lines.forEach(emit);
        await follow(file, emit, deps.waitForExit());
        return { data: undefined, printed: true };
      }),
    );
}

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { describe, expect, test, vi } from 'vitest';
import { ConfigSchema, loadConfig, resolvePaths, saveConfig, type Paths, type StatusView } from '@nlpf/core';
import { DaemonNotRunningError, type NlpfClient } from '../src/client.js';
import { buildProgram } from '../src/commands/index.js';
import type { CliDeps } from '../src/commands/context.js';
import type { Prompter } from '../src/commands/init.js';
import type { ServiceManager } from '../src/service/index.js';

const status: StatusView = {
  version: '0.1.0',
  startedAt: '2026-09-24T08:00:00Z',
  paused: false,
  dryRun: false,
  demo: false,
  sources: [
    {
      sourceId: 'huisje',
      name: 'Huisje',
      enabled: true,
      health: 'ok',
      consecutiveFailures: 0,
      consecutiveEmpty: 0,
    },
  ],
  mail: { connected: true, address: 'sam@gmail.com' },
  ai: {
    provider: 'rules',
    usageThisMonth: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0 },
  },
  counts: {
    openTasks: 2,
    seenToday: 14,
    matchedToday: 3,
    contactedToday: 3,
    repliesToday: 1,
    viewingsUpcoming: 1,
  },
};

function stubClient(overrides: Partial<NlpfClient>): NlpfClient {
  return new Proxy(overrides as NlpfClient, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof NlpfClient];
      if (prop === 'baseUrl') return 'http://127.0.0.1:7431';
      return () => Promise.reject(new DaemonNotRunningError());
    },
  });
}

const notRunning = stubClient({});

function stubService(): ServiceManager & { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> } {
  return {
    kind: 'systemd',
    file: '/home/sam/.config/systemd/user/nl-property-finder.service',
    on: vi.fn(async () => ({ kind: 'systemd' as const, file: '/unit', changed: true, restarted: false })),
    off: vi.fn(async () => ({ kind: 'systemd' as const, file: '/unit', wasInstalled: true })),
    status: vi.fn(async () => ({
      kind: 'systemd' as const,
      file: '/unit',
      installed: false,
      enabled: false,
      active: false,
    })),
  };
}

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
  exitCode: () => number;
  paths: Paths;
  run: (...argv: string[]) => Promise<void>;
}

function harness(over: Partial<CliDeps> = {}, client: NlpfClient = notRunning): Harness {
  const home = mkdtempSync(join(tmpdir(), 'nlpf-cmd-'));
  const env: NodeJS.ProcessEnv = { NLPF_HOME: home };
  const paths = resolvePaths(env);
  const out: string[] = [];
  const err: string[] = [];
  let code = 0;
  const deps: CliDeps = {
    env,
    platform: 'linux',
    home,
    version: '0.1.0',
    nodeVersion: '22.17.1',
    io: { out: (t) => out.push(t), err: (t) => err.push(t) },
    setExitCode: (c) => (code = c),
    paths: () => resolvePaths(env),
    client: () => client,
    service: () => stubService(),
    fetch: vi.fn(async () => new Response('{}')) as unknown as typeof fetch,
    exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    imapLogin: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
    prompter: () => {
      throw new Error('no prompter in this test');
    },
    spawnEditor: vi.fn(async () => 0),
    loadStartDaemon: async () => {
      throw new Error('no daemon in this test');
    },
    waitForExit: async () => {},
    sleep: async () => {},
    cliEntry: () => '/opt/nlpf/apps/cli/dist/nlpf.mjs',
    makeTempDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    fileExists: () => false,
    listDir: () => [],
    now: () => new Date('2026-09-24T10:00:00Z'),
    runMcp: async () => {},
    ...over,
  };
  return {
    deps,
    out,
    err,
    paths,
    exitCode: () => code,
    run: async (...argv) => {
      const program = buildProgram(deps);
      const noExit = (c: Command): void => {
        c.exitOverride();
        c.commands.forEach(noExit);
      };
      noExit(program);
      await program.parseAsync(argv, { from: 'user' });
    },
  };
}

function leaves(cmd: Command, prefix: string[] = []): [string, Command][] {
  if (cmd.commands.length === 0) return [[prefix.join(' '), cmd]];
  return cmd.commands.flatMap((c) => leaves(c, [...prefix, c.name()]));
}

const confirmAll = (answer: boolean, said: string[] = []): Prompter => ({
  say: (t) => said.push(t),
  ask: async (_q, o) => o?.default ?? '',
  secret: async () => '',
  confirm: async (q) => {
    said.push(q);
    return answer;
  },
  close: () => {},
});

describe('the nlpf program', () => {
  test('has every command, and every command accepts --json', () => {
    const program = buildProgram(harness().deps);
    const names = leaves(program).map(([n]) => n);
    expect(names.sort()).toEqual(
      [
        'init',
        'daemon',
        'demo',
        'on',
        'off',
        'status',
        'open',
        'logs',
        'pause',
        'resume',
        'connect',
        'sources list',
        'sources test',
        'sources enable',
        'sources disable',
        'sources enable-contact',
        'sources disable-contact',
        'tasks list',
        'tasks done',
        'tasks dismiss',
        'listings',
        'send',
        'doctor',
        'mcp',
        'config get',
        'config set',
        'config edit',
      ].sort(),
    );
    for (const [name, cmd] of leaves(program)) {
      expect(
        cmd.options.map((o) => o.long),
        name,
      ).toContain('--json');
    }
  });

  test('nlpf sources --help mentions the contact commands', async () => {
    const h = harness();
    await h.run('sources', '--help').catch(() => {});
    const help = h.out.join('');
    expect(help).toContain('enable-contact');
    expect(help).toContain('disable-contact');
  });
});

describe('status', () => {
  test('--json prints the agent status', async () => {
    const h = harness({}, stubClient({ status: async () => status }));
    await h.run('status', '--json');
    const printed = JSON.parse(h.out.join(''));
    expect(printed).toMatchObject({
      running: true,
      url: 'http://127.0.0.1:7431',
      paused: false,
      version: '0.1.0',
    });
    expect(h.exitCode()).toBe(0);
  });

  test('reads plainly for people', async () => {
    const h = harness({}, stubClient({ status: async () => status }));
    await h.run('status');
    const text = h.out.join('\n');
    expect(text).toContain('Running');
    expect(text).toContain('huisje');
    expect(text).toContain('2 open tasks');
  });

  test('says how to start the agent when it is not running', async () => {
    const h = harness();
    await h.run('status');
    expect(h.out.join('\n')).toContain('The agent is not running. Start it with nlpf on.');
    expect(h.exitCode()).toBe(1);
    const j = harness();
    await j.run('status', '--json');
    expect(JSON.parse(j.out.join(''))).toMatchObject({ running: false });
  });
});

describe('daemon API commands', () => {
  test('a command that needs the agent prints a JSON error with --json', async () => {
    const h = harness();
    await h.run('pause', '--json');
    expect(JSON.parse(h.out.join(''))).toEqual({
      error: { code: 'daemon_not_running', message: 'The agent is not running. Start it with nlpf on.' },
    });
    expect(h.exitCode()).toBe(1);
  });

  test('pause and resume', async () => {
    const pause = vi.fn(async () => ({ paused: true }));
    const resume = vi.fn(async () => ({ paused: false }));
    const h = harness({}, stubClient({ pause, resume }));
    await h.run('pause');
    await h.run('resume');
    expect(pause).toHaveBeenCalled();
    expect(resume).toHaveBeenCalled();
    expect(h.out.join('\n')).toMatch(/Paused/);
  });

  test('tasks list, done and dismiss', async () => {
    const tasks = vi.fn(async () => ({
      items: [
        {
          id: 't_1',
          kind: 'reply_needed',
          title: 'Reply needed',
          reason: 'x',
          priority: 1,
          state: 'open',
          createdAt: '',
          updatedAt: '',
        },
      ],
    }));
    const resolveTask = vi.fn(async () => ({}));
    const h = harness({}, stubClient({ tasks, resolveTask } as Partial<NlpfClient>));
    await h.run('tasks', '--json');
    expect(JSON.parse(h.out.join(''))).toMatchObject([{ id: 't_1' }]);
    expect(tasks).toHaveBeenCalledWith({ state: 'open' });
    await h.run('tasks', 'done', 't_1');
    await h.run('tasks', 'dismiss', 't_2', '--json');
    expect(resolveTask).toHaveBeenNthCalledWith(1, 't_1', { action: 'done' });
    expect(resolveTask).toHaveBeenNthCalledWith(2, 't_2', { action: 'dismiss' });
  });

  test('listings passes its filters', async () => {
    const properties = vi.fn(async () => ({ items: [] }));
    const h = harness({}, stubClient({ properties }));
    await h.run('listings', '--status', 'contacted', '--q', 'delft', '--json');
    expect(properties).toHaveBeenCalledWith({ status: 'contacted', q: 'delft', limit: 20 });
    expect(JSON.parse(h.out.join(''))).toEqual([]);
  });

  test('send joins the words into one message', async () => {
    const sendMessage = vi.fn(async () => ({ id: 'm_1', status: 'sent' }));
    const h = harness({}, stubClient({ sendMessage }));
    await h.run('send', 'c_1', 'Thursday', 'at', '18:30', 'works', 'for', 'me.');
    expect(sendMessage).toHaveBeenCalledWith('c_1', { body: 'Thursday at 18:30 works for me.' });
  });

  test('connect asks the agent to open a login window', async () => {
    const connectSource = vi.fn(async () => ({}));
    const h = harness({}, stubClient({ connectSource }));
    await h.run('connect', 'kamernet');
    expect(connectSource).toHaveBeenCalledWith('kamernet');
    expect(h.out.join('\n')).toMatch(/log in/i);
  });

  test('open checks that the agent runs and opens the dashboard', async () => {
    const h = harness({}, stubClient({ status: async () => status }));
    await h.run('open');
    expect(h.deps.openUrl).toHaveBeenCalledWith('http://127.0.0.1:7431/');
  });
});

describe('sources', () => {
  test('enable-contact warns about forbidding terms, asks, and records the acknowledgement', async () => {
    const said: string[] = [];
    const config = ConfigSchema.parse({ sources: { kamernet: { enabled: true } } });
    const patchConfig = vi.fn(async () => ({}));
    const patchSource = vi.fn(async () => ({}));
    const client = stubClient({
      sources: async () => ({
        items: [{ sourceId: 'kamernet', name: 'Kamernet', terms: 'forbids' } as never],
      }),
      config: async () => config,
      patchConfig,
      patchSource,
    });
    const h = harness({ prompter: () => confirmAll(true, said) }, client);
    await h.run('sources', 'enable-contact', 'kamernet');
    expect(said.join('\n')).toContain(
      "Kamernet's terms forbid automated access. If you switch on automatic messages there, the risk is that Kamernet suspends your account.",
    );
    const patched = (
      patchConfig.mock.calls[0] as unknown as [
        { section: string; value: Record<string, Record<string, unknown>> },
      ]
    )[0];
    expect(patched.section).toBe('sources');
    expect(patched.value.kamernet).toMatchObject({
      contact: 'auto',
      termsAcknowledgedAt: '2026-09-24T10:00:00.000Z',
    });
    expect(patchSource).toHaveBeenCalledWith('kamernet', { contact: 'auto' });
  });

  test('enable-contact changes nothing when the user says no', async () => {
    const patchSource = vi.fn(async () => ({}));
    const client = stubClient({
      sources: async () => ({
        items: [{ sourceId: 'kamernet', name: 'Kamernet', terms: 'forbids' } as never],
      }),
      patchSource,
    });
    const h = harness({ prompter: () => confirmAll(false) }, client);
    await h.run('sources', 'enable-contact', 'kamernet', '--json');
    expect(JSON.parse(h.out.join(''))).toMatchObject({ changed: false });
    expect(patchSource).not.toHaveBeenCalled();
  });

  test('with the agent off, enable-contact --yes edits config.yaml and notes that the terms were not checked', async () => {
    const h = harness();
    await h.run('sources', 'enable-contact', 'pararius', '--yes');
    expect(loadConfig(h.paths).config.sources.pararius?.contact).toBe('auto');
    expect(h.out.join('\n') + h.err.join('\n')).toMatch(/terms/i);
  });

  test('disable-contact makes a source watch only', async () => {
    const h = harness();
    await h.run('sources', 'disable-contact', 'huisje', '--json');
    expect(loadConfig(h.paths).config.sources.huisje?.contact).toBe('watch_only');
    expect(JSON.parse(h.out.join(''))).toMatchObject({
      sourceId: 'huisje',
      contact: 'watch_only',
      via: 'config',
    });
  });

  test('enable and disable go through the agent when it runs', async () => {
    const patchSource = vi.fn(async () => ({}));
    const client = stubClient({ sources: async () => ({ items: [] }), patchSource });
    const h = harness({}, client);
    await h.run('sources', 'disable', 'kamernet');
    expect(patchSource).toHaveBeenCalledWith('kamernet', { enabled: false });
  });
});

describe('config', () => {
  test('set and get a setting', async () => {
    const h = harness();
    await h.run('config', 'set', 'automation.dailyCap', '25');
    expect(loadConfig(h.paths).config.automation.dailyCap).toBe(25);
    await h.run('config', 'get', 'automation.dailyCap', '--json');
    expect(JSON.parse(h.out.at(-1)!)).toBe(25);
    await h.run('config', 'set', 'profile.phone', '0612345678');
    expect(loadConfig(h.paths).config.profile.phone).toBe('0612345678');
  });

  test('unknown settings and wrong types are errors that name the setting', async () => {
    const h = harness();
    await h.run('config', 'set', 'automation.dailyCapp', '3');
    expect(h.err.join('\n')).toContain('automation.dailyCapp is not a setting');
    await h.run('config', 'set', 'automation.dailyCap', 'lots');
    expect(h.err.join('\n')).toContain('automation.dailyCap');
    expect(h.exitCode()).toBe(1);
  });

  test('edit opens the editor on config.yaml', async () => {
    const h = harness();
    h.deps.env.EDITOR = 'code --wait';
    await h.run('config', 'edit');
    expect(h.deps.spawnEditor).toHaveBeenCalledWith('code', ['--wait', h.paths.configFile]);
  });
});

describe('service', () => {
  test('on installs the service for the bundled CLI and waits for the agent', async () => {
    const svc = stubService();
    let calls = 0;
    const client = stubClient({
      status: async () => {
        calls++;
        if (calls < 3) throw new DaemonNotRunningError();
        return status;
      },
    });
    const h = harness({ service: () => svc }, client);
    saveConfig(h.paths, ConfigSchema.parse({ profile: { firstName: 'Sam' } }));
    await h.run('on', '--json');
    expect(svc.on).toHaveBeenCalledWith({
      node: process.execPath,
      entry: '/opt/nlpf/apps/cli/dist/nlpf.mjs',
      logsDir: h.paths.logsDir,
      home: h.deps.env.NLPF_HOME,
    });
    expect(JSON.parse(h.out.join(''))).toMatchObject({ running: true, url: 'http://127.0.0.1:7431' });
  });

  test('on warns when the profile is empty', async () => {
    const h = harness({ service: () => stubService() }, stubClient({ status: async () => status }));
    await h.run('on');
    expect(h.out.join('\n') + h.err.join('\n')).toMatch(/profile is empty/i);
  });

  test('off stops and disables the service', async () => {
    const svc = stubService();
    const h = harness({ service: () => svc });
    await h.run('off');
    expect(svc.off).toHaveBeenCalled();
    expect(h.out.join('\n')).toMatch(/stopped/i);
  });
});

describe('daemon and demo', () => {
  test('daemon starts the agent with the resolved paths and stops it on exit', async () => {
    const stop = vi.fn(async () => {});
    const startDaemon = vi.fn(async () => ({ url: 'http://127.0.0.1:7431', token: 't', stop }));
    const h = harness({ loadStartDaemon: async () => startDaemon });
    await h.run('daemon', '--port', '7555');
    expect(startDaemon).toHaveBeenCalledWith({ paths: resolvePaths(h.deps.env), port: 7555 });
    expect(stop).toHaveBeenCalled();
  });

  test('--home sets NLPF_HOME for the daemon', async () => {
    const startDaemon = vi.fn(async () => ({ url: 'u', token: 't', stop: async () => {} }));
    const other = mkdtempSync(join(tmpdir(), 'nlpf-other-'));
    const h = harness({ loadStartDaemon: async () => startDaemon });
    await h.run('daemon', '--home', other);
    const arg = (startDaemon.mock.calls[0] as unknown as [{ paths: Paths }])[0];
    expect(arg.paths.configDir).toBe(join(other, 'config'));
  });

  test('demo runs in a temporary home and opens the dashboard', async () => {
    const startDaemon = vi.fn(async () => ({
      url: 'http://127.0.0.1:7600',
      token: 't',
      stop: async () => {},
    }));
    const h = harness({ loadStartDaemon: async () => startDaemon });
    delete h.deps.env.NLPF_HOME;
    await h.run('demo');
    const arg = (startDaemon.mock.calls[0] as unknown as [{ paths: Paths; demo: boolean }])[0];
    expect(arg.demo).toBe(true);
    expect(arg.paths.configDir.startsWith(tmpdir())).toBe(true);
    expect(h.deps.openUrl).toHaveBeenCalledWith('http://127.0.0.1:7600/');
  });
});

describe('logs and doctor', () => {
  test('logs prints the last lines of the daemon log, readable', async () => {
    const h = harness();
    const lines = [
      { t: '2026-09-24T08:00:00.000Z', lvl: 'info', msg: 'first' },
      { t: '2026-09-24T08:00:01.000Z', lvl: 'info', msg: 'polled', scope: 'scheduler', sourceId: 'huisje' },
      { t: '2026-09-24T08:00:02.000Z', lvl: 'warn', msg: 'slow source' },
    ];
    writeFileSync(join(h.paths.logsDir, 'daemon.log'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    await h.run('logs', '-n', '2');
    const text = h.out.join('\n');
    expect(text).not.toContain('first');
    expect(text).toContain('[scheduler] polled');
    expect(text).toContain('warn');
    await h.run('logs', '-n', '1', '--json');
    expect(JSON.parse(h.out.at(-1)!)).toEqual([lines[2]]);
  });

  test('doctor --json prints every check', async () => {
    const h = harness();
    await h.run('doctor', '--json', '--no-push');
    const checks = JSON.parse(h.out.join('')) as { id: string }[];
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
  });

  test('init --yes --json writes the config and prints the result', async () => {
    const h = harness({ prompter: () => confirmAll(true) });
    await h.run('init', '--yes', '--json', '--first-name', 'Sam', '--regions', 'Delft', '--budget', '1200');
    expect(JSON.parse(h.out.join(''))).toMatchObject({ written: true, configFile: h.paths.configFile });
    expect(readFileSync(h.paths.configFile, 'utf8')).toContain('priceMaxEur: 1200');
  });
});

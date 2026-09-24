import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  createServiceManager,
  resolveCliEntry,
  type ExecFn,
  type ExecResult,
  type ServiceSpec,
} from '../src/service/index.js';
import { renderDesktopEntry, renderSystemdUnit } from '../src/service/systemd.js';
import { renderLaunchdPlist } from '../src/service/launchd.js';
import { renderSchtasksCreateArgs } from '../src/service/schtasks.js';

const spec: ServiceSpec = {
  node: '/usr/bin/node',
  entry: '/opt/nl-property-finder/apps/cli/dist/nlpf.mjs',
  logsDir: '/home/sam/.local/share/nl-property-finder/logs',
};

/**
 * Splits a systemd command line the way systemd does: double quotes, backslash
 * escapes, `%%` everywhere, and `$$` in the arguments (systemd does not expand
 * variables in the executable path).
 */
function systemdArgv(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ') i++;
    if (i >= line.length) break;
    let word = '';
    if (line[i] === '"') {
      i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\') i++;
        word += line[i++];
      }
      i++;
    } else {
      while (i < line.length && line[i] !== ' ') word += line[i++];
    }
    word = word.replaceAll('%%', '%');
    out.push(out.length === 0 ? word : word.replaceAll('$$', '$'));
  }
  return out;
}

function execLine(unit: string): string {
  const line = unit.split('\n').find((l) => l.startsWith('ExecStart='));
  if (!line) throw new Error('no ExecStart');
  return line.slice('ExecStart='.length);
}

function stubExec(respond: (cmd: string) => Partial<ExecResult> = () => ({})) {
  const calls: string[] = [];
  const exec: ExecFn = async (file, args) => {
    const cmd = [file, ...args].join(' ');
    calls.push(cmd);
    const r = respond(cmd);
    return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return { exec, calls };
}

const tempHome = () => mkdtempSync(join(tmpdir(), 'nlpf-svc-'));

describe('renderSystemdUnit', () => {
  test('runs node on the bundled CLI with the daemon command and restarts on failure', () => {
    const unit = renderSystemdUnit(spec);
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/nl-property-finder/apps/cli/dist/nlpf.mjs daemon\n');
    expect(unit).toContain('Restart=on-failure\n');
    expect(unit).toContain('WantedBy=default.target\n');
    expect(unit).not.toContain('NLPF_HOME');
    expect(unit).toMatchSnapshot();
  });

  test('passes NLPF_HOME through when it is set', () => {
    const unit = renderSystemdUnit({ ...spec, home: '/home/sam/nlpf test' });
    expect(unit).toContain('Environment="NLPF_HOME=/home/sam/nlpf test"\n');
  });

  test('contains no shell interpolation, whatever the paths contain', () => {
    const odd: ServiceSpec = {
      node: '/home/sam/My Tools/node $HOME/bin/node',
      entry: '/tmp/a "quoted" `tick` ;rm -rf ~ 100%/$(whoami)/nlpf.mjs',
      logsDir: '/tmp/logs',
      home: '/tmp/100% ${HOME}',
    };
    const unit = renderSystemdUnit(odd);
    expect(unit).not.toMatch(/\b(sh|bash|zsh|dash)\b\s+-c/);
    expect(unit).not.toMatch(/\/bin\/(sh|bash)/);
    const line = execLine(unit);
    // Every % is doubled, and every $ in the arguments too, so systemd expands nothing.
    expect(line.replaceAll('%%', '')).not.toContain('%');
    const args = line.slice(line.indexOf('" ') + 2);
    expect(args.replaceAll('$$', '')).not.toContain('$');
    expect(systemdArgv(line)).toEqual([odd.node, odd.entry, 'daemon']);
    const env = unit.split('\n').find((l) => l.startsWith('Environment='))!;
    expect(env.replaceAll('%%', '')).not.toContain('%');
  });
});

describe('renderLaunchdPlist', () => {
  test('is a LaunchAgent that runs at load with escaped arguments', () => {
    const plist = renderLaunchdPlist({
      ...spec,
      entry: '/Users/sam/a&b <c>/nlpf.mjs',
      home: '/Users/sam/nlpf',
    });
    expect(plist).toContain('<string>nl.property-finder</string>');
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(plist).toContain(
      '<array>\n    <string>/usr/bin/node</string>\n    <string>/Users/sam/a&amp;b &lt;c&gt;/nlpf.mjs</string>\n    <string>daemon</string>\n  </array>',
    );
    expect(plist).toContain('<key>NLPF_HOME</key>\n    <string>/Users/sam/nlpf</string>');
    expect(renderLaunchdPlist(spec)).toMatchSnapshot();
  });
});

describe('renderSchtasksCreateArgs', () => {
  test('creates an at-logon task whose command quotes paths with spaces', () => {
    const args = renderSchtasksCreateArgs({
      node: 'C:\\Program Files\\nodejs\\node.exe',
      entry: 'C:\\nlpf\\dist\\nlpf.mjs',
      logsDir: 'C:\\logs',
      home: 'C:\\Users\\Sam\\nlpf home',
    });
    expect(args).toEqual([
      '/Create',
      '/F',
      '/SC',
      'ONLOGON',
      '/TN',
      'nl-property-finder',
      '/RL',
      'LIMITED',
      '/TR',
      '"C:\\Program Files\\nodejs\\node.exe" C:\\nlpf\\dist\\nlpf.mjs daemon --home "C:\\Users\\Sam\\nlpf home"',
    ]);
  });
});

describe('renderDesktopEntry', () => {
  test('opens the dashboard and quotes arguments per the desktop entry spec', () => {
    const entry = renderDesktopEntry({ exec: ['/usr/bin/node', '/opt/My Apps/nlpf.mjs', 'open'] });
    expect(entry).toContain('Name=NL Property Finder\n');
    expect(entry).toContain('Exec=/usr/bin/node "/opt/My Apps/nlpf.mjs" open\n');
    expect(entry).toContain('Terminal=false\n');
  });
});

describe('systemd manager', () => {
  test('on writes the unit, reloads, and enables it with --now, all through execFile', async () => {
    const home = tempHome();
    const { exec, calls } = stubExec();
    const svc = createServiceManager({ platform: 'linux', env: {}, home, exec });
    const res = await svc.on(spec);
    const unitFile = join(home, '.config', 'systemd', 'user', 'nl-property-finder.service');
    expect(svc.file).toBe(unitFile);
    expect(readFileSync(unitFile, 'utf8')).toBe(renderSystemdUnit(spec));
    expect(res).toMatchObject({ kind: 'systemd', changed: true, restarted: false });
    expect(calls).toEqual([
      'systemctl --user is-active nl-property-finder.service',
      'systemctl --user daemon-reload',
      'systemctl --user enable --now nl-property-finder.service',
    ]);
    const desktop = join(home, '.local', 'share', 'applications', 'nl-property-finder.desktop');
    expect(readFileSync(desktop, 'utf8')).toContain(`Exec=/usr/bin/node ${spec.entry} open`);
  });

  test('on again with the same unit does not reload or restart a running agent', async () => {
    const home = tempHome();
    const { exec, calls } = stubExec((cmd) =>
      cmd.endsWith('is-active nl-property-finder.service') ? { stdout: 'active\n' } : {},
    );
    const svc = createServiceManager({ platform: 'linux', env: {}, home, exec });
    await svc.on(spec);
    calls.length = 0;
    const res = await svc.on(spec);
    expect(res).toMatchObject({ changed: false, restarted: false });
    expect(calls).toEqual([
      'systemctl --user is-active nl-property-finder.service',
      'systemctl --user enable --now nl-property-finder.service',
    ]);
  });

  test('a changed unit restarts an agent that was already running', async () => {
    const home = tempHome();
    const { exec, calls } = stubExec((cmd) =>
      cmd.endsWith('is-active nl-property-finder.service') ? { stdout: 'active\n' } : {},
    );
    const svc = createServiceManager({ platform: 'linux', env: {}, home, exec });
    await svc.on(spec);
    calls.length = 0;
    const res = await svc.on({ ...spec, node: '/usr/local/bin/node' });
    expect(res).toMatchObject({ changed: true, restarted: true });
    expect(calls).toContain('systemctl --user restart nl-property-finder.service');
  });

  test('respects XDG_CONFIG_HOME', () => {
    const home = tempHome();
    const svc = createServiceManager({
      platform: 'linux',
      env: { XDG_CONFIG_HOME: join(home, 'cfg') },
      home,
      exec: stubExec().exec,
    });
    expect(svc.file).toBe(join(home, 'cfg', 'systemd', 'user', 'nl-property-finder.service'));
  });

  test('off disables and stops', async () => {
    const home = tempHome();
    const { exec, calls } = stubExec();
    const svc = createServiceManager({ platform: 'linux', env: {}, home, exec });
    await svc.on(spec);
    calls.length = 0;
    const res = await svc.off();
    expect(res.wasInstalled).toBe(true);
    expect(calls).toEqual(['systemctl --user disable --now nl-property-finder.service']);
  });

  test('off when nothing is installed runs nothing', async () => {
    const { exec, calls } = stubExec();
    const svc = createServiceManager({ platform: 'linux', env: {}, home: tempHome(), exec });
    expect((await svc.off()).wasInstalled).toBe(false);
    expect(calls).toEqual([]);
  });

  test('status reports installed, enabled, active and whether the unit is current', async () => {
    const home = tempHome();
    const { exec } = stubExec((cmd) =>
      cmd.includes('is-enabled')
        ? { stdout: 'enabled\n' }
        : cmd.includes('is-active')
          ? { stdout: 'inactive\n', code: 3 }
          : {},
    );
    const svc = createServiceManager({ platform: 'linux', env: {}, home, exec });
    expect(await svc.status(spec)).toMatchObject({ installed: false, enabled: false, active: false });
    await svc.on(spec);
    expect(await svc.status(spec)).toMatchObject({
      installed: true,
      enabled: true,
      active: false,
      upToDate: true,
    });
    expect(await svc.status({ ...spec, node: '/other/node' })).toMatchObject({ upToDate: false });
  });

  test('a failing systemctl surfaces its message', async () => {
    const { exec } = stubExec((cmd) =>
      cmd.includes('enable') ? { code: 1, stderr: 'Failed to connect to bus: No medium found\n' } : {},
    );
    const svc = createServiceManager({ platform: 'linux', env: {}, home: tempHome(), exec });
    await expect(svc.on(spec)).rejects.toThrow('Failed to connect to bus: No medium found');
  });
});

describe('launchd manager', () => {
  test('on writes the plist and bootstraps it when it is not loaded; off boots it out and disables it', async () => {
    const home = tempHome();
    const { exec, calls } = stubExec((cmd) => (cmd.startsWith('launchctl print') ? { code: 113 } : {}));
    const svc = createServiceManager({ platform: 'darwin', env: {}, home, exec, uid: 501 });
    const plist = join(home, 'Library', 'LaunchAgents', 'nl.property-finder.plist');
    expect(svc.file).toBe(plist);
    await svc.on(spec);
    expect(readFileSync(plist, 'utf8')).toBe(renderLaunchdPlist(spec));
    expect(calls).toEqual([
      'launchctl enable gui/501/nl.property-finder',
      'launchctl print gui/501/nl.property-finder',
      `launchctl bootstrap gui/501 ${plist}`,
    ]);
    calls.length = 0;
    await svc.off();
    expect(calls).toEqual([
      'launchctl bootout gui/501/nl.property-finder',
      'launchctl disable gui/501/nl.property-finder',
    ]);
  });
});

describe('schtasks manager', () => {
  test('on creates the logon task and runs it; off ends and disables it', async () => {
    const { exec, calls } = stubExec((cmd) =>
      cmd.startsWith('schtasks /Query') ? { stdout: 'Status: Ready\nScheduled Task State: Enabled\n' } : {},
    );
    const svc = createServiceManager({ platform: 'win32', env: {}, home: tempHome(), exec });
    await svc.on(spec);
    expect(calls[0]).toBe(['schtasks', ...renderSchtasksCreateArgs(spec)].join(' '));
    expect(calls).toContain('schtasks /Run /TN nl-property-finder');
    calls.length = 0;
    await svc.off();
    expect(calls).toEqual([
      'schtasks /Query /TN nl-property-finder /FO LIST /V',
      'schtasks /End /TN nl-property-finder',
      'schtasks /Change /TN nl-property-finder /DISABLE',
    ]);
  });
});

describe('resolveCliEntry', () => {
  test('the bundle runs itself', () => {
    const bundle = '/opt/nlpf/apps/cli/dist/nlpf.mjs';
    expect(resolveCliEntry(pathToFileURL(bundle).href, () => false)).toBe(bundle);
  });

  test('from source it points the service at the built bundle', () => {
    const root = tempHome();
    const src = join(root, 'apps', 'cli', 'src', 'service', 'index.ts');
    const dist = join(root, 'apps', 'cli', 'dist', 'nlpf.mjs');
    mkdirSync(join(root, 'apps', 'cli', 'dist'), { recursive: true });
    writeFileSync(dist, '');
    expect(existsSync(dist)).toBe(true);
    expect(resolveCliEntry(pathToFileURL(src).href)).toBe(dist);
  });

  test('from source without a build it says how to build', () => {
    const src = join(tempHome(), 'apps', 'cli', 'src', 'service', 'index.ts');
    expect(() => resolveCliEntry(pathToFileURL(src).href, () => false)).toThrow(
      /npm run build -w @nlpf\/cli/,
    );
  });
});

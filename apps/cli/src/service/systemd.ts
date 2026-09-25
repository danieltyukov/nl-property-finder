import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  SERVICE_NAME,
  mustRun,
  readIfExists,
  writeIfChanged,
  type ServiceDeps,
  type ServiceManager,
  type ServiceSpec,
} from './common.js';

const UNIT = `${SERVICE_NAME}.service`;

/**
 * Quotes one word for an ExecStart line. systemd expands `%` specifiers in
 * every word and `$VAR` in the arguments (not in the executable path), so `%`
 * is always doubled and `$` is doubled in arguments. Words with spaces,
 * quotes, backslashes or semicolons are wrapped in double quotes.
 */
export function systemdEscapeArg(arg: string, opts: { executable?: boolean } = {}): string {
  let s = arg.replace(/%/g, '%%');
  if (!opts.executable) s = s.replace(/\$/g, () => '$$');
  if (s !== '' && !/[\s"'\\;]/.test(s)) return s;
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')}"`;
}

/** An Environment= value: specifiers are expanded there (so `%` is doubled), variables are not. */
function systemdEnv(name: string, value: string): string {
  const v = `${name}=${value}`
    .replace(/%/g, '%%')
    .replace(/[\\"]/g, (c) => `\\${c}`)
    .replace(/\n/g, '\\n');
  return `Environment="${v}"`;
}

export function renderSystemdUnit(spec: ServiceSpec): string {
  const exec = [
    systemdEscapeArg(spec.node, { executable: true }),
    systemdEscapeArg(spec.entry),
    systemdEscapeArg('daemon'),
  ].join(' ');
  const lines = [
    '# Written by nlpf on. nlpf off stops and disables it.',
    '[Unit]',
    'Description=NL Property Finder agent',
    'Documentation=https://github.com/danieltyukov/nl-property-finder',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${exec}`,
    'Restart=on-failure',
    'RestartSec=10',
    'TimeoutStopSec=30',
  ];
  if (spec.home) lines.push(systemdEnv('NLPF_HOME', spec.home));
  lines.push('', '[Install]', 'WantedBy=default.target', '');
  return lines.join('\n');
}

/** Quotes one Exec= argument as the desktop entry spec asks, then escapes it as a key file string. */
function desktopEscapeArg(arg: string): string {
  let s = arg;
  if (s === '' || /[\s"'\\><~|&;$*?#()`]/.test(s)) {
    s = `"${s.replace(/["`$\\]/g, (c) => `\\${c}`)}"`;
  }
  return s.replace(/\\/g, '\\\\').replace(/%/g, '%%');
}

/** The launcher that shows up in the application menu and opens the dashboard. */
export function renderDesktopEntry(opts: { exec: string[] }): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=NL Property Finder',
    'GenericName=Rental home finder',
    'Comment=Open the NL Property Finder dashboard',
    `Exec=${opts.exec.map(desktopEscapeArg).join(' ')}`,
    'Icon=nl-property-finder',
    'Terminal=false',
    'Categories=Utility;',
    'Keywords=rental;housing;huur;woning;kamer;',
    'StartupNotify=false',
    '',
  ].join('\n');
}

export function systemdUnitPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user', UNIT);
}

export function desktopEntryPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'applications', `${SERVICE_NAME}.desktop`);
}

/** Where the launcher's `Icon=nl-property-finder` resolves in the user's hicolor theme. */
export function desktopIconPath(env: NodeJS.ProcessEnv, home: string): string {
  const data = env.XDG_DATA_HOME || join(home, '.local', 'share');
  return join(data, 'icons', 'hicolor', 'scalable', 'apps', `${SERVICE_NAME}.svg`);
}

/** The icon the build puts next to the bundle, or null when running without one. */
function bundledIcon(entry: string): string | null {
  return readIfExists(join(dirname(entry), 'icons', `${SERVICE_NAME}.svg`));
}

export function createSystemdManager(deps: ServiceDeps): ServiceManager {
  const file = systemdUnitPath(deps.env, deps.home);
  const ctl = (...args: string[]) => deps.exec('systemctl', ['--user', ...args]);

  return {
    kind: 'systemd',
    file,

    async on(spec) {
      const wasActive = (await ctl('is-active', UNIT)).stdout.trim() === 'active';
      const changed = writeIfChanged(file, renderSystemdUnit(spec));
      try {
        const icon = bundledIcon(spec.entry);
        const iconFile = desktopIconPath(deps.env, deps.home);
        if (icon !== null && writeIfChanged(iconFile, icon)) {
          // A theme cache older than the new file would hide it; refreshing is best effort.
          await deps.exec('gtk-update-icon-cache', ['-f', '-t', join(dirname(iconFile), '..', '..')]);
        }
        writeIfChanged(
          desktopEntryPath(deps.env, deps.home),
          renderDesktopEntry({ exec: [spec.node, spec.entry, 'open'] }),
        );
      } catch {
        // The launcher is a convenience; a read-only applications folder must not stop the service.
      }
      if (changed) await mustRun(deps.exec, 'systemctl', ['--user', 'daemon-reload']);
      await mustRun(deps.exec, 'systemctl', ['--user', 'enable', '--now', UNIT]);
      let restarted = false;
      if (changed && wasActive) {
        await mustRun(deps.exec, 'systemctl', ['--user', 'restart', UNIT]);
        restarted = true;
      }
      return { kind: 'systemd', file, changed, restarted };
    },

    async off() {
      if (!existsSync(file)) return { kind: 'systemd', file, wasInstalled: false };
      await mustRun(deps.exec, 'systemctl', ['--user', 'disable', '--now', UNIT]);
      return { kind: 'systemd', file, wasInstalled: true };
    },

    async status(spec) {
      const content = readIfExists(file);
      if (content === null) return { kind: 'systemd', file, installed: false, enabled: false, active: false };
      const enabled = (await ctl('is-enabled', UNIT)).stdout.trim() === 'enabled';
      const active = (await ctl('is-active', UNIT)).stdout.trim() === 'active';
      const status = { kind: 'systemd' as const, file, installed: true, enabled, active };
      return spec ? { ...status, upToDate: content === renderSystemdUnit(spec) } : status;
    },
  };
}

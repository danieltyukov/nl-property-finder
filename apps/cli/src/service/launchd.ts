import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  mustRun,
  readIfExists,
  writeIfChanged,
  type ServiceDeps,
  type ServiceManager,
  type ServiceSpec,
} from './common.js';

/*
 * macOS: a LaunchAgent in ~/Library/LaunchAgents. Generated from the same spec
 * as the systemd unit; documented as untested because the project is built and
 * verified on Linux.
 */

export const LAUNCHD_LABEL = 'nl.property-finder';

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderLaunchdPlist(spec: ServiceSpec): string {
  const log = join(spec.logsDir, 'launchd.log');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<!-- Written by nlpf on. nlpf off stops and disables it. -->',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LAUNCHD_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...[spec.node, spec.entry, 'daemon'].map((a) => `    <string>${xml(a)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ThrottleInterval</key>',
    '  <integer>10</integer>',
    '  <key>StandardOutPath</key>',
    `  <string>${xml(log)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(log)}</string>`,
  ];
  if (spec.home) {
    lines.push(
      '  <key>EnvironmentVariables</key>',
      '  <dict>',
      '    <key>NLPF_HOME</key>',
      `    <string>${xml(spec.home)}</string>`,
      '  </dict>',
    );
  }
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}

export function createLaunchdManager(deps: ServiceDeps): ServiceManager {
  const file = join(deps.home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  const uid = deps.uid ?? process.getuid?.() ?? 501;
  const domain = `gui/${uid}`;
  const target = `${domain}/${LAUNCHD_LABEL}`;

  return {
    kind: 'launchd',
    file,

    async on(spec) {
      const changed = writeIfChanged(file, renderLaunchdPlist(spec));
      await mustRun(deps.exec, 'launchctl', ['enable', target]);
      const loaded = (await deps.exec('launchctl', ['print', target])).code === 0;
      let restarted = false;
      if (loaded && changed) {
        await deps.exec('launchctl', ['bootout', target]);
        await mustRun(deps.exec, 'launchctl', ['bootstrap', domain, file]);
        restarted = true;
      } else if (loaded) {
        // Starts it if it is loaded but not running; leaves a running agent alone.
        await mustRun(deps.exec, 'launchctl', ['kickstart', target]);
      } else {
        await mustRun(deps.exec, 'launchctl', ['bootstrap', domain, file]);
      }
      return { kind: 'launchd', file, changed, restarted };
    },

    async off() {
      if (!existsSync(file)) return { kind: 'launchd', file, wasInstalled: false };
      // bootout fails when the agent is not loaded, which is fine: the goal is that it is not running.
      await deps.exec('launchctl', ['bootout', target]);
      await mustRun(deps.exec, 'launchctl', ['disable', target]);
      return { kind: 'launchd', file, wasInstalled: true };
    },

    async status(spec) {
      const content = readIfExists(file);
      if (content === null) return { kind: 'launchd', file, installed: false, enabled: false, active: false };
      const printed = await deps.exec('launchctl', ['print', target]);
      const disabled = await deps.exec('launchctl', ['print-disabled', domain]);
      const enabled = !new RegExp(`"${LAUNCHD_LABEL.replace(/\./g, '\\.')}"\\s*=>\\s*(true|disabled)`).test(
        disabled.stdout,
      );
      const active = printed.code === 0 && /state = running/.test(printed.stdout);
      const status = { kind: 'launchd' as const, file, installed: true, enabled, active };
      return spec ? { ...status, upToDate: content === renderLaunchdPlist(spec) } : status;
    },
  };
}

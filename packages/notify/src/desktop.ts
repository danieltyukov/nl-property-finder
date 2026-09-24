import { execFile as nodeExecFile } from 'node:child_process';
import type { Notification, Notifier } from '@nlpf/core';

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { timeout: number; windowsHide: boolean; env?: NodeJS.ProcessEnv },
  callback: (error: Error | null) => void,
) => unknown;

export interface DesktopOptions {
  platform?: NodeJS.Platform;
  execFile?: ExecFileFn;
  appName?: string;
}

const defaultExec: ExecFileFn = (file, args, options, callback) =>
  nodeExecFile(file, [...args], options, (error) => callback(error));

const plain = (s: string, max: number): string => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, max);

const urgency = (p: Notification['priority']): string => (p >= 5 ? 'critical' : p <= 2 ? 'low' : 'normal');

// PowerShell reads the text from the environment, so nothing the notification says is ever
// part of the script. The AppUserModelID is PowerShell's own, which Windows always accepts.
const TOAST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
  '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
  '$t = [System.Security.SecurityElement]::Escape($env:NLPF_TOAST_TITLE)',
  '$b = [System.Security.SecurityElement]::Escape($env:NLPF_TOAST_BODY)',
  '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
  '$x.LoadXml("<toast><visual><binding template=\'ToastGeneric\'><text>$t</text><text>$b</text></binding></visual></toast>")',
  "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))',
].join('; ');

/**
 * Desktop notifications: notify-send on Linux, osascript on macOS and a
 * PowerShell toast on Windows. Always through execFile with an argument list;
 * the title and body are never interpolated into a shell or script string.
 */
export function createDesktopNotifier(opts: DesktopOptions = {}): Notifier {
  const platform = opts.platform ?? process.platform;
  const exec = opts.execFile ?? defaultExec;
  const appName = opts.appName ?? 'NL Property Finder';

  const run = (file: string, args: string[], env?: NodeJS.ProcessEnv) =>
    new Promise<void>((resolve, reject) => {
      const options: { timeout: number; windowsHide: boolean; env?: NodeJS.ProcessEnv } = { timeout: 10_000, windowsHide: true };
      if (env) options.env = env;
      exec(file, args, options, (error) => (error ? reject(error) : resolve()));
    });

  return {
    id: 'desktop',
    async send(n) {
      const title = plain(n.title, 200);
      const body = plain(n.body || n.title, 500);
      if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
        await run('notify-send', [`--app-name=${appName}`, `--urgency=${urgency(n.priority)}`, '--', title, body]);
      } else if (platform === 'darwin') {
        // osascript would read a leading dash as an option; a leading space keeps it text.
        const arg = (s: string) => (s.startsWith('-') ? ` ${s}` : s);
        await run('osascript', [
          '-e', 'on run argv',
          '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
          '-e', 'end run',
          arg(title),
          arg(body),
        ]);
      } else if (platform === 'win32') {
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', TOAST_SCRIPT], {
          ...process.env,
          NLPF_TOAST_TITLE: title,
          NLPF_TOAST_BODY: body,
        });
      }
    },
  };
}

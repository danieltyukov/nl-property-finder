import { execFileSync } from 'node:child_process';

/** What a window needs to reach the person's screen. */
const DESKTOP_VARS = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'DBUS_SESSION_BUS_ADDRESS'];

/** Parses `systemctl --user show-environment`: KEY=value lines, where systemd writes odd values as $'...'. */
export function parseSessionEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let value = line.slice(eq + 1);
    if (value.startsWith("$'") && value.endsWith("'")) value = value.slice(2, -1).replace(/\\(['\\])/g, '$1');
    out[line.slice(0, eq)] = value;
  }
  return out;
}

function userManagerEnv(): string {
  return execFileSync('systemctl', ['--user', 'show-environment'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
}

/**
 * The display variables of the person's desktop session, to add to `env`.
 * Empty when `env` already reaches a screen. A daemon that systemd started at
 * boot has none, because the desktop publishes them to the user manager only
 * after login; asking the manager when a window is needed finds the screen
 * without a restart. Undefined when there is no desktop session at all.
 */
export function desktopSessionEnv(
  env: NodeJS.ProcessEnv = process.env,
  read: () => string = userManagerEnv,
): Record<string, string> | undefined {
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return {};
  let session: Record<string, string>;
  try {
    session = parseSessionEnv(read());
  } catch {
    return undefined; // no systemd user manager (a container, macOS, Windows)
  }
  if (!session.DISPLAY && !session.WAYLAND_DISPLAY) return undefined;
  const out: Record<string, string> = {};
  for (const key of DESKTOP_VARS) if (session[key]) out[key] = session[key];
  return out;
}

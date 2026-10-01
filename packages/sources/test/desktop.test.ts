import { expect, test } from 'vitest';
import { desktopSessionEnv, parseSessionEnv } from '../src/runtime/desktop.js';

// What `systemctl --user show-environment` prints on a GNOME Wayland desktop.
const GNOME = [
  'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus',
  'DISPLAY=:0',
  'HOME=/home/sam',
  'WAYLAND_DISPLAY=wayland-0',
  'XAUTHORITY=/run/user/1000/.mutter-Xwaylandauth.6MBCW3',
  'XDG_RUNTIME_DIR=/run/user/1000',
  'XDG_SESSION_TYPE=wayland',
  "GREETING=$'it\\'s here'",
  '',
].join('\n');

test('systemd output is read, quoted values included', () => {
  const env = parseSessionEnv(GNOME);
  expect(env.DISPLAY).toBe(':0');
  expect(env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus');
  expect(env.GREETING).toBe("it's here");
});

test('a daemon started before the desktop finds the screen through the user manager', () => {
  expect(desktopSessionEnv({ HOME: '/home/sam' }, () => GNOME)).toEqual({
    DISPLAY: ':0',
    WAYLAND_DISPLAY: 'wayland-0',
    XAUTHORITY: '/run/user/1000/.mutter-Xwaylandauth.6MBCW3',
    XDG_RUNTIME_DIR: '/run/user/1000',
    XDG_SESSION_TYPE: 'wayland',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  });
});

test('a process that already has a display needs nothing added, and asks nobody', () => {
  expect(desktopSessionEnv({ DISPLAY: ':1' }, () => {
    throw new Error('not asked');
  })).toEqual({});
});

test('no desktop session, or no user manager, is no desktop', () => {
  expect(desktopSessionEnv({}, () => 'HOME=/home/sam\nXDG_RUNTIME_DIR=/run/user/1000\n')).toBeUndefined();
  expect(desktopSessionEnv({}, () => {
    throw new Error('systemctl: not found');
  })).toBeUndefined();
});

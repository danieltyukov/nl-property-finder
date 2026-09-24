import { expect, test } from 'vitest';
import { createDesktopNotifier, type ExecFileFn } from '../src/desktop.js';

interface Call {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

/** Records calls instead of popping a real notification. */
function stubExec(fail?: Error): { exec: ExecFileFn; calls: Call[] } {
  const calls: Call[] = [];
  const exec: ExecFileFn = (file, args, options, callback) => {
    calls.push({ file, args: [...args], env: options.env });
    queueMicrotask(() => callback(fail ?? null));
  };
  return { exec, calls };
}

const tricky = { title: '-u critical $(rm -rf ~)', body: '"; do shell script "id"; `whoami`', priority: 5 as const };

test('Linux uses notify-send with the text as separate arguments after --', async () => {
  const { exec, calls } = stubExec();
  const n = createDesktopNotifier({ platform: 'linux', execFile: exec });
  expect(n.id).toBe('desktop');
  await n.send(tricky);
  expect(calls).toEqual([
    {
      file: 'notify-send',
      args: ['--app-name=NL Property Finder', '--urgency=critical', '--', '-u critical $(rm -rf ~)', '"; do shell script "id"; `whoami`'],
      env: undefined,
    },
  ]);
});

test('urgency follows priority', async () => {
  const { exec, calls } = stubExec();
  const n = createDesktopNotifier({ platform: 'linux', execFile: exec });
  await n.send({ title: 'a', body: 'b', priority: 1 });
  await n.send({ title: 'a', body: 'b', priority: 3 });
  expect(calls.map((c) => c.args[1])).toEqual(['--urgency=low', '--urgency=normal']);
});

test('macOS passes the text to a fixed AppleScript as arguments, never inside the script', async () => {
  const { exec, calls } = stubExec();
  await createDesktopNotifier({ platform: 'darwin', execFile: exec }).send(tricky);
  const call = calls[0]!;
  expect(call.file).toBe('osascript');
  const script = call.args.filter((_, i) => call.args[i - 1] === '-e').join('\n');
  expect(script).toBe('on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run');
  expect(script).not.toContain('rm -rf');
  // A leading dash would be read as an osascript option, so it is shielded with a space.
  expect(call.args.slice(-2)).toEqual([' -u critical $(rm -rf ~)', '"; do shell script "id"; `whoami`']);
});

test('Windows reads the text from environment variables in a fixed PowerShell script', async () => {
  const { exec, calls } = stubExec();
  await createDesktopNotifier({ platform: 'win32', execFile: exec }).send(tricky);
  const call = calls[0]!;
  expect(call.file).toBe('powershell.exe');
  expect(call.args.join(' ')).not.toContain('rm -rf');
  expect(call.args.join(' ')).toContain('$env:NLPF_TOAST_TITLE');
  expect(call.env?.NLPF_TOAST_TITLE).toBe('-u critical $(rm -rf ~)');
  expect(call.env?.NLPF_TOAST_BODY).toBe('"; do shell script "id"; `whoami`');
});

test('a failing command rejects', async () => {
  const { exec } = stubExec(Object.assign(new Error('spawn notify-send ENOENT'), { code: 'ENOENT' }));
  await expect(createDesktopNotifier({ platform: 'linux', execFile: exec }).send(tricky)).rejects.toThrow(/ENOENT/);
});

test('other platforms do nothing', async () => {
  const { exec, calls } = stubExec();
  await createDesktopNotifier({ platform: 'aix', execFile: exec }).send(tricky);
  expect(calls).toEqual([]);
});

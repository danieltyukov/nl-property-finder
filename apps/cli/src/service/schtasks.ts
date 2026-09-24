import { SERVICE_NAME, mustRun, type ServiceDeps, type ServiceManager, type ServiceSpec } from './common.js';

/*
 * Windows: a Task Scheduler entry that starts the daemon at logon. Documented
 * as untested. Known limit: Task Scheduler shows a console window for
 * node.exe; hiding it needs a wrapper that would be a shell string, which this
 * project does not use.
 */

export const TASK_NAME = SERVICE_NAME;

/** Quotes one argument for the /TR command line when it contains spaces or quotes. */
function winQuote(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/** The argument array for `schtasks`, passed to execFile as is. */
export function renderSchtasksCreateArgs(spec: ServiceSpec): string[] {
  // Task Scheduler cannot set environment variables, so NLPF_HOME travels as a flag.
  const command = [spec.node, spec.entry, 'daemon', ...(spec.home ? ['--home', spec.home] : [])]
    .map(winQuote)
    .join(' ');
  return ['/Create', '/F', '/SC', 'ONLOGON', '/TN', TASK_NAME, '/RL', 'LIMITED', '/TR', command];
}

function parseQuery(stdout: string): { running: boolean; enabled: boolean } {
  const running = /^\s*Status:\s*Running/im.test(stdout);
  const enabled = !/^\s*(Scheduled Task State|Status):\s*Disabled/im.test(stdout);
  return { running, enabled };
}

export function createSchtasksManager(deps: ServiceDeps): ServiceManager {
  const query = () => deps.exec('schtasks', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST', '/V']);

  return {
    kind: 'schtasks',
    file: TASK_NAME,

    async on(spec) {
      await mustRun(deps.exec, 'schtasks', renderSchtasksCreateArgs(spec));
      const q = await query();
      if (!parseQuery(q.stdout).running) await mustRun(deps.exec, 'schtasks', ['/Run', '/TN', TASK_NAME]);
      // /Create /F always rewrites the task, so there is no cheap way to tell whether it changed.
      return { kind: 'schtasks', file: TASK_NAME, changed: true, restarted: false };
    },

    async off() {
      const q = await query();
      if (q.code !== 0) return { kind: 'schtasks', file: TASK_NAME, wasInstalled: false };
      // /End fails when the task is not running, which is the state we want anyway.
      await deps.exec('schtasks', ['/End', '/TN', TASK_NAME]);
      await mustRun(deps.exec, 'schtasks', ['/Change', '/TN', TASK_NAME, '/DISABLE']);
      return { kind: 'schtasks', file: TASK_NAME, wasInstalled: true };
    },

    async status() {
      const q = await query();
      if (q.code !== 0)
        return { kind: 'schtasks', file: TASK_NAME, installed: false, enabled: false, active: false };
      const { running, enabled } = parseQuery(q.stdout);
      return { kind: 'schtasks', file: TASK_NAME, installed: true, enabled, active: running };
    },
  };
}

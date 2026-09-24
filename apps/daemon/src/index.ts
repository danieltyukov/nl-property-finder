import type { Logger, Paths } from '@nlpf/core';

/*
 * TEMPORARY STUB, written by Task 13 (CLI) so the CLI has the fixed
 * `startDaemon` signature to build against. Task 14 replaces this whole file
 * with the real daemon. Nothing here is meant to survive that task.
 */

export interface StartDaemonOptions {
  paths: Paths;
  demo?: boolean;
  port?: number;
  sandboxPort?: number;
  log?: Logger;
}

export interface DaemonHandle {
  url: string;
  token: string;
  stop(): Promise<void>;
}

export async function startDaemon(_opts: StartDaemonOptions): Promise<DaemonHandle> {
  throw new Error('The daemon is not implemented yet. This is the Task 13 stub that Task 14 replaces.');
}

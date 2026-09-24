/*
 * TEMPORARY. apps/daemon/package.json has no "exports" field yet, so
 * TypeScript cannot resolve `@nlpf/daemon` and the CLI would not typecheck.
 * This declares the signature fixed in the plan (Task 13). Delete this file
 * once apps/daemon/package.json has `"exports": "./src/index.ts"`, so the
 * real module's types are checked instead.
 */
declare module '@nlpf/daemon' {
  import type { Logger, Paths } from '@nlpf/core';

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

  export function startDaemon(opts: StartDaemonOptions): Promise<DaemonHandle>;
}

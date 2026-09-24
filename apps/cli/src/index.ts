/*
 * What other workspace code (the e2e suite, docs scripts) may use from the
 * CLI. The `nlpf` binary itself starts in main.ts.
 */
export { ApiError, DaemonNotRunningError, clientFromPaths, createClient, type NlpfClient } from './client.js';
export { createMcpServer, runMcpStdio } from './mcp/server.js';
export { TOOLS } from './mcp/tools.js';
export { buildProgram } from './commands/index.js';
export { renderDesktopEntry, renderSystemdUnit } from './service/systemd.js';
export { renderLaunchdPlist } from './service/launchd.js';
export { renderSchtasksCreateArgs } from './service/schtasks.js';

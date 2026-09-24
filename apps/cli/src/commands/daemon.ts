import { resolve } from 'node:path';
import type { Command } from 'commander';
import { resolvePaths } from '@nlpf/core';
import { UsageError, run, type CliDeps } from './context.js';

/*
 * nlpf daemon runs the agent in the foreground (the service runs exactly
 * this). nlpf demo runs it against the fake Netherlands in a throwaway home.
 * Both load @nlpf/daemon only when they start, so the other commands stay fast.
 */

function port(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535)
    throw new UsageError(`${flag} takes a port number between 1 and 65535.`);
  return n;
}

export function registerDaemon(program: Command, deps: CliDeps): void {
  program
    .command('daemon')
    .description('Run the agent in the foreground. The service started by nlpf on runs this')
    .option('--port <port>', 'listen on this port instead of server.port from the config')
    .option('--home <dir>', 'use this folder for config and data, like NLPF_HOME')
    .option('--json', 'print the address as JSON once the agent is listening')
    .action((o: { port?: string; home?: string; json?: boolean }) =>
      run(deps, o.json, async () => {
        const listenPort = port(o.port, '--port');
        if (o.home) deps.env.NLPF_HOME = resolve(o.home);
        const paths = deps.paths();
        const startDaemon = await deps.loadStartDaemon();
        const handle = await startDaemon({ paths, ...(listenPort ? { port: listenPort } : {}) });
        deps.io.out(
          o.json
            ? JSON.stringify({ url: handle.url })
            : `The agent is listening at ${handle.url}. Ctrl+C stops it; when it runs as a service, use nlpf off.`,
        );
        await deps.waitForExit();
        await handle.stop();
        return { data: undefined, printed: true };
      }),
    );

  program
    .command('demo')
    .description(
      'Try the agent against a simulated rental market: fake sites, fake landlords, nothing leaves this computer',
    )
    .option('--port <port>', 'dashboard and API port')
    .option('--sandbox-port <port>', 'port for the simulated sites')
    .option('--no-open', 'do not open the dashboard in a browser')
    .option('--json', 'print the address and home folder as JSON once the demo runs')
    .action((o: { port?: string; sandboxPort?: string; open: boolean; json?: boolean }) =>
      run(deps, o.json, async () => {
        const listenPort = port(o.port, '--port');
        const sandboxPort = port(o.sandboxPort, '--sandbox-port');
        const home = deps.env.NLPF_HOME ?? deps.makeTempDir('nlpf-demo-');
        const paths = resolvePaths({ ...deps.env, NLPF_HOME: home }, deps.platform);
        const startDaemon = await deps.loadStartDaemon();
        const handle = await startDaemon({
          paths,
          demo: true,
          ...(listenPort ? { port: listenPort } : {}),
          ...(sandboxPort ? { sandboxPort } : {}),
        });
        const url = handle.url.replace(/\/?$/, '/');
        if (o.open) {
          await deps
            .openUrl(url)
            .catch((e: unknown) => deps.io.err(e instanceof Error ? e.message : String(e)));
        }
        deps.io.out(
          o.json
            ? JSON.stringify({ url: handle.url, home })
            : [
                `The demo is running at ${url}`,
                'Listings, landlords and their replies are simulated. Nothing is sent to anyone.',
                `Its data lives in ${home} for this run.`,
                `Other commands against the demo: NLPF_HOME=${home} NLPF_URL=${handle.url} nlpf status`,
                'Ctrl+C stops it.',
              ].join('\n'),
        );
        await deps.waitForExit();
        await handle.stop();
        return { data: undefined, printed: true };
      }),
    );

  program
    .command('mcp')
    .description('Run the MCP server on stdin and stdout, for Claude Code, Claude Desktop and other agents')
    .option('--json', 'accepted for consistency; MCP always speaks JSON-RPC')
    .addHelpText(
      'after',
      '\nClaude Code: claude mcp add nl-property-finder -- nlpf mcp\nThe agent must be running (nlpf on); tools report it when it is not.',
    )
    .action((o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        await deps.runMcp(deps.client(deps.paths()));
        return { data: undefined, printed: true };
      }),
    );
}

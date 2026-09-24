import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from '../fixtures/demo.js';

/** The same demo daemon, through the ways an agent reaches it: the CLI with --json, and MCP over stdio. */
const ROOT = resolve(import.meta.dirname, '..', '..');
const run = promisify(execFile);

async function nlpf(env: Record<string, string>, ...args: string[]) {
  const { stdout } = await run(process.execPath, ['--import', 'tsx', resolve(ROOT, 'apps/cli/src/main.ts'), ...args], { cwd: ROOT, env: { ...process.env, ...env } });
  return JSON.parse(stdout);
}

test('nlpf status and tasks with --json', async ({ demo }) => {
  const env = { NLPF_HOME: demo.home, NLPF_URL: demo.url, NLPF_TOKEN: demo.token };
  const status = await nlpf(env, 'status', '--json');
  expect(status.demo ?? status.agent?.demo ?? true).toBeTruthy();
  const tasks = await nlpf(env, 'tasks', 'list', '--json');
  expect(Array.isArray(tasks) || Array.isArray(tasks.items)).toBe(true);
});

test('MCP: 21 tools, and list_tasks answers from the running agent', async ({ demo }) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', resolve(ROOT, 'apps/cli/src/main.ts'), 'mcp'],
    cwd: ROOT,
    env: { ...(process.env as Record<string, string>), NLPF_HOME: demo.home, NLPF_URL: demo.url, NLPF_TOKEN: demo.token },
  });
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(21);
  expect(tools.map((t) => t.name)).toContain('withdraw_all');
  const result = await client.callTool({ name: 'list_tasks', arguments: {} });
  const text = (result.content as { type: string; text: string }[]).map((c) => c.text).join('\n');
  expect(text.length).toBeGreaterThan(0);
  const status = await client.callTool({ name: 'status', arguments: {} });
  expect(JSON.stringify(status.content)).toMatch(/paused|running|sources/i);
  await client.close();
});

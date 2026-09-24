import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ConfigSchema, type Task } from '@nlpf/core';
import { DaemonNotRunningError, type NlpfClient } from '../src/client.js';
import { PassThrough } from 'node:stream';
import { createMcpServer, runMcpStdio } from '../src/mcp/server.js';

const EXPECTED_TOOLS = [
  'status',
  'search_listings',
  'get_property',
  'list_applications',
  'list_tasks',
  'resolve_task',
  'list_conversations',
  'get_conversation',
  'draft_message',
  'send_message',
  'list_viewings',
  'get_searches',
  'update_search',
  'get_profile',
  'update_profile',
  'pause',
  'resume',
  'source_health',
  'test_source',
  'stats',
  'withdraw_all',
];

const tasks: Task[] = [
  {
    id: 't_1',
    kind: 'viewing_booked',
    title: 'Viewing booked: Oude Delft 12A',
    reason: 'The landlord offered Thursday 18:30.',
    priority: 2,
    state: 'open',
    createdAt: '2026-09-24T08:00:00Z',
    updatedAt: '2026-09-24T08:00:00Z',
  },
  {
    id: 't_2',
    kind: 'payment_warning',
    title: 'Deposit asked before a viewing',
    reason: 'Asking for money before a viewing is a scam sign.',
    priority: 1,
    state: 'open',
    createdAt: '2026-09-24T09:00:00Z',
    updatedAt: '2026-09-24T09:00:00Z',
  },
];

/** A client whose every method fails unless the test provides it. */
function stubClient(overrides: Partial<NlpfClient>): NlpfClient {
  return new Proxy(overrides as NlpfClient, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof NlpfClient];
      if (prop === 'baseUrl') return 'http://127.0.0.1:7431';
      return () => Promise.reject(new Error(`stub client: ${String(prop)} not provided`));
    },
  });
}

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(stub: NlpfClient): Promise<Client> {
  const server = createMcpServer(stub);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

function text(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  expect(content[0]?.type).toBe('text');
  return content[0]!.text;
}

describe('MCP server', () => {
  test('lists exactly the 21 tools, each with a description and an object input schema', async () => {
    const c = await connect(stubClient({}));
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const t of tools) {
      expect(t.description?.length, t.name).toBeGreaterThan(80);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  test('list_tasks returns the tasks from the daemon as text content', async () => {
    const tasksFn = vi.fn(async () => ({ items: tasks }));
    const c = await connect(stubClient({ tasks: tasksFn }));
    const result = await c.callTool({ name: 'list_tasks', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual(tasks);
    expect(tasksFn).toHaveBeenCalledWith({ state: 'open' });
  });

  test('tools that contact real people say so', async () => {
    const c = await connect(stubClient({}));
    const { tools } = await c.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of ['send_message', 'resolve_task', 'withdraw_all']) {
      expect(byName.get(name)?.description, name).toMatch(/real people|real person/i);
    }
    expect(byName.get('resolve_task')?.description).toMatch(/approve/);
    expect(byName.get('resolve_task')?.description).toMatch(/send_draft/);
    expect(byName.get('send_message')?.annotations?.openWorldHint).toBe(true);
    expect(byName.get('list_tasks')?.annotations?.readOnlyHint).toBe(true);
  });

  test('withdraw_all refuses without confirm: true and sends nothing', async () => {
    const withdrawAll = vi.fn(async () => ({ withdrawn: 2 }));
    const c = await connect(stubClient({ withdrawAll }));
    const refused = await c
      .callTool({ name: 'withdraw_all', arguments: { foundAddress: 'Oude Delft 12A' } })
      .catch((e: unknown) => ({ isError: true, error: e }));
    expect(refused.isError).toBe(true);
    const falseConfirm = await c
      .callTool({ name: 'withdraw_all', arguments: { confirm: false } })
      .catch((e: unknown) => ({ isError: true, error: e }));
    expect(falseConfirm.isError).toBe(true);
    expect(withdrawAll).not.toHaveBeenCalled();

    const ok = await c.callTool({
      name: 'withdraw_all',
      arguments: { confirm: true, foundAddress: 'Oude Delft 12A' },
    });
    expect(ok.isError).toBeFalsy();
    expect(withdrawAll).toHaveBeenCalledWith({ foundAddress: 'Oude Delft 12A', pause: true });
  });

  test('a daemon that is not running becomes a tool error with the plain message', async () => {
    const c = await connect(stubClient({ status: () => Promise.reject(new DaemonNotRunningError()) }));
    const result = await c.callTool({ name: 'status', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('The agent is not running. Start it with nlpf on.');
  });

  test('send_message sends the body to the conversation', async () => {
    const sendMessage = vi.fn(async () => ({ id: 'm_1', status: 'sent' }));
    const c = await connect(stubClient({ sendMessage }));
    const result = await c.callTool({
      name: 'send_message',
      arguments: { conversationId: 'c_1', body: 'Hello' },
    });
    expect(result.isError).toBeFalsy();
    expect(sendMessage).toHaveBeenCalledWith('c_1', { body: 'Hello', send: true });
  });

  test('update_search changes only the given fields of one search', async () => {
    const config = ConfigSchema.parse({
      searches: [
        { id: 'main', name: 'Main search', priceMaxEur: 1400, types: ['studio', 'apartment'] },
        { id: 'rooms', name: 'Rooms', priceMaxEur: 700 },
      ],
    });
    const patchConfig = vi.fn(async () => ({}));
    const c = await connect(stubClient({ config: async () => config, patchConfig }));
    const result = await c.callTool({ name: 'update_search', arguments: { id: 'main', priceMaxEur: 1500 } });
    expect(result.isError).toBeFalsy();
    const call = patchConfig.mock.calls[0] as unknown as [
      { section: string; value: { id: string; priceMaxEur: number; types: string[] }[] },
    ];
    expect(call[0].section).toBe('searches');
    expect(call[0].value[0]).toMatchObject({ id: 'main', priceMaxEur: 1500, types: ['studio', 'apartment'] });
    expect(call[0].value[1]).toMatchObject({ id: 'rooms', priceMaxEur: 700 });

    const missing = await c.callTool({ name: 'update_search', arguments: { id: 'nope', priceMaxEur: 1 } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('main, rooms');
  });

  test('update_profile merges facts and keeps the rest', async () => {
    const config = ConfigSchema.parse({
      profile: { firstName: 'Sam', about: 'PhD student', facts: { bike: 'yes' } },
    });
    const patchConfig = vi.fn(async () => ({}));
    const c = await connect(stubClient({ config: async () => config, patchConfig }));
    await c.callTool({
      name: 'update_profile',
      arguments: { organisation: 'TU Delft', facts: { pets: 'no', bike: '' } },
    });
    const call = patchConfig.mock.calls[0] as unknown as [
      { section: string; value: Record<string, unknown> },
    ];
    expect(call[0].section).toBe('profile');
    expect(call[0].value).toMatchObject({
      firstName: 'Sam',
      about: 'PhD student',
      organisation: 'TU Delft',
      facts: { pets: 'no' },
    });
    expect((call[0].value.facts as Record<string, string>).bike).toBeUndefined();
  });

  test('offers the config and the profile as resources', async () => {
    const config = {
      ...ConfigSchema.parse({ profile: { firstName: 'Sam' } }),
      secretsPresent: ['ANTHROPIC_API_KEY'],
    };
    const c = await connect(stubClient({ config: async () => config }));
    const { resources } = await c.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(['nlpf://config', 'nlpf://profile']);
    const profile = await c.readResource({ uri: 'nlpf://profile' });
    const first = profile.contents[0] as { text: string; mimeType?: string };
    expect(first.mimeType).toBe('application/json');
    expect(JSON.parse(first.text)).toMatchObject({ firstName: 'Sam' });
    const cfg = await c.readResource({ uri: 'nlpf://config' });
    expect(JSON.parse((cfg.contents[0] as { text: string }).text).secretsPresent).toEqual([
      'ANTHROPIC_API_KEY',
    ]);
  });
});

describe('runMcpStdio', () => {
  test('answers over stdio and finishes when stdin ends', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let written = '';
    stdout.on('data', (c) => (written += String(c)));
    const done = runMcpStdio(stubClient({}), { stdin, stdout });
    stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }) + '\n',
    );
    await vi.waitFor(() => expect(written).toContain('"serverInfo"'));
    stdin.end();
    await expect(done).resolves.toBeUndefined();
  });
});

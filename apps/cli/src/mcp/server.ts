import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import type { NlpfClient } from '../client.js';
import { TOOLS } from './tools.js';

/*
 * `nlpf mcp`: a stdio MCP server for Claude Code, Claude Desktop and other
 * agents. It holds no state of its own; every tool is one or two calls to the
 * daemon's HTTP API through the same client the CLI uses.
 */

const INSTRUCTIONS = `nl-property-finder is a local agent that looks for a rental home in the Netherlands for the user. It watches rental sites, messages landlords, reads their replies and books viewings, and puts what needs a person in an Action inbox.
Start with status, then list_tasks for what needs the user. Read tools are safe to call at any time.
send_message, resolve_task with approve or send_draft, withdraw_all, and resume lead to real landlords and agents being contacted. Use them only when the user has explicitly asked, and show the text first when you can.
Never agree to pay money, sign anything, or share identity documents, bank details or a BSN on the user's behalf.
Times are ISO 8601 in UTC; show them to the user in Europe/Amsterdam time.`;

function errorMessage(e: unknown): string {
  if (e instanceof ZodError) {
    return e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('\n');
  }
  return e instanceof Error ? e.message : String(e);
}

function toText(value: unknown): string {
  if (value === undefined || value === null) return 'Done.';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function createMcpServer(client: NlpfClient, opts: { version?: string } = {}): McpServer {
  const server = new McpServer(
    { name: 'nl-property-finder', title: 'NL Property Finder', version: opts.version ?? '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: tool.annotations },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const result = await tool.run(client, args);
          return { content: [{ type: 'text', text: toText(result) }] };
        } catch (e) {
          return { isError: true, content: [{ type: 'text', text: errorMessage(e) }] };
        }
      },
    );
  }

  server.registerResource(
    'config',
    'nlpf://config',
    {
      title: 'Configuration',
      description:
        'The full configuration: profile, searches, sources, automation, mail, notifications, AI and server. Secret values are never included; secretsPresent lists which secrets are set.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await client.config(), null, 2) }],
    }),
  );

  server.registerResource(
    'profile',
    'nlpf://profile',
    {
      title: 'Profile',
      description: "The user's profile as the agent uses it to introduce them to landlords and answer their questions.",
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: 'application/json', text: JSON.stringify((await client.config()).profile, null, 2) },
      ],
    }),
  );

  return server;
}

/** Serves MCP over stdin and stdout until the client disconnects. Nothing else may write to stdout meanwhile. */
export async function runMcpStdio(client: NlpfClient, opts: { version?: string } = {}): Promise<void> {
  const server = createMcpServer(client, opts);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((done) => {
    transport.onclose = () => done();
  });
  await server.connect(transport);
  await closed;
}

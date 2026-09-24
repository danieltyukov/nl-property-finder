/*
 * How other programs reach the agent: the MCP config for Claude Desktop, the
 * Claude Code command, and a random ntfy topic suggestion.
 */
export function mcpSnippet(): string {
  return JSON.stringify({ mcpServers: { 'nl-property-finder': { command: 'nlpf', args: ['mcp'] } } }, null, 2);
}

export const CLAUDE_CODE_COMMAND = 'claude mcp add nl-property-finder -- nlpf mcp';

export function suggestTopic(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `nlpf-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

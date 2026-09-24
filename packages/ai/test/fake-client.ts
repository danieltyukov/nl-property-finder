import type Anthropic from '@anthropic-ai/sdk';

type Params = Anthropic.MessageCreateParamsNonStreaming & {
  output_config?: { effort?: string; format?: { parse?: (text: string) => unknown } };
};

export interface FakeTurn {
  parsed_output: unknown;
  stop_reason?: Anthropic.StopReason;
  usage?: Partial<Anthropic.Usage>;
}

/** What the handler returns: an Error to throw, a full turn, or just the parsed output. */
export type FakeResult = Error | FakeTurn | object;

/**
 * A stand-in for the Anthropic client. `messages.parse` records the request
 * and answers with canned output, run through the request's own zod output
 * format exactly as the SDK does, so a canned value that does not match the
 * schema fails the same way a bad model answer would.
 */
export function fakeClient(handler: (params: Params, n: number) => FakeResult) {
  const calls: Params[] = [];
  const client = {
    messages: {
      parse: async (params: Params) => {
        calls.push(params);
        const result = handler(params, calls.length);
        if (result instanceof Error) throw result;
        const turn: FakeTurn = 'parsed_output' in result ? (result as FakeTurn) : { parsed_output: result };
        const refused = turn.stop_reason === 'refusal';
        const text = refused ? '' : JSON.stringify(turn.parsed_output);
        const format = params.output_config?.format;
        const parsed = refused ? null : format?.parse ? format.parse(text) : JSON.parse(text);
        return {
          id: `msg_fake_${calls.length}`,
          type: 'message',
          role: 'assistant',
          model: params.model,
          content: refused ? [] : [{ type: 'text', text, citations: null }],
          stop_reason: turn.stop_reason ?? 'end_turn',
          stop_sequence: null,
          stop_details: refused ? { type: 'refusal', category: null, explanation: null } : null,
          usage: {
            input_tokens: 120,
            output_tokens: 80,
            cache_read_input_tokens: 900,
            cache_creation_input_tokens: 0,
            ...turn.usage,
          },
          parsed_output: parsed,
        };
      },
    },
  };
  return { calls, asAnthropic: () => client as unknown as Anthropic };
}

import { describe, expect, it } from 'vitest';
import { AiSchema, memoryLogger } from '@nlpf/core';
import { unlimitedBudget } from '../src/budget.js';
import { createAiProvider } from '../src/factory.js';
import { fakeClient } from './fake-client.js';
import { NOW, makeMessage } from './helpers.js';

const opts = () => ({ log: memoryLogger(), budget: unlimitedBudget() });

describe('createAiProvider', () => {
  it('returns Claude when configured and the key exists', () => {
    const provider = createAiProvider(AiSchema.parse({ provider: 'claude' }), { ANTHROPIC_API_KEY: 'sk-ant-test' }, opts());
    expect(provider.id).toBe('claude');
  });

  it('reads the key from the configured variable name', () => {
    const cfg = AiSchema.parse({ provider: 'claude', keyEnv: 'MY_CLAUDE_KEY' });
    expect(createAiProvider(cfg, { MY_CLAUDE_KEY: 'sk-ant-test' }, opts()).id).toBe('claude');
    expect(createAiProvider(cfg, { ANTHROPIC_API_KEY: 'sk-ant-test' }, opts()).id).toBe('rules');
  });

  it('falls back to rules, with a warning, when Claude is configured without a key', () => {
    const o = opts();
    const provider = createAiProvider(AiSchema.parse({ provider: 'claude' }), { ANTHROPIC_API_KEY: '  ' }, o);
    expect(provider.id).toBe('rules');
    expect(o.log.entries.some((e) => e.lvl === 'warn' && /key/i.test(e.msg))).toBe(true);
  });

  it('returns the demo and rules providers', () => {
    expect(createAiProvider(AiSchema.parse({ provider: 'demo' }), {}, opts()).id).toBe('demo');
    expect(createAiProvider(AiSchema.parse({}), { ANTHROPIC_API_KEY: 'sk-ant-test' }, opts()).id).toBe('rules');
  });

  it('uses an injected client and never lets an API error reach the caller', async () => {
    const client = fakeClient(() => new Error('network down'));
    const provider = createAiProvider(AiSchema.parse({ provider: 'claude' }), { ANTHROPIC_API_KEY: 'sk-ant-test' }, { ...opts(), client: client.asAnthropic() });
    const out = await provider.classify({ message: makeMessage('Helaas is de woning al verhuurd.'), now: NOW });
    expect(client.calls).toHaveLength(1);
    expect(out.intent).toBe('listing_gone');
  });
});

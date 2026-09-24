import { describe, expect, it } from 'vitest';
import type { Intent } from '@nlpf/core';
import { createDemoProvider } from '../src/demo.js';
import { NOW, makeListing, makeMessage, makeProfile, makeSearch } from './helpers.js';

describe('demo provider', () => {
  const demo = createDemoProvider();

  it('classifies the sandbox landlord script by its fixed phrases', async () => {
    const script: [string, Intent][] = [
      ['Beste Sam, je bent welkom voor een bezichtiging. Kies een moment: donderdag 1 oktober 18:30 of vrijdag 2 oktober 17:00.', 'viewing_slots'],
      ['Hi Sam, you are welcome for a viewing on Thursday 1 October 18:30.', 'viewing_invite'],
      ['Kunt u iets meer over uzelf vertellen?', 'info_request'],
      ['Wilt u uw loonstroken van de laatste drie maanden sturen?', 'documents_request'],
      ['Could you send your last three payslips?', 'documents_request'],
      ['Helaas hebben we gekozen voor een andere kandidaat.', 'rejection'],
      ['We need the deposit before the viewing to reserve the room.', 'payment_request'],
      ['Graag willen wij u de woning aanbieden.', 'offer'],
    ];
    for (const [text, intent] of script) {
      const out = await demo.classify({ message: makeMessage(text), now: NOW });
      expect(out.intent, text).toBe(intent);
    }
  });

  it('parses the slots the sandbox writes', async () => {
    const out = await demo.classify({ message: makeMessage('Bezichtiging mogelijk op donderdag 1 oktober 18:30 of vrijdag 2 oktober 17:00.'), now: NOW });
    expect(out.slots.map((s) => s.start)).toEqual(['2026-10-01T16:30:00.000Z', '2026-10-02T15:00:00.000Z']);
    expect(out.confidence).toBeGreaterThan(0.9);
  });

  it('is deterministic and never spends tokens', async () => {
    const input = { listing: makeListing(), profile: makeProfile(), search: makeSearch() };
    const [a, b] = [await demo.extract(input), await demo.extract(input)];
    expect(a).toEqual(b);
    expect(demo.id).toBe('demo');
    expect(demo.usage()).toMatchObject({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
    expect(demo.usage().calls).toBeGreaterThan(0);
  });
});

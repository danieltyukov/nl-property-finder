import { describe, expect, it } from 'vitest';
import { memoryLogger } from '@nlpf/core';
import { unlimitedBudget } from '../src/budget.js';
import { createClaudeProvider } from '../src/claude.js';
import { createRulesProvider } from '../src/rules.js';
import { answerQuestion } from '../src/rules/reply.js';
import { extractRequirements, scamSignalsFromText } from '../src/rules/extract.js';
import { parseSimpleSlots } from '../src/slots.js';
import { dropPaymentPromises, neutraliseTags, scrubSensitive } from '../src/text.js';
import { fakeClient } from './fake-client.js';
import { NOW, makeListing, makeMessage, makeProfile, makeSearch } from './helpers.js';

const rules = createRulesProvider();
const now = new Date(NOW);
const intentOf = async (text: string) => (await rules.classify({ message: makeMessage(text), now: NOW })).intent;

describe('classification never closes a live application by mistake', () => {
  it('does not read ordinary rental wording as listing_gone', async () => {
    for (const text of [
      'De woning wordt verhuurd voor onbepaalde tijd.',
      'The apartment is rented out for a minimum of 12 months.',
      'Your application is taken into consideration.',
      'Your preferences have been taken into account.',
      'Ik ben donderdag niet beschikbaar, kan het vrijdag?',
    ]) expect(await intentOf(text), text).not.toBe('listing_gone');
    expect(await intentOf('De kamer wordt verhuurd per 1 november. Stuur uw loonstroken.')).toBe('documents_request');
  });

  it('still reads real listing_gone wording', async () => {
    for (const text of [
      'De woning is al verhuurd.', 'Deze kamer is niet meer beschikbaar.', 'The room has already been rented.',
      'The apartment is no longer available.', 'De woning is inmiddels verhuurd.', 'Sorry, the studio has been taken.',
    ]) expect(await intentOf(text), text).toBe('listing_gone');
  });

  it('does not read conditional acknowledgements as rejection', async () => {
    for (const text of [
      'Wordt u niet uitgenodigd voor een bezichtiging, dan hoort u niets van ons.',
      'If you have not been selected within two weeks, the home has gone to someone else.',
      'You would share the kitchen with another tenant. Are you still interested?',
      'Mocht u niet geselecteerd worden, dan laten wij dat weten.',
    ]) expect(await intentOf(text), text).not.toBe('rejection');
  });

  it('does not read a conditional non-invitation as a viewing invite', async () => {
    expect(await intentOf('Wordt u niet uitgenodigd voor een bezichtiging, dan hoort u niets van ons.')).toBe('other');
    expect(await intentOf('Als u wilt, kunt u donderdag om 18:30 komen kijken.')).toBe('viewing_invite');
  });

  it('keeps sentences about meeting a requirement', () => {
    expect(dropPaymentPromises('Ik voldoe aan de inkomenseis.')).toBe('Ik voldoe aan de inkomenseis.');
  });
});

describe('requirements with a colon answer', () => {
  it('reads "X toegestaan: nee" as not allowed', () => {
    expect(extractRequirements('Huisdieren toegestaan: nee')).toMatchObject({ petsAllowed: false });
    expect(extractRequirements('Roken toegestaan: nee')).toMatchObject({ smokingAllowed: false });
    expect(extractRequirements('Studenten toegestaan: nee')).toMatchObject({ studentsAllowed: false });
    expect(extractRequirements('Pets allowed: no')).toMatchObject({ petsAllowed: false });
    expect(extractRequirements('Huisdieren toegestaan: ja')).toMatchObject({ petsAllowed: true });
  });
});

describe('scam signals', () => {
  it('does not flag "appartement" or "per direct"', () => {
    expect(scamSignalsFromText('Dit appartement is per direct beschikbaar. Contact via het platform.')).not.toContain('off_platform_contact');
  });

  it('still flags a request to contact privately', () => {
    expect(scamSignalsFromText('Please contact me directly on my private email landlord123@gmail.com')).toContain('off_platform_contact');
  });
});

describe('slots', () => {
  it('reads "uitnodigen voor donderdag" as a viewing, not a deadline', () => {
    expect(parseSimpleSlots('Wij nodigen u uit voor donderdag 1 oktober om 18:30 voor een bezichtiging.', now)).toHaveLength(1);
    expect(parseSimpleSlots('Graag uiterlijk vrijdag reageren. Bezichtiging om 18:30.', now)).toHaveLength(1);
  });

  it('does not read a house number as a certain time', () => {
    const slots = parseSimpleSlots('The viewing is at 12 Kerkstraat on Thursday 1 October.', now);
    expect(slots.every((s) => !s.certain)).toBe(true);
  });

  it('reads a morning word before the time', () => {
    expect(parseSimpleSlots('morgenochtend om 7 uur', now)[0]?.start).toBe('2026-09-24T05:00:00.000Z');
    expect(parseSimpleSlots("zaterdag 's ochtends om 9 uur", now)[0]?.start).toBe('2026-09-26T07:00:00.000Z');
  });
});

describe('Claude times without an offset', () => {
  it('reads them as Amsterdam time', async () => {
    const client = fakeClient(() => ({
      intent: 'viewing_invite', confidence: 0.9,
      slots: [{ start: '2026-10-01T18:30:00', end: '2026-10-01T18:45', text: 'donderdag 18:30', certain: true }],
      questions: [], documents: [], deadline: '2026-09-28T12:00:00', addressMention: null, summary: 'Viewing.',
    }));
    const provider = createClaudeProvider({ client: client.asAnthropic(), log: memoryLogger(), budget: unlimitedBudget() });
    // Node reads TZ again when it changes, so this checks the parse does not depend on the host zone.
    const saved = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const out = await provider.classify({ message: makeMessage('Donderdag 18:30?'), now: NOW });
      expect(out.slots[0]).toMatchObject({ start: '2026-10-01T16:30:00.000Z', end: '2026-10-01T16:45:00.000Z' });
      expect(out.deadline).toBe('2026-09-28T10:00:00.000Z');
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});

describe('sensitive data', () => {
  it('removes BSNs in the official 4-2-3 format and with dashes', () => {
    expect(scrubSensitive('Nummer 1112.22.333 graag')).not.toMatch(/1112/);
    expect(scrubSensitive('burgerservicenummer: 111-222-333')).not.toMatch(/111/);
  });

  it('never answers questions about BSN or bank details', () => {
    const profile = makeProfile({ facts: { nummer: 'zie dossier' } });
    for (const q of ['Wat is uw burgerservicenummer?', 'Wat is uw bankrekeningnummer?', 'Kunt u uw bankgegevens sturen?']) {
      expect(answerQuestion(q, profile, 'nl'), q).toBeUndefined();
    }
  });

  it('drops more payment promises', () => {
    for (const s of ['I will send you the deposit tomorrow.', 'I can make the payment before the viewing.', 'Ik kan de borg vooruitbetalen.', 'We can transfer it right away.']) {
      expect(dropPaymentPromises(`Hello. ${s} Bye.`), s).toBe('Hello. Bye.');
    }
  });

  it('escapes tags with spaces inside', () => {
    expect(neutraliseTags('< /message> <  listing>')).not.toMatch(/<\s*\/?\s*(message|listing)/);
  });
});

describe('contract checks', () => {
  it('does not read the refund period as the deposit size', async () => {
    const review = await rules.reviewContract({ text: 'De waarborgsom wordt binnen 3 maanden na het einde van de huur terugbetaald.', language: 'nl' });
    expect(review.findings.find((f) => f.topic === 'deposit')).toBeUndefined();
  });

  it('does not flag "Bemiddelingskosten: geen"', async () => {
    const review = await rules.reviewContract({ text: 'Bemiddelingskosten: geen.', language: 'nl' });
    expect(review.findings.find((f) => f.topic === 'mediation_fee')).toBeUndefined();
  });
});

describe('providers never throw', () => {
  it('answers even when the input is broken and the budget store fails', async () => {
    const client = fakeClient(() => new Error('down'));
    const provider = createClaudeProvider({
      client: client.asAnthropic(), log: memoryLogger(),
      budget: { canSpend: () => { throw new Error('database is locked'); }, record: () => {} },
    });
    const out = await provider.classify({ message: makeMessage('Kunt u donderdag?'), now: 'not a date' });
    expect(out.intent).toBeDefined();
    const extract = await provider.extract({ listing: makeListing({ availableFrom: 'soon' }), profile: makeProfile({ moveInFrom: 'x' }), search: makeSearch() });
    expect(extract.score).toBeGreaterThanOrEqual(0);
    const r = await rules.classify({ message: makeMessage('Kunt u donderdag om 18:30?'), now: 'not a date' });
    expect(r.intent).toBeDefined();
  });
});

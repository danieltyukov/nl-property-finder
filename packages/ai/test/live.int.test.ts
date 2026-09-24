import { describe, expect, it } from 'vitest';
import { AiSchema, memoryLogger } from '@nlpf/core';
import { unlimitedBudget } from '../src/budget.js';
import { createAiProvider } from '../src/factory.js';
import { makeListing, makeProfile, makeSearch } from './helpers.js';

// Costs real tokens: runs only with ANTHROPIC_API_KEY set and NLPF_LIVE=1.
const key = process.env.ANTHROPIC_API_KEY;
const live = Boolean(key) && process.env.NLPF_LIVE === '1';

const BOOLEAN_FIELDS = ['registrationAllowed', 'studentsAllowed', 'sharingAllowed', 'petsAllowed', 'smokingAllowed', 'guarantorAccepted'] as const;
const NUMBER_FIELDS = ['incomeMultiple', 'minIncomeEur', 'minMonths', 'maxMonths', 'ageMin', 'ageMax'] as const;

describe.skipIf(!live)('Claude live', () => {
  it('extracts requirements and a score from a Dutch listing', async () => {
    const log = memoryLogger();
    const provider = createAiProvider(AiSchema.parse({ provider: 'claude' }), { ANTHROPIC_API_KEY: key ?? '' }, { log, budget: unlimitedBudget() });
    const listing = makeListing({
      description:
        'Licht appartement aan de Oude Delft, vlak bij station Delft. Gestoffeerd, 42 m2, eigen keuken en badkamer. ' +
        'Geen studenten. Inkomenseis: 4 x de kale huur. Inschrijven op dit adres is niet mogelijk. Huisdieren niet toegestaan. ' +
        'Huurovereenkomst voor onbepaalde tijd. Borg twee maanden huur.',
    });
    const out = await provider.extract({ listing, profile: makeProfile(), search: makeSearch() });

    expect(provider.usage().calls, JSON.stringify(log.entries)).toBe(1);
    expect(log.entries.filter((e) => e.lvl === 'warn' || e.lvl === 'error')).toEqual([]);
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(100);
    for (const f of BOOLEAN_FIELDS) if (out.requirements[f] !== undefined) expect(typeof out.requirements[f], f).toBe('boolean');
    for (const f of NUMBER_FIELDS) if (out.requirements[f] !== undefined) expect(typeof out.requirements[f], f).toBe('number');
    expect(out.requirements.studentsAllowed).toBe(false);
    expect(out.requirements.incomeMultiple).toBe(4);
    expect(out.requirements.registrationAllowed).toBe(false);
    expect(out.language).toBe('nl');
    expect(out.summary.length).toBeGreaterThan(20);
  }, 120_000);
});

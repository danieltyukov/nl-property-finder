import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memoryLogger, type ContractReview } from '@nlpf/core';
import { unlimitedBudget } from '../src/budget.js';
import { createClaudeProvider } from '../src/claude.js';
import { createRulesProvider } from '../src/rules.js';
import { fakeClient } from './fake-client.js';

const rules = createRulesProvider();
const severityOf = (review: ContractReview, topic: string) => review.findings.find((f) => f.topic === topic)?.severity;

describe('rules reviewContract', () => {
  it('flags a deposit above twice the base rent as illegal', async () => {
    const review = await rules.reviewContract({ text: 'De huurder betaalt een waarborgsom van 3 maanden kale huur.', language: 'nl' });
    expect(severityOf(review, 'deposit')).toBe('illegal');
    expect(review.findings.find((f) => f.topic === 'deposit')?.text).toMatch(/2023/);
  });

  it('flags a deposit amount above twice the rent when the rent is known', async () => {
    const review = await rules.reviewContract({ text: 'Waarborgsom: EUR 3.600,-', priceEur: 1150, language: 'en' });
    expect(severityOf(review, 'deposit')).toBe('illegal');
    const fine = await rules.reviewContract({ text: 'Waarborgsom: EUR 2.300,-', priceEur: 1150, language: 'en' });
    expect(severityOf(fine, 'deposit')).toBeUndefined();
  });

  it('flags mediation fees charged to the tenant as illegal, but not their absence', async () => {
    const review = await rules.reviewContract({ text: 'Bij ondertekening betaalt huurder bemiddelingskosten EUR 350.', language: 'nl' });
    expect(severityOf(review, 'mediation_fee')).toBe('illegal');
    const none = await rules.reviewContract({ text: 'Er worden geen bemiddelingskosten in rekening gebracht.', language: 'nl' });
    expect(severityOf(none, 'mediation_fee')).toBeUndefined();
  });

  it('warns about a temporary contract over two years for an independent home', async () => {
    const review = await rules.reviewContract({
      text: 'Huurovereenkomst zelfstandige woonruimte. De huur wordt aangegaan voor bepaalde tijd, voor de duur van 36 maanden.',
      language: 'nl',
    });
    expect(severityOf(review, 'temporary_contract')).toBe('warning');
  });

  it('flags key money and a long notice period, and summarises in the requested language', async () => {
    const review = await rules.reviewContract({
      text: 'Sleutelgeld EUR 500. De opzegtermijn voor huurder bedraagt 4 maanden.',
      language: 'en',
    });
    expect(severityOf(review, 'key_money')).toBe('illegal');
    expect(severityOf(review, 'notice_period')).toBe('illegal');
    expect(review.summary).toMatch(/illegal/i);
  });

  it('says so when a PDF cannot be read without AI', async () => {
    const review = await rules.reviewContract({ text: '', language: 'en', pdfPath: '/tmp/contract.pdf' });
    expect(review.summary).toMatch(/could not read/i);
  });
});

describe('Claude reviewContract', () => {
  it('sends a PDF as a base64 document block and returns the same schema', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nlpf-ai-'));
    const pdf = join(dir, 'contract.pdf');
    writeFileSync(pdf, '%PDF-1.4 fake');
    const canned: ContractReview = {
      summary: 'Een clausule is onwettig.',
      findings: [{ severity: 'illegal', topic: 'deposit', text: 'Waarborgsom van drie maanden.' }],
    };
    const client = fakeClient(() => canned);
    const provider = createClaudeProvider({ client: client.asAnthropic(), log: memoryLogger(), budget: unlimitedBudget() });
    const review = await provider.reviewContract({ text: '', language: 'nl', pdfPath: pdf });
    expect(review).toEqual(canned);
    const content = client.calls[0]?.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    const doc = (content as { type: string; source?: { type: string; media_type: string; data: string } }[])[0];
    expect(doc?.type).toBe('document');
    expect(doc?.source).toEqual({ type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4 fake').toString('base64') });
  });
});

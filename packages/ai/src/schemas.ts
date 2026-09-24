import { z } from 'zod';
import type {
  ClassifyOutput, ComposeOutput, ContractReview, ExtractOutput, Intent, ProposedSlot, ReplyOutput, Requirements,
} from '@nlpf/core';
import { DOCUMENT_KINDS } from './types.js';

/**
 * Structured-output schemas for the Claude provider. They mirror the output
 * interfaces in `@nlpf/core`, with one difference: optional fields are
 * required and nullable here, which structured outputs handle best. The
 * `to*` functions turn a parsed value back into the contract type.
 */

export const INTENTS = [
  'viewing_invite', 'viewing_slots', 'info_request', 'documents_request', 'application_form', 'rejection',
  'listing_gone', 'offer', 'contract', 'payment_request', 'scam_suspect', 'alert', 'newsletter', 'other',
] as const satisfies readonly Intent[];
// Fails to compile when `Intent` gains a value this list does not have.
const _allIntents: Exclude<Intent, (typeof INTENTS)[number]> extends never ? true : never = true;
void _allIntents;

export const RequirementsSchema = z.object({
  incomeMultiple: z.number().nullable().describe('Gross monthly income required, as a multiple of the monthly rent'),
  minIncomeEur: z.number().nullable().describe('Stated minimum gross monthly income in euros'),
  registrationAllowed: z.boolean().nullable().describe('Whether registering (BRP inschrijving) at the address is possible'),
  studentsAllowed: z.boolean().nullable(),
  sharingAllowed: z.boolean().nullable().describe('Whether sharers (woningdelers) are accepted'),
  contract: z.enum(['indefinite', 'temporary', 'unknown']),
  minMonths: z.number().nullable(),
  maxMonths: z.number().nullable(),
  petsAllowed: z.boolean().nullable(),
  smokingAllowed: z.boolean().nullable(),
  genderRestriction: z.enum(['female', 'male']).nullable(),
  ageMin: z.number().nullable(),
  ageMax: z.number().nullable(),
  guarantorAccepted: z.boolean().nullable(),
  notes: z.array(z.string()).describe('Up to five short facts that matter for applying'),
});

export const ExtractSchema = z.object({
  requirements: RequirementsSchema,
  score: z.number().describe('Fit for the person, 0 to 100'),
  reasons: z.array(z.string()),
  scamSignals: z.array(z.string()),
  language: z.enum(['nl', 'en']).describe('Language the listing is written in'),
  summary: z.string(),
});

export const ComposeSchema = z.object({
  subject: z.string().nullable(),
  body: z.string(),
  rationale: z.string(),
});

export const SlotSchema = z.object({
  start: z.string().describe('ISO 8601 with offset, Europe/Amsterdam'),
  end: z.string().nullable(),
  text: z.string().describe('The original wording'),
  certain: z.boolean(),
});

export const ClassifySchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().describe('0 to 1'),
  slots: z.array(SlotSchema),
  questions: z.array(z.string()),
  documents: z.array(z.enum(DOCUMENT_KINDS)),
  deadline: z.string().nullable(),
  addressMention: z.string().nullable(),
  summary: z.string(),
});

export const ReplySchema = z.object({
  subject: z.string().nullable(),
  body: z.string(),
  unanswerable: z.array(z.string()),
  rationale: z.string(),
});

export const ContractSchema = z.object({
  summary: z.string(),
  findings: z.array(z.object({
    severity: z.enum(['info', 'warning', 'illegal']),
    topic: z.string(),
    text: z.string(),
  })),
});

/* ---------- parsed value to contract type ---------- */

function dropNulls<T extends Record<string, unknown>>(o: T): { [K in keyof T]: Exclude<T[K], null> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v;
  return out as { [K in keyof T]: Exclude<T[K], null> };
}

export function toRequirements(r: z.infer<typeof RequirementsSchema>): Requirements {
  const out: Requirements = dropNulls(r);
  if (out.contract === 'unknown') delete out.contract;
  if (!out.notes?.length) delete out.notes;
  return out;
}

export function toExtractOutput(p: z.infer<typeof ExtractSchema>): ExtractOutput {
  return { ...p, requirements: toRequirements(p.requirements) };
}

export function toComposeOutput(p: z.infer<typeof ComposeSchema>): ComposeOutput {
  return dropNulls(p);
}

export function toClassifyOutput(p: z.infer<typeof ClassifySchema>): ClassifyOutput {
  const slots: ProposedSlot[] = p.slots.map((s) => dropNulls(s));
  return { ...dropNulls(p), slots };
}

export function toReplyOutput(p: z.infer<typeof ReplySchema>): ReplyOutput {
  return dropNulls(p);
}

export function toContractReview(p: z.infer<typeof ContractSchema>): ContractReview {
  return p;
}

import type { ClassifyOutput, ComposeOutput, ContractReview, ExtractOutput, Profile, ProposedSlot, ReplyOutput, Requirements } from '@nlpf/core';
import { cleanCopy, dropPaymentPromises, fitToLength, scrubDeep, scrubSensitive } from './text.js';

/**
 * Every provider's output passes through these before it reaches the agent,
 * whatever produced it: a model, a template or a rule. They enforce the
 * owner's copy rules, remove BSNs, IBANs and foreign email addresses, drop
 * payment promises from outgoing messages, and keep values in range.
 */

const clean = (s: string, allowEmails: string[] = []) => cleanCopy(scrubSensitive(s, { allowEmails }));
const cleanList = (xs: string[], max: number) => xs.map((x) => clean(x)).filter(Boolean).slice(0, max);
const inRange = (n: number | undefined, lo: number, hi: number) => (n !== undefined && Number.isFinite(n) && n >= lo && n <= hi ? n : undefined);

function saneRequirements(r: Requirements): Requirements {
  const out: Requirements = { ...r };
  out.incomeMultiple = inRange(r.incomeMultiple, 0.5, 10);
  out.minIncomeEur = inRange(r.minIncomeEur, 100, 50_000);
  out.minMonths = inRange(r.minMonths, 0, 600);
  out.maxMonths = inRange(r.maxMonths, 0, 600);
  out.ageMin = inRange(r.ageMin, 0, 120);
  out.ageMax = inRange(r.ageMax, 0, 120);
  if (r.notes) out.notes = cleanList(r.notes, 8);
  for (const k of Object.keys(out) as (keyof Requirements)[]) if (out[k] === undefined) delete out[k];
  return out;
}

export function finaliseExtract(out: ExtractOutput): ExtractOutput {
  const signals = [...new Set(out.scamSignals.map((s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')).filter(Boolean))];
  return {
    requirements: saneRequirements(scrubDeep(out.requirements)),
    score: Math.max(0, Math.min(100, Math.round(Number.isFinite(out.score) ? out.score : 0))),
    reasons: cleanList(out.reasons, 8),
    scamSignals: signals.slice(0, 10),
    language: out.language === 'en' ? 'en' : 'nl',
    summary: clean(out.summary),
  };
}

/** Outgoing text: copy rules, no sensitive data except the person's own address, no payment promises, within the limit. */
export function finaliseMessage<T extends ComposeOutput | ReplyOutput>(out: T, ctx: { profile: Profile; maxChars?: number }): T {
  const allow = [ctx.profile.email];
  const body = fitToLength(dropPaymentPromises(clean(out.body, allow)), ctx.maxChars);
  const result = { ...out, body, rationale: clean(out.rationale) };
  if (out.subject !== undefined) result.subject = clean(out.subject, allow) || undefined;
  if (result.subject === undefined) delete result.subject;
  if ('unanswerable' in out) (result as ReplyOutput).unanswerable = cleanList(out.unanswerable, 10);
  return result;
}

function saneSlot(s: ProposedSlot): ProposedSlot | undefined {
  const start = new Date(s.start);
  if (Number.isNaN(start.getTime())) return undefined;
  const slot: ProposedSlot = { start: start.toISOString(), text: clean(s.text).slice(0, 200), certain: Boolean(s.certain) };
  if (s.end) {
    const end = new Date(s.end);
    if (!Number.isNaN(end.getTime()) && end > start) slot.end = end.toISOString();
  }
  return slot;
}

export function finaliseClassify(out: ClassifyOutput): ClassifyOutput {
  const result: ClassifyOutput = {
    intent: out.intent,
    confidence: Math.max(0, Math.min(1, Number.isFinite(out.confidence) ? out.confidence : 0)),
    slots: out.slots.map(saneSlot).filter((s): s is ProposedSlot => Boolean(s)).slice(0, 12),
    questions: cleanList(out.questions, 10),
    documents: [...new Set(out.documents.map((d) => d.trim().toLowerCase()).filter(Boolean))].slice(0, 12),
    summary: clean(out.summary),
  };
  if (out.deadline && !Number.isNaN(new Date(out.deadline).getTime())) result.deadline = new Date(out.deadline).toISOString();
  const address = out.addressMention ? clean(out.addressMention) : '';
  if (address) result.addressMention = address.slice(0, 120);
  return result;
}

export function finaliseContract(out: ContractReview): ContractReview {
  return {
    summary: clean(out.summary),
    findings: out.findings
      .map((f) => ({ severity: f.severity, topic: clean(f.topic).toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'other', text: clean(f.text) }))
      .filter((f) => f.text)
      .slice(0, 30),
  };
}

import type {
  ClassifyOutput, ComposeInput, ComposeOutput, ContractReview, ExtractInput, ExtractOutput, Lang, ReplyInput, ReplyOutput,
} from '@nlpf/core';

/**
 * Last-resort answers for when even the rules fail on an unexpected input.
 * They are deliberately plain and cautious: a neutral score, an "other"
 * classification (which the policy turns into a task for the person), and
 * messages that promise nothing.
 */

const lang = (l: unknown): Lang => (l === 'en' ? 'en' : 'nl');

function signOff(profile: { firstName?: string; lastName?: string; signature?: string } | undefined, l: Lang): string {
  const name = (profile?.signature ?? '').trim() || `${profile?.firstName ?? ''} ${profile?.lastName ?? ''}`.trim();
  const word = l === 'nl' ? 'Met vriendelijke groet,' : 'Kind regards,';
  return name ? `${word}\n${name}` : word;
}

export function minimalExtract(input: Partial<ExtractInput> | undefined): ExtractOutput {
  const en = !input?.profile?.languages?.[0]?.toLowerCase().startsWith('nl');
  return {
    requirements: {},
    score: 50,
    reasons: [en ? 'Could not evaluate this listing automatically.' : 'Deze advertentie kon niet automatisch worden beoordeeld.'],
    scamSignals: [],
    language: lang(input?.listing?.language),
    summary: String(input?.listing?.title ?? ''),
  };
}

export function minimalCompose(input: Partial<ComposeInput> | undefined): ComposeOutput {
  const l = lang(input?.language);
  const body = l === 'nl'
    ? `Beste verhuurder,\n\nMet interesse las ik uw advertentie. Graag kom ik de woning bezichtigen.\n\n${signOff(input?.profile, l)}`
    : `Dear landlord,\n\nI read your listing with interest and would like to arrange a viewing.\n\n${signOff(input?.profile, l)}`;
  return { body, rationale: 'A minimal message: the tool could not fill the template.' };
}

export function minimalClassify(): ClassifyOutput {
  return { intent: 'other', confidence: 0, slots: [], questions: [], documents: [], summary: 'This message could not be classified automatically.' };
}

export function minimalReply(input: Partial<ReplyInput> | undefined): ReplyOutput {
  const l = lang(input?.language);
  const body = l === 'nl'
    ? `Beste,\n\nDank voor uw bericht. Ik kom zo snel mogelijk bij u terug.\n\n${signOff(input?.profile, l)}`
    : `Hello,\n\nThank you for your message. I will get back to you as soon as possible.\n\n${signOff(input?.profile, l)}`;
  return { body, unanswerable: [...(input?.classification?.questions ?? [])], rationale: 'A minimal reply: the tool could not draft a full answer.' };
}

export function minimalContract(l: unknown): ContractReview {
  return {
    summary: lang(l) === 'nl'
      ? 'Het contract kon niet automatisch worden gecontroleerd. Lees het zorgvuldig.'
      : 'The contract could not be checked automatically. Read it carefully.',
    findings: [],
  };
}

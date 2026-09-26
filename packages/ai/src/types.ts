import type { AiProvider, ContractReview, ContractReviewInput } from '@nlpf/core';

/**
 * `ContractReviewInput` plus an optional PDF on disk. The Claude provider
 * sends the PDF itself as a document block; the rules provider can only read
 * `text`, so the caller should pass extracted text as well when it has some.
 */
export type ContractReviewRequest = ContractReviewInput & { pdfPath?: string };

/** `AiProvider` whose `reviewContract` also accepts a PDF path. Every provider in this package implements it. */
export interface NlpfAiProvider extends AiProvider {
  reviewContract(input: ContractReviewRequest): Promise<ContractReview>;
}

/**
 * The document kinds `classify` reports in `ClassifyOutput.documents`, so the
 * agent can match requests against `DocumentFile.kind`.
 */
export const DOCUMENT_KINDS = [
  'payslip', 'employer_statement', 'employment_contract', 'id', 'passport', 'bank_statement', 'income_statement',
  'enrolment', 'landlord_reference', 'bkr', 'guarantor', 'tenant_profile', 'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Named scam signals shared with the agent's rule-based scam guard, plus `prompt_injection`. */
export const SCAM_SIGNALS = [
  'price_far_below_median', 'payment_before_viewing', 'landlord_abroad', 'keys_by_post', 'off_platform_contact',
  'whatsapp_only', 'too_good_description', 'no_address', 'prompt_injection',
] as const;

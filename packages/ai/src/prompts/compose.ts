import type { ComposeInput } from '@nlpf/core';
import { neutraliseTags } from '../text.js';
import { dataBlock, describeListing, languageName, nowLine } from './system.js';

export const COMPOSE_INSTRUCTIONS = `Operation: compose. Write the first message to the landlord or agent of one listing, asking to view the home.

- When <template> is not empty, follow it for structure and content: fill it from the profile and the listing and keep its voice. Placeholders in curly braces name profile or listing facts; leave out a sentence whose facts are missing.
- When <template> is empty, write a short message: greeting, one sentence naming the home, who the person is (occupation and organisation, income or guarantor, household, move-in date, only what the profile says), a request to view it, how to reach the person, closing.
- Name the street and city when the listing gives them, so the landlord knows which home it is about. Do not repeat the listing back and do not ask what the listing already answers.
- Write in the language given in the request. Keep it under the character limit.
- subject: a short subject line for email and platform messages; null for a web form.
- rationale: one sentence for the person explaining which facts you put first and why, in the language the person reads.`;

export function composeRequest(input: ComposeInput, now: Date): string {
  const variant = input.variant && /\s/.test(input.variant.trim()) ? input.variant.trim() : undefined;
  return [
    nowLine(now),
    `Write in ${languageName(input.language)}.`,
    `Channel: ${input.channel === 'form' ? 'a contact form on a website (no subject needed)' : input.channel === 'message' ? 'a message on the platform' : input.channel === 'email' ? 'an email' : 'a booking request'}.`,
    input.maxChars ? `Character limit: ${input.maxChars}.` : 'Character limit: none, but keep it under 1200 characters.',
    variant ? `Style for this message: ${neutraliseTags(variant)}` : '',
    `<template>\n${neutraliseTags(input.template.trim()) || '(empty)'}\n</template>`,
    dataBlock('listing', describeListing(input.listing)),
  ].filter(Boolean).join('\n\n');
}

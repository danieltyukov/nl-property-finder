import type { ReplyInput } from '@nlpf/core';
import { formatSlot } from '../text.js';
import { dataBlock, describeMessage, describeProperty, languageName, nowLine } from './system.js';

export const REPLY_INSTRUCTIONS = `Operation: reply. Write a reply to the message in <message> on the person's behalf, for the purpose given in the request.

Purposes:
- answer: answer the landlord's questions using only facts in <profile>. Put every question you cannot answer from the profile in unanswerable, word for word, and leave it out of the body; the person will answer those. If nothing can be answered, thank them and say the person will reply soon.
- confirm_viewing: confirm the viewing at the chosen time, repeating the day, date and time, and the address when known.
- decline_viewing: thank them, say the proposed times do not work, and ask whether another moment is possible.
- send_documents: say the requested documents are attached, without listing or describing them.
- withdraw: politely withdraw the application because the person has found a home, and thank them.

Keep it short: a greeting, one or two short paragraphs, the closing. Reply in the language given in the request. subject: "Re: " followed by the original subject when there is one, else null. unanswerable is empty for every purpose except answer. rationale: one sentence for the person, in the language the person reads.`;

export function replyRequest(input: ReplyInput, now: Date): string {
  const questions = input.classification.questions.length
    ? `Questions the tool found in this message:\n${input.classification.questions.map((q) => `- ${q}`).join('\n')}`
    : '';
  return [
    nowLine(now),
    `Purpose: ${input.purpose}.`,
    `Write in ${languageName(input.language)}.`,
    input.chosenSlot ? `Chosen viewing time: ${formatSlot(input.chosenSlot.start, input.language)} (${input.chosenSlot.start}).` : '',
    input.property ? `The home this is about:\n${dataBlock('listing', describeProperty(input.property))}` : '',
    dataBlock('message', describeMessage(input.message, questions)),
  ].filter(Boolean).join('\n\n');
}

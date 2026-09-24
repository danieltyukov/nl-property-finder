import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chooseSlot,
  decidePolicy,
  documentsToSend,
  feeFlags,
  isAutoSubmitted,
  matchInbound,
  messageLanguage,
  parseSlots,
  replyBudgetLeft,
  VIEWING_MINUTES,
  watermarkDocument,
  type DocumentFile,
} from '@nlpf/agent';
import type {
  Attachment,
  ClassifyOutput,
  Conversation,
  InboundMessage,
  Lang,
  Message,
  ProposedSlot,
  ReplyInput,
} from '@nlpf/core';
import { amsterdam } from '@nlpf/core';
import { ingestRaw } from './ingest.js';
import { openTask, type Runtime } from '../runtime.js';

/* ---------- documents on disk ---------- */

interface DocIndexEntry { name: string; sensitivity: DocumentFile['sensitivity']; kind: string; size: number; addedAt: string }

export function documentIndex(rt: Runtime): DocIndexEntry[] {
  const file = join(rt.paths.documentsDir, 'index.json');
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DocIndexEntry[];
  } catch {
    return [];
  }
}

export function writeDocumentIndex(rt: Runtime, entries: DocIndexEntry[]): void {
  writeFileSync(join(rt.paths.documentsDir, 'index.json'), JSON.stringify(entries, null, 2));
}

export function documentFiles(rt: Runtime): DocumentFile[] {
  return documentIndex(rt).map((d) => ({ name: d.name, path: join(rt.paths.documentsDir, d.name), sensitivity: d.sensitivity, kind: d.kind }));
}

/** Identity documents are never sent as they are: a watermarked copy naming the recipient, address and date. */
export async function prepareAttachment(rt: Runtime, doc: DocumentFile, recipient: string, address?: string): Promise<Attachment> {
  if (doc.sensitivity !== 'identity') return { filename: doc.name, path: doc.path };
  const date = new Date(rt.now()).toISOString().slice(0, 10);
  const out = join(rt.paths.documentsDir, '.sent', `${date}-${doc.name.replace(/\.[^.]+$/, '')}-watermarked.pdf`);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(rt.paths.documentsDir, '.sent'), { recursive: true });
  await watermarkDocument({ path: doc.path, recipient, address, date }, out);
  return { filename: doc.name.replace(/\.[^.]+$/, '') + '-watermarked.pdf', path: out };
}

/* ---------- sending in a conversation ---------- */

/**
 * Sends a message in an existing conversation through the channel it lives
 * on: a threaded email reply, or the platform's own messaging.
 */
export async function sendInConversation(
  rt: Runtime,
  conversation: Conversation,
  msg: { subject?: string; body: string; attachments?: Attachment[]; author?: Message['author']; rationale?: string; intent?: Message['intent'] },
): Promise<Message> {
  const cfg = rt.config();
  const nowIso = rt.now().toISOString();
  const history = rt.store.messages.list(conversation.id);
  const lastIn = [...history].reverse().find((m) => m.direction === 'in');
  const base = { conversationId: conversation.id, direction: 'out' as const, author: msg.author ?? 'agent', body: msg.body, at: nowIso, rationale: msg.rationale, attachments: msg.attachments };

  if (cfg.automation.dryRun) {
    const m = rt.store.messages.add({ ...base, channel: conversation.counterpart.email ? 'email' : 'platform', subject: msg.subject, status: 'draft' });
    rt.bus.emit('message.drafted', `Dry run: drafted a reply to ${conversation.counterpart.name ?? conversation.counterpart.email ?? 'the landlord'}`, { conversationId: conversation.id });
    return m;
  }

  const { sourceId, threadId, email } = conversation.counterpart;
  const adapter = sourceId ? rt.adapter(sourceId) : undefined;
  if (threadId && adapter?.reply) {
    const lang: Lang = /[a-z]/i.test(msg.body) && /\b(de|het|een|graag|groet)\b/i.test(msg.body) ? 'nl' : 'en';
    const r = await adapter.reply(threadId, { subject: msg.subject, body: msg.body, language: lang, profile: cfg.profile, attachments: msg.attachments, dryRun: false }, rt.sourceContext(adapter));
    const m = rt.store.messages.add({ ...base, channel: 'platform', subject: msg.subject, status: r.ok ? 'sent' : 'failed', externalId: r.externalId ? `${sourceId}:${r.externalId}` : undefined });
    rt.store.conversations.update(conversation.id, { lastMessageAt: nowIso });
    rt.bus.emit(r.ok ? 'message.sent' : 'message.failed', `${r.ok ? 'Replied' : 'Reply failed'} on ${adapter.name}`, { conversationId: conversation.id });
    if (!r.ok) throw new Error(r.error ?? 'reply failed');
    return m;
  }

  const mailbox = rt.mailbox();
  if (!mailbox || !email) throw new Error('This conversation has no email address and no platform thread to reply in.');
  const subject = msg.subject ?? (lastIn?.subject ? (/^re:/i.test(lastIn.subject) ? lastIn.subject : `Re: ${lastIn.subject}`) : conversation.subject ?? 'Re:');
  const references = history.map((h) => h.externalId).filter((x): x is string => !!x && x.startsWith('<'));
  const sent = await mailbox.send({
    to: email,
    subject,
    text: msg.body,
    inReplyTo: lastIn?.externalId?.startsWith('<') ? lastIn.externalId : undefined,
    references,
    attachments: msg.attachments?.filter((a) => a.path).map((a) => ({ filename: a.filename, path: a.path! })),
  });
  const m = rt.store.messages.add({ ...base, channel: 'email', subject, status: 'sent', externalId: sent.messageId, intent: msg.intent });
  rt.store.conversations.update(conversation.id, { lastMessageAt: nowIso });
  rt.bus.emit('message.sent', `Replied to ${conversation.counterpart.name ?? email}`, { conversationId: conversation.id });
  return m;
}

/* ---------- inbound ---------- */

export interface InboundDeps {
  /** Generic alert-email parser from @nlpf/mail, used when no adapter claims the sender. */
  parseAlert?: (m: InboundMessage) => { sourceId: string; listings: import('@nlpf/core').RawListing[] } | null;
}

function isAlert(rt: Runtime, m: InboundMessage): ReturnType<NonNullable<InboundDeps['parseAlert']>> {
  const from = m.from.address?.toLowerCase() ?? '';
  for (const a of rt.adapters()) {
    if (!a.parseAlertEmail || !a.alertSenders?.length) continue;
    if (a.alertSenders.some((s) => from === s.toLowerCase() || from.endsWith('@' + s.toLowerCase().replace(/^.*@/, '')))) {
      return { sourceId: a.id, listings: a.parseAlertEmail(m) };
    }
  }
  return null;
}

const slotText = (s: ProposedSlot) => {
  const p = amsterdam(new Date(s.start));
  return `${p.weekday} ${p.d}/${p.m} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
};

/**
 * One inbound message, from the mailbox or a platform inbox. Alerts become
 * listings. Everything else is stored, matched to its conversation, sorted,
 * and handled by the policy table. Nothing is ever dropped: a message that
 * matches no application becomes a reply_needed task.
 */
export async function handleInbound(rt: Runtime, msg: InboundMessage, deps: InboundDeps = {}): Promise<void> {
  if (rt.store.messages.hasExternal(msg.id)) return;
  const cfg = rt.config();
  const now = rt.now();
  const nowIso = now.toISOString();

  const alert = isAlert(rt, msg) ?? (msg.channel === 'email' ? (deps.parseAlert?.(msg) ?? null) : null);
  if (alert && alert.listings.length) {
    for (const raw of alert.listings) await ingestRaw(rt, raw, 'alert');
    rt.bus.emit('source.polled', `Alert email from ${alert.sourceId}: ${alert.listings.length} listings`, { sourceId: alert.sourceId, count: alert.listings.length, via: 'alert' });
    return;
  }

  const match = matchInbound(msg, rt.store);
  let conversation = match.conversationId ? rt.store.conversations.get(match.conversationId) : undefined;
  const application = match.applicationId ? rt.store.applications.get(match.applicationId) : conversation?.applicationId ? rt.store.applications.get(conversation.applicationId) : undefined;
  if (!conversation) {
    conversation = rt.store.conversations.create({
      applicationId: application?.id ?? null,
      propertyId: application?.propertyId ?? null,
      counterpart: { name: msg.from.name, email: msg.from.address, sourceId: msg.sourceId, threadId: msg.threadId },
      subject: msg.subject,
      lastMessageAt: nowIso,
      unread: 0,
    });
  }
  const stored = rt.store.messages.add({
    conversationId: conversation.id,
    direction: 'in',
    author: 'landlord',
    channel: msg.channel === 'platform' ? 'platform' : 'email',
    subject: msg.subject,
    body: msg.text,
    at: msg.at,
    externalId: msg.id,
    status: 'received',
    attachments: msg.attachments,
  });
  rt.store.conversations.update(conversation.id, { lastMessageAt: nowIso, unread: conversation.unread + 1 });
  const who = msg.from.name ?? msg.from.address ?? 'a landlord';
  rt.bus.emit('message.received', `Reply from ${who}${msg.subject ? `: ${msg.subject}` : ''}`, { conversationId: conversation.id, messageId: stored.id, applicationId: application?.id });

  // Out-of-office and other automatic mail is stored and never answered.
  if (isAutoSubmitted(msg)) return;

  const property = application ? rt.store.properties.get(application.propertyId) : undefined;
  const history = rt.store.messages.list(conversation.id);
  const lastOutbound = [...history].reverse().find((m) => m.direction === 'out');
  const classification: ClassifyOutput = await rt.ai().classify({ message: msg, property, lastOutbound, now: nowIso });
  // The full slot parser knows more Dutch than the provider's quick one; prefer its answer when it finds anything.
  if (classification.intent === 'viewing_slots' || classification.intent === 'viewing_invite') {
    const parsed = parseSlots(msg.text, now);
    if (parsed.length) classification.slots = parsed;
  }
  rt.store.messages.update(stored.id, { intent: classification.intent });

  const flags = feeFlags(msg.text, property?.priceEur);
  const scam = rt.store.matches.get(property?.id ?? '')?.scam ?? { level: 'none' as const, signals: [] };
  const action = application
    ? decidePolicy(classification.intent, { classification, automation: cfg.automation, application, scam })
    : { kind: 'task' as const, task: 'reply_needed' as const, priority: 2 as const, reason: 'This message does not belong to any home the agent contacted.' };

  const listing = property ? rt.store.listings.list({ propertyId: property.id })[0] : undefined;
  const language: Lang = listing ? messageLanguage(cfg.profile, listing) : classification.summary && /[äëïöü]|\b(de|het|een)\b/i.test(msg.text) ? 'nl' : 'en';
  const replyInput = (purpose: ReplyInput['purpose'], chosenSlot?: ProposedSlot): ReplyInput => ({ message: msg, classification, profile: cfg.profile, property, language, purpose, chosenSlot });
  const title = property?.title ?? msg.subject ?? who;
  const base = { propertyId: property?.id, applicationId: application?.id, conversationId: conversation.id };

  const budgetLeft = () => replyBudgetLeft(conversation!.id, rt.store, cfg.automation.maxAutoRepliesPerConversationPerDay, now);
  const replyTask = async (reason: string, draft?: string) =>
    openTask(rt, { kind: 'reply_needed', title: `Answer ${who} about ${title}`, reason, priority: 2, ...base, payload: { draft, messageId: stored.id, summary: classification.summary } }, `reply_needed:${stored.id}`);

  switch (action.kind) {
    case 'ignore':
    case 'ingest_alert':
      return;

    case 'close': {
      if (application) rt.store.applications.update(application.id, { status: action.status }, nowIso);
      rt.bus.emit('application.updated', `${title}: ${action.status === 'rejected' ? 'not selected' : 'no longer available'}`, { applicationId: application?.id, status: action.status });
      return;
    }

    case 'auto_reply': {
      if (budgetLeft() <= 0) return void (await replyTask('The agent already answered this conversation several times today, so it stopped to avoid a loop.'));
      if (action.purpose === 'send_documents') return handleDocuments(rt, { msg, classification, conversation, application, property, who, title, base, stored, language });
      const out = await rt.ai().reply(replyInput(action.purpose));
      if (out.unanswerable.length) return void (await replyTask(`Asks something your profile does not answer: ${out.unanswerable.join('; ')}`, out.body));
      await sendInConversation(rt, conversation, { subject: out.subject, body: out.body, rationale: out.rationale, intent: classification.intent });
      if (application && application.status === 'contacted') rt.store.applications.update(application.id, { status: 'replied' }, nowIso);
      return;
    }

    case 'book_viewing': {
      if (!application || !property) return void (await replyTask('Offers a viewing, but the agent cannot tell which home it is about.'));
      const busy = rt.store.viewings.list({ from: nowIso }).filter((v) => v.state === 'booked').map((v) => ({ start: v.startsAt, end: v.endsAt }));
      const chosen = cfg.automation.autoAcceptViewings ? chooseSlot(classification.slots, cfg.automation.availability, cfg.automation.viewingBufferMin, busy) : null;
      if (!chosen) {
        openTask(rt, {
          kind: 'viewing_choice',
          title: `Pick a viewing time: ${title}`,
          reason: classification.slots.length ? 'None of the offered times fits your availability, or the times were not clear.' : 'Invites you to a viewing without a clear time.',
          priority: 1,
          ...base,
          dueAt: classification.deadline,
          payload: { slots: classification.slots, slotsText: classification.slots.map(slotText), messageId: stored.id },
        }, `viewing_choice:${stored.id}`);
        rt.store.applications.update(application.id, { status: 'viewing_proposed' }, nowIso);
        return;
      }
      if (budgetLeft() <= 0) return void (await replyTask('Proposes a viewing, but the agent has already replied several times today.'));
      const out = await rt.ai().reply(replyInput('confirm_viewing', chosen));
      await sendInConversation(rt, conversation, { subject: out.subject, body: out.body, rationale: out.rationale, intent: classification.intent });
      const endsAt = chosen.end ?? new Date(Date.parse(chosen.start) + VIEWING_MINUTES * 60_000).toISOString();
      const viewing = rt.store.viewings.add({ applicationId: application.id, propertyId: property.id, startsAt: chosen.start, endsAt, state: 'booked', bookedBy: 'agent' });
      rt.store.applications.update(application.id, { status: 'viewing_booked' }, nowIso);
      rt.bus.emit('viewing.booked', `Viewing booked: ${title}, ${slotText(chosen)}`, { viewingId: viewing.id, propertyId: property.id, startsAt: chosen.start });
      openTask(rt, {
        kind: 'viewing_booked',
        title: `Viewing ${slotText(chosen)}: ${title}`,
        reason: 'The agent accepted this time because it fits your availability. Confirm, or reject to cancel it with the landlord.',
        priority: 2,
        ...base,
        dueAt: chosen.start,
        payload: { viewingId: viewing.id, startsAt: chosen.start, endsAt },
      }, `viewing_booked:${viewing.id}`);
      return;
    }

    case 'task': {
      let review: unknown;
      if ((action.task === 'offer_or_contract') && (msg.attachments.length || /contract|overeenkomst/i.test(msg.text))) {
        const pdf = msg.attachments.find((a) => /pdf$/i.test(a.contentType ?? a.filename) && a.path)?.path;
        review = await rt.ai().reviewContract({ text: msg.text, property, priceEur: property?.priceEur, language, pdfPath: pdf }).catch(() => undefined);
      }
      const titles: Record<string, string> = {
        offer_or_contract: `Offer: ${title}`,
        payment_warning: `Payment asked before anything else: ${title}`,
        scam_review: `Possible scam: ${title}`,
        application_form: `Fill in the application form: ${title}`,
        documents_approval: `Documents requested: ${title}`,
        reply_needed: `Answer ${who} about ${title}`,
        viewing_choice: `Pick a viewing time: ${title}`,
      };
      const reasons: Record<string, string> = {
        offer_or_contract: 'An offer or contract is always your decision. Read the review below before you answer.',
        payment_warning: 'Asking for money before a viewing or a signed contract is the most common rental scam. Pay nothing yet.',
        scam_review: 'The message has signs of a scam. The agent did not answer.',
        application_form: 'The landlord wants a form filled in. Your details are ready to copy.',
      };
      openTask(rt, {
        kind: action.task,
        title: titles[action.task] ?? title,
        reason: action.reason ?? reasons[action.task] ?? classification.summary,
        priority: action.priority,
        ...base,
        dueAt: classification.deadline,
        payload: { messageId: stored.id, summary: classification.summary, flags, review, questions: classification.questions, documents: classification.documents },
      }, `${action.task}:${stored.id}`);
      if (action.task === 'offer_or_contract' && application) rt.store.applications.update(application.id, { status: 'offer' }, nowIso);
      return;
    }
  }
}

async function handleDocuments(
  rt: Runtime,
  c: {
    msg: InboundMessage;
    classification: ClassifyOutput;
    conversation: Conversation;
    application?: import('@nlpf/core').Application;
    property?: import('@nlpf/core').Property;
    who: string;
    title: string;
    base: { propertyId?: string; applicationId?: string; conversationId: string };
    stored: Message;
    language: Lang;
  },
): Promise<void> {
  const cfg = rt.config();
  const viewingBooked = c.application?.status === 'viewing_booked' || c.application?.status === 'viewed';
  const scam = rt.store.matches.get(c.property?.id ?? '')?.scam ?? { level: 'none' as const, signals: [] };
  const plan = documentsToSend(c.classification.documents, cfg.automation.documents, { viewingBooked, scam, files: documentFiles(rt) });
  const recipient = c.conversation.counterpart.name ?? c.conversation.counterpart.email ?? 'landlord';
  if (plan.send.length) {
    const attachments = await Promise.all(plan.send.map((d) => prepareAttachment(rt, d, recipient, c.property?.title)));
    const out = await rt.ai().reply({ message: c.msg, classification: c.classification, profile: cfg.profile, property: c.property, language: c.language, purpose: 'send_documents' });
    await sendInConversation(rt, c.conversation, { subject: out.subject, body: out.body, attachments, rationale: out.rationale, intent: c.classification.intent });
  }
  if (plan.approve.length || (!plan.send.length && c.classification.documents.length)) {
    openTask(rt, {
      kind: 'documents_approval',
      title: `Documents requested: ${c.title}`,
      reason: plan.approve.length
        ? `${c.who} asks for ${plan.approve.map((d) => d.kind).join(', ')}. These need your approval before they are sent.`
        : `${c.who} asks for ${c.classification.documents.join(', ')}, which you have not uploaded yet.`,
      priority: 2,
      ...c.base,
      payload: { messageId: c.stored.id, documents: plan.approve.map((d) => d.name), requested: c.classification.documents },
    }, `documents_approval:${c.stored.id}`);
  }
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHANNEL_MAX_CHARS,
  composeInput,
  finaliseMessage,
  inSendWindow,
  messageLanguage,
  nextWindowStart,
  pickVariant,
  planContact,
  renderTenantProfilePdf,
} from '@nlpf/agent';
import { NeedsLoginError } from '@nlpf/sources';
import type { Application, Attachment, Channel, ContactResult, Conversation, Job, Listing, Message, Property } from '@nlpf/core';
import { RetryLater } from '../runner.js';
import { openTask, startOfToday, type Runtime } from '../runtime.js';

const SECOND = 1000;

/** The one-page tenant profile, regenerated when the profile changes. Public: fine to attach to a first email. */
export async function tenantProfileFile(rt: Runtime): Promise<string | undefined> {
  const profile = rt.config().profile;
  if (!profile.firstName) return undefined;
  const file = join(rt.paths.documentsDir, 'tenant-profile.pdf');
  const stamp = JSON.stringify(profile);
  if (!existsSync(file) || rt.store.kv.get('tenant-profile-stamp') !== stamp) {
    await renderTenantProfilePdf(profile, file);
    rt.store.kv.set('tenant-profile-stamp', stamp);
  }
  return file;
}

export interface Draft { subject?: string; body: string; rationale: string; variant?: string; language: 'nl' | 'en' }

/** Writes the first message for a listing through the channel it will go out on. */
export async function draftFirstMessage(rt: Runtime, via: Listing, channel: Channel['kind'], propertyId: string): Promise<Draft> {
  const cfg = rt.config();
  const language = messageLanguage(cfg.profile, via);
  const variant = pickVariant(cfg.automation.variants, propertyId);
  const out = await rt.ai().compose(composeInput(via, cfg.profile, cfg.automation, channel, variant));
  const final = finaliseMessage(out, cfg.automation, language, CHANNEL_MAX_CHARS[channel]);
  return { subject: final.subject, body: final.body, rationale: final.rationale, variant, language };
}

function recordOutbound(
  rt: Runtime,
  opts: { app: Application; property: Property; via: Listing; channel: Channel; draft: Draft; result?: ContactResult; messageId?: string; status: Message['status']; attachments?: Attachment[]; threadCapable?: boolean },
): { conversation: Conversation; message: Message } {
  const nowIso = rt.now().toISOString();
  const { app, via, channel, draft } = opts;
  const counterpart: Conversation['counterpart'] = {
    name: via.agent?.name,
    email: channel.kind === 'email' ? channel.address : via.agent?.email,
    sourceId: channel.kind === 'email' ? undefined : via.sourceId,
    // A platform that answers in its own threads (Kamernet, HousingAnywhere, the sandbox's Huisje)
    // returns the thread id; replies are matched and answered there.
    threadId: opts.result?.externalId && channel.kind !== 'email' && opts.threadCapable ? opts.result.externalId : undefined,
  };
  const conversation =
    rt.store.conversations.byApplication(app.id)[0] ??
    rt.store.conversations.create({ applicationId: app.id, propertyId: opts.property.id, counterpart, subject: draft.subject ?? opts.property.title, lastMessageAt: nowIso, unread: 0 });
  const message = rt.store.messages.add({
    conversationId: conversation.id,
    direction: 'out',
    author: 'agent',
    channel: channel.kind === 'message' ? 'platform' : channel.kind,
    subject: draft.subject,
    body: draft.body,
    at: nowIso,
    externalId: opts.messageId ?? (opts.result?.externalId ? `${via.sourceId}:${opts.result.externalId}` : undefined),
    status: opts.status,
    rationale: [draft.rationale, draft.variant ? `variant ${draft.variant}` : ''].filter(Boolean).join('; '),
    attachments: opts.attachments,
  });
  rt.store.conversations.update(conversation.id, { lastMessageAt: nowIso, counterpart: { ...conversation.counterpart, ...Object.fromEntries(Object.entries(counterpart).filter(([, v]) => v)) } });
  return { conversation, message };
}

/**
 * Contacts one property. Every early exit either reschedules the job (paused,
 * outside the send window, daily cap reached) or ends in a task the person can
 * act on, so a match never silently disappears.
 */
export async function handleContact(rt: Runtime, job: Job): Promise<void> {
  const propertyId = String(job.payload.propertyId);
  const force = job.payload.force === true;
  const property = rt.store.properties.get(propertyId);
  if (!property) return;
  const cfg = rt.config();
  const now = rt.now();
  const nowIso = now.toISOString();
  const app = rt.store.applications.ensure(propertyId, nowIso);
  if (!force && app.status !== 'queued') return;

  if (cfg.automation.paused && !force) throw new RetryLater(new Date(now.getTime() + 60 * SECOND), 'paused');
  // Never write to a landlord as nobody: wait until onboarding has a name and an address.
  // A dry run only drafts, so it may go ahead and show what would be sent.
  if (!cfg.automation.dryRun && (!cfg.profile.firstName.trim() || !cfg.profile.email.trim())) throw new RetryLater(new Date(now.getTime() + 30 * SECOND), 'profile incomplete');
  if (!force && !inSendWindow(now, cfg.automation.sendWindow)) throw new RetryLater(nextWindowStart(now, cfg.automation.sendWindow), 'outside the send window');
  if (!force && rt.store.applications.countContactedSince(startOfToday(now)) >= cfg.automation.dailyCap) {
    const tomorrow = new Date(now.getTime() + 86_400_000);
    throw new RetryLater(nextWindowStart(new Date(startOfToday(tomorrow)), cfg.automation.sendWindow), 'daily cap reached');
  }

  const listings = rt.store.listings.list({ propertyId }).filter((l) => l.state === 'active');
  const primary = listings[0];
  if (!primary) return;
  const registry = { get: (id: string) => rt.adapter(id) };
  const plan = planContact(primary, listings, registry, cfg);

  if (plan.plan !== 'send') {
    // First come, first served booking (Holland2Stay): no message can win it, a person
    // clicking now can. Open the booking page on the user's screen and push an urgent task.
    const booking = listings.find((l) => l.contact === 'booking' && typeof l.extra?.bookingUrl === 'string');
    if (booking) {
      const url = String(booking.extra!.bookingUrl);
      if (rt.openOnScreen) await rt.openOnScreen(url).catch(() => undefined);
      rt.store.applications.update(app.id, { status: 'manual', note: 'Booking needs a person' }, nowIso);
      openTask(rt, {
        kind: 'react_manually',
        title: `Book it now: ${property.title}`,
        reason: `${rt.adapter(booking.sourceId)?.name ?? 'This site'} books homes first come, first served, and its check needs a person. The booking page is open on your screen.`,
        priority: 1,
        propertyId,
        applicationId: app.id,
        sourceId: booking.sourceId,
        dueAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
        payload: { url },
      }, `book:${propertyId}`);
      return;
    }
    const via = primary;
    const channel = via.contact === 'email' ? 'email' : via.contact === 'message' ? 'message' : 'form';
    const draft = await draftFirstMessage(rt, via, channel, propertyId);
    rt.store.applications.update(app.id, { status: 'manual', note: plan.reason }, nowIso);
    openTask(rt, {
      kind: 'react_manually',
      title: `React yourself: ${property.title}`,
      reason: plan.reason,
      priority: 2,
      propertyId,
      applicationId: app.id,
      payload: { draft: draft.body, subject: draft.subject, url: via.url, sources: listings.map((l) => l.sourceId) },
    }, `react_manually:${propertyId}`);
    return;
  }

  const { channel, via } = plan;
  const adapter = channel.sourceId ? rt.adapter(channel.sourceId) : undefined;

  // Still online? A stale listing is the most common complaint about every alert service.
  if (cfg.automation.recheckBeforeSend && adapter?.isAvailable) {
    const available = await adapter.isAvailable(via, rt.sourceContext(adapter)).catch(() => true);
    if (!available) {
      rt.store.listings.setState(via.id, 'gone', nowIso);
      rt.store.applications.update(app.id, { status: 'gone' }, nowIso);
      rt.bus.emit('listing.gone', `${via.title} is no longer online, nothing sent`, { propertyId, listingId: via.id });
      return;
    }
  }

  const draft = job.payload.message
    ? { body: String(job.payload.message), rationale: 'written by you', language: 'nl' as const }
    : await draftFirstMessage(rt, via, channel.kind, propertyId);

  if (cfg.automation.dryRun) {
    recordOutbound(rt, { app, property, via, channel, draft, status: 'draft' });
    rt.bus.emit('message.drafted', `Dry run: drafted a message for ${property.title}`, { propertyId, channel: channel.kind });
    return;
  }

  let result: ContactResult;
  let messageId: string | undefined;
  const attachments: Attachment[] = [];
  try {
    if (channel.kind === 'email') {
      const mailbox = rt.mailbox();
      if (!mailbox || !channel.address) throw new Error('No mailbox configured for email contact.');
      const profilePdf = await tenantProfileFile(rt).catch(() => undefined);
      if (profilePdf && cfg.automation.documents.public === 'auto') attachments.push({ filename: 'tenant-profile.pdf', path: profilePdf });
      const sent = await mailbox.send({
        to: channel.address,
        subject: draft.subject ?? property.title,
        text: draft.body,
        attachments: attachments.map((a) => ({ filename: a.filename, path: a.path! })),
      });
      messageId = sent.messageId;
      result = { ok: true, channel: 'email', externalId: sent.messageId };
    } else {
      if (!adapter?.contact) throw new Error(`${channel.sourceId} cannot send messages.`);
      result = await adapter.contact(via, { subject: draft.subject, body: draft.body, language: draft.language, profile: cfg.profile, dryRun: false }, rt.sourceContext(adapter));
    }
  } catch (err) {
    if (err instanceof NeedsLoginError) result = { ok: false, channel: channel.kind, needs: 'login', error: err.message };
    else result = { ok: false, channel: channel.kind, error: (err as Error).message };
  }

  if (!result.ok) {
    const sourceName = adapter?.name ?? channel.sourceId ?? 'the agent';
    const kind = result.needs === 'login' ? 'reconnect' : result.needs === 'captcha' ? 'captcha' : result.needs === 'human' ? 'send_uncertain' : 'react_manually';
    const reason =
      result.needs === 'login' ? `${sourceName} logged the agent out. Log in again with nlpf connect ${channel.sourceId}, then approve to send.`
      : result.needs === 'captcha' ? `${sourceName} showed a captcha. Send the message yourself, it is ready below.`
      : result.needs === 'human' ? `The form on ${sourceName} was sent but showed no confirmation. Check whether it arrived before sending again.`
      : result.needs === 'paid' ? `${sourceName} wants a paid plan to react. The message is ready if you want to send it yourself.`
      : `Sending through ${sourceName} failed: ${result.error ?? 'unknown error'}. The message is ready below.`;
    rt.store.applications.update(app.id, { status: 'manual', note: reason }, nowIso);
    recordOutbound(rt, { app, property, via, channel, draft, result, status: 'failed' });
    rt.bus.emit('message.failed', `Could not contact ${property.title}: ${result.needs ?? result.error ?? 'failed'}`, { propertyId, needs: result.needs });
    const bookingUrl = typeof via.extra?.bookingUrl === 'string' ? via.extra.bookingUrl : undefined;
    if (result.needs === 'human' && bookingUrl && rt.openOnScreen) await rt.openOnScreen(bookingUrl).catch(() => undefined);
    openTask(rt, {
      kind,
      title: bookingUrl ? `Book it now: ${property.title}` : `${kind === 'send_uncertain' ? 'Check' : 'Send yourself'}: ${property.title}`,
      reason: bookingUrl ? 'First come, first served. The booking page is open on your screen.' : reason,
      priority: bookingUrl ? 1 : 2,
      propertyId,
      applicationId: app.id,
      sourceId: channel.sourceId,
      payload: { draft: draft.body, subject: draft.subject, url: bookingUrl ?? via.url },
    }, `${kind}:${propertyId}`);
    return;
  }

  const firstSeen = Math.min(...listings.map((l) => Date.parse(l.firstSeenAt)));
  const reactionMs = Math.max(0, now.getTime() - firstSeen);
  recordOutbound(rt, { app, property, via, channel, draft, result, messageId, status: 'sent', attachments, threadCapable: !!adapter?.reply });
  rt.store.applications.update(app.id, { status: 'contacted', contactedAt: nowIso, reactionMs, channel }, nowIso);
  rt.bus.emit('message.sent', `Sent to ${via.agent?.name ?? adapter?.name ?? 'the landlord'} about ${property.title}, ${Math.round(reactionMs / 1000)} s after it appeared`, {
    propertyId, channel: channel.kind, sourceId: channel.sourceId, reactionMs,
  });
}

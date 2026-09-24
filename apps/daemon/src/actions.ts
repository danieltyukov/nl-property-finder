import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chooseSlot, VIEWING_MINUTES, withdrawalText, messageLanguage, profileLanguage } from '@nlpf/agent';
import { SourceConfigSchema, type ProposedSlot, type SourceState, type StatsView, type Task } from '@nlpf/core';
import type { DaemonActions, DocumentInfo } from './context.js';
import { draftFirstMessage, tenantProfileFile } from './pipelines/contact.js';
import { documentFiles, documentIndex, prepareAttachment, sendInConversation, writeDocumentIndex } from './pipelines/inbound.js';
import { initialState } from './scheduler.js';
import { openTask, type Runtime } from './runtime.js';
import { computeStats } from './stats.js';

export interface ActionDeps {
  rt: Runtime;
  connect(adapter: import('@nlpf/core').SourceAdapter): Promise<'ok' | 'timeout'>;
  setPaused(paused: boolean): void;
  notifyTest(): Promise<{ sent: boolean; channels: string[]; problems: string[] }>;
  patchSourceConfig(id: string, patch: Record<string, unknown>): void;
}

const SAFE_NAME = /^[\w.\- ]{1,120}$/;

export function createActions(d: ActionDeps): DaemonActions {
  const { rt } = d;
  const now = () => rt.now().toISOString();

  const finish = (task: Task, state: Task['state'] = 'done', extra: Partial<Task> = {}) =>
    rt.store.tasks.update(task.id, { state, resolvedBy: 'human', ...extra }, now());

  const conversationFor = (task: Task) =>
    task.conversationId
      ? rt.store.conversations.get(task.conversationId)
      : task.applicationId
        ? rt.store.conversations.byApplication(task.applicationId)[0]
        : undefined;

  async function confirmSlot(task: Task, slot: ProposedSlot) {
    const conv = conversationFor(task);
    const app = task.applicationId ? rt.store.applications.get(task.applicationId) : undefined;
    if (!conv || !app) throw new Error('This task is not linked to a conversation.');
    const cfg = rt.config();
    const property = rt.store.properties.get(app.propertyId);
    const lastIn = [...rt.store.messages.list(conv.id)].reverse().find((m) => m.direction === 'in');
    const out = await rt.ai().reply({
      message: { id: lastIn?.externalId ?? 'manual', channel: 'email', from: { address: conv.counterpart.email }, text: lastIn?.body ?? '', at: now(), attachments: [] },
      classification: { intent: 'viewing_slots', confidence: 1, slots: [slot], questions: [], documents: [], summary: '' },
      profile: cfg.profile,
      property,
      language: profileLanguage(cfg.profile),
      purpose: 'confirm_viewing',
      chosenSlot: slot,
    });
    await sendInConversation(rt, conv, { subject: out.subject, body: out.body, author: 'human', rationale: 'You picked this time.' });
    const endsAt = slot.end ?? new Date(Date.parse(slot.start) + VIEWING_MINUTES * 60_000).toISOString();
    const v = rt.store.viewings.add({ applicationId: app.id, propertyId: app.propertyId, startsAt: slot.start, endsAt, state: 'booked', bookedBy: 'human' });
    rt.store.applications.update(app.id, { status: 'viewing_booked' }, now());
    rt.bus.emit('viewing.booked', `Viewing booked: ${property?.title ?? ''}`, { viewingId: v.id, propertyId: app.propertyId, startsAt: slot.start });
  }

  const actions: DaemonActions = {
    pause: () => d.setPaused(true),
    resume: () => d.setPaused(false),

    async resolveTask(id, body) {
      const task = rt.store.tasks.get(id);
      if (!task) throw new Error('Task not found');
      const payload = task.payload ?? {};
      switch (body.action) {
        case 'dismiss':
          return finish(task, 'dismissed');
        case 'done':
          return finish(task, 'done');
        case 'snooze':
          return rt.store.tasks.update(task.id, { state: 'snoozed', snoozedUntil: body.until ?? new Date(rt.now().getTime() + 3 * 3_600_000).toISOString() }, now());
        case 'send_draft': {
          const conv = conversationFor(task);
          const text = body.draft ?? (typeof payload.draft === 'string' ? payload.draft : undefined);
          if (!text) throw new Error('There is no draft to send.');
          if (conv) await sendInConversation(rt, conv, { body: text, author: 'human', rationale: 'Approved by you.' });
          else if (task.propertyId) await actions.contactProperty(task.propertyId, { message: text, force: true });
          else throw new Error('This task has nowhere to send a message.');
          return finish(task);
        }
        case 'reject': {
          if (task.kind === 'viewing_booked' && typeof payload.viewingId === 'string') {
            const conv = conversationFor(task);
            rt.store.viewings.update(payload.viewingId, { state: 'cancelled' });
            if (conv) {
              const cfg = rt.config();
              const nl = profileLanguage(cfg.profile) === 'nl';
              await sendInConversation(rt, conv, {
                body: nl
                  ? `Beste,\n\nHelaas kan ik op het afgesproken moment toch niet komen. Zou een ander moment mogelijk zijn?\n\nMet vriendelijke groet,\n${cfg.profile.firstName} ${cfg.profile.lastName}`
                  : `Hello,\n\nUnfortunately I cannot make the agreed time after all. Would another time be possible?\n\nKind regards,\n${cfg.profile.firstName} ${cfg.profile.lastName}`,
                author: 'human',
                rationale: 'You cancelled the viewing the agent booked.',
              });
            }
            rt.bus.emit('viewing.cancelled', `Viewing cancelled: ${task.title}`, { viewingId: payload.viewingId });
          }
          if (task.kind === 'approve_outreach' && task.applicationId) rt.store.applications.update(task.applicationId, { status: 'skipped' }, now());
          return finish(task, 'dismissed');
        }
        case 'approve': {
          switch (task.kind) {
            case 'approve_outreach':
            case 'scam_review':
            case 'reconnect':
              if (task.propertyId) {
                const app = rt.store.applications.byProperty(task.propertyId);
                if (app && app.status !== 'contacted') rt.store.applications.update(app.id, { status: 'queued' }, now());
                rt.store.jobs.enqueue('contact', `contact:${task.propertyId}:${Date.now()}`, { propertyId: task.propertyId, force: true }, now());
              }
              return finish(task);
            case 'viewing_choice': {
              const slots = (payload.slots as ProposedSlot[] | undefined) ?? [];
              const slot = body.slot !== undefined ? slots[body.slot] : chooseSlot(slots, rt.config().automation.availability, 0, []);
              if (!slot) throw new Error('Pick one of the offered times.');
              await confirmSlot(task, slot);
              return finish(task);
            }
            case 'documents_approval': {
              const conv = conversationFor(task);
              if (!conv) throw new Error('This task is not linked to a conversation.');
              const wanted = new Set((payload.documents as string[] | undefined) ?? []);
              const files = documentFiles(rt).filter((f) => wanted.size === 0 || wanted.has(f.name));
              if (!files.length) throw new Error('Upload the requested documents on the Profile page first.');
              const recipient = conv.counterpart.name ?? conv.counterpart.email ?? 'landlord';
              const property = task.propertyId ? rt.store.properties.get(task.propertyId) : undefined;
              const attachments = await Promise.all(files.map((f) => prepareAttachment(rt, f, recipient, property?.title)));
              const cfg = rt.config();
              const nl = profileLanguage(cfg.profile) === 'nl';
              await sendInConversation(rt, conv, {
                body: nl
                  ? `Beste,\n\nIn de bijlage vindt u de gevraagde documenten.\n\nMet vriendelijke groet,\n${cfg.profile.firstName} ${cfg.profile.lastName}`
                  : `Hello,\n\nPlease find the requested documents attached.\n\nKind regards,\n${cfg.profile.firstName} ${cfg.profile.lastName}`,
                attachments,
                author: 'human',
                rationale: 'You approved sending these documents.',
              });
              return finish(task);
            }
            case 'viewing_booked':
              return finish(task);
            default:
              if (typeof payload.draft === 'string') return actions.resolveTask(id, { action: 'send_draft' });
              return finish(task);
          }
        }
      }
    },

    async contactProperty(id, body) {
      const property = rt.store.properties.get(id);
      if (!property) throw new Error('Property not found');
      const app = rt.store.applications.ensure(id, now());
      if (app.status === 'contacted' && !body.force) return { ok: false, detail: 'This home was already contacted. Use force to send another first message.' };
      rt.store.applications.update(app.id, { status: 'queued' }, now());
      const job = rt.store.jobs.enqueue('contact', `contact:${id}:${Date.now()}`, { propertyId: id, force: true, message: body.message }, now());
      return { ok: !!job, detail: 'Queued. It goes out within a few seconds.' };
    },

    async skipProperty(id) {
      const app = rt.store.applications.ensure(id, now());
      rt.store.applications.update(app.id, { status: 'skipped' }, now());
    },

    async sendMessage(conversationId, body) {
      const conv = rt.store.conversations.get(conversationId);
      if (!conv) throw new Error('Conversation not found');
      if (!body.send) {
        return rt.store.messages.add({ conversationId, direction: 'out', author: 'human', channel: conv.counterpart.email ? 'email' : 'platform', subject: body.subject, body: body.body, at: now(), status: 'draft' });
      }
      return sendInConversation(rt, conv, { subject: body.subject, body: body.body, author: 'human' });
    },

    async draft(body) {
      if (body.propertyId) {
        const listing = rt.store.listings.list({ propertyId: body.propertyId })[0];
        if (!listing) throw new Error('Property not found');
        const channel = listing.contact === 'email' ? 'email' : listing.contact === 'message' ? 'message' : 'form';
        const d = await draftFirstMessage(rt, listing, channel, body.propertyId);
        return { subject: d.subject, body: d.body };
      }
      if (body.conversationId) {
        const conv = rt.store.conversations.get(body.conversationId);
        if (!conv) throw new Error('Conversation not found');
        const lastIn = [...rt.store.messages.list(conv.id)].reverse().find((m) => m.direction === 'in');
        const cfg = rt.config();
        const property = conv.propertyId ? rt.store.properties.get(conv.propertyId) : undefined;
        const listing = property ? rt.store.listings.list({ propertyId: property.id })[0] : undefined;
        const inbound = { id: lastIn?.externalId ?? 'draft', channel: 'email' as const, from: { address: conv.counterpart.email }, subject: lastIn?.subject, text: lastIn?.body ?? '', at: now(), attachments: [] };
        const classification = await rt.ai().classify({ message: inbound, property, now: now() });
        const out = await rt.ai().reply({ message: inbound, classification, profile: cfg.profile, property, language: listing ? messageLanguage(cfg.profile, listing) : profileLanguage(cfg.profile), purpose: 'answer' });
        const text = body.instructions ? `${out.body}` : out.body;
        return { subject: out.subject, body: text };
      }
      throw new Error('Give a propertyId or a conversationId.');
    },

    async testSource(id) {
      const adapter = rt.adapter(id);
      if (!adapter) throw new Error(`Unknown source ${id}`);
      const cfg = rt.config();
      const started = Date.now();
      try {
        const reqs = adapter.buildSearches(cfg.searches.filter((s) => s.enabled), SourceConfigSchema.parse(cfg.sources[id] ?? {}));
        const first = reqs[0];
        if (!first) return { ok: true, count: 0, sample: [], ms: Date.now() - started, error: 'No search applies to this source with your current searches.' };
        const listings = await adapter.search(first, rt.sourceContext(adapter));
        return { ok: true, count: listings.length, sample: listings.slice(0, 5), ms: Date.now() - started };
      } catch (e) {
        return { ok: false, count: 0, sample: [], ms: Date.now() - started, error: (e as Error).message };
      }
    },

    async connectSource(id) {
      const adapter = rt.adapter(id);
      if (!adapter) throw new Error(`Unknown source ${id}`);
      const result = await d.connect(adapter);
      if (result === 'ok') {
        const s = rt.store.sources.get(id) ?? initialState(adapter, rt.config());
        rt.store.sources.put({ ...s, health: 'ok', lastError: undefined });
        for (const t of rt.store.tasks.list({ state: 'active', kind: 'reconnect' }).filter((t) => t.sourceId === id)) rt.store.tasks.update(t.id, { state: 'done', resolvedBy: 'agent' }, now());
        rt.bus.emit('source.health', `${adapter.name} is connected`, { sourceId: id, health: 'ok' });
      }
    },

    async pollSource(id) {
      const adapter = rt.adapter(id);
      if (!adapter) throw new Error(`Unknown source ${id}`);
      rt.store.jobs.enqueue('poll', `poll:${id}:manual:${Date.now()}`, { sourceId: id }, now());
    },

    async patchSource(id, body) {
      const adapter = rt.adapter(id) ?? rt.adapters().find((a) => a.id === id);
      const patch: Record<string, unknown> = {};
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.intervalSec !== undefined) patch.intervalSec = body.intervalSec;
      if (body.contact !== undefined) patch.contact = body.contact;
      if (body.paidPlan !== undefined) patch.paidPlan = body.paidPlan ?? undefined;
      d.patchSourceConfig(id, patch);
      const state: SourceState = rt.store.sources.get(id) ?? (adapter ? initialState(adapter, rt.config()) : { sourceId: id, name: id, enabled: true, health: 'ok', consecutiveFailures: 0, consecutiveEmpty: 0 });
      const next = { ...state, enabled: body.enabled ?? state.enabled, health: body.enabled === false ? 'disabled' as const : state.health === 'disabled' ? 'ok' as const : state.health };
      rt.store.sources.put(next);
      return next;
    },

    async withdrawAll(body) {
      const cfg = rt.config();
      const open = rt.store.applications.list().filter((a) => ['contacted', 'replied', 'viewing_proposed', 'viewing_booked', 'offer'].includes(a.status));
      let withdrawn = 0;
      let skipped = 0;
      for (const app of open) {
        const property = rt.store.properties.get(app.propertyId);
        if (body.foundAddress && property && property.title.toLowerCase().includes(body.foundAddress.toLowerCase())) {
          skipped++;
          continue;
        }
        const conv = rt.store.conversations.byApplication(app.id)[0];
        if (conv) {
          const listing = rt.store.listings.list({ propertyId: app.propertyId })[0];
          const lang = listing ? messageLanguage(cfg.profile, listing) : profileLanguage(cfg.profile);
          try {
            await sendInConversation(rt, conv, { body: body.message ?? withdrawalText(cfg.automation, cfg.profile, lang), author: 'human', rationale: 'You found a place.' });
          } catch (e) {
            rt.log.warn('withdrawal not sent', { applicationId: app.id, error: (e as Error).message });
          }
        }
        for (const v of rt.store.viewings.list().filter((v) => v.applicationId === app.id && v.state === 'booked')) rt.store.viewings.update(v.id, { state: 'cancelled' });
        rt.store.applications.update(app.id, { status: 'withdrawn' }, now());
        withdrawn++;
      }
      if (body.pause) d.setPaused(true);
      rt.bus.emit('applications.withdrawn', `Withdrew ${withdrawn} applications`, { withdrawn, skipped });
      return { withdrawn, skipped };
    },

    listDocuments(): DocumentInfo[] {
      return documentIndex(rt);
    },

    saveDocument(name, sensitivity, kind, bytes) {
      const safe = basename(name).replace(/[^\w.\- ]/g, '_');
      if (!SAFE_NAME.test(safe)) throw new Error('Choose a simpler file name.');
      writeFileSync(join(rt.paths.documentsDir, safe), bytes, { mode: 0o600 });
      const entry: DocumentInfo = { name: safe, sensitivity, kind, size: bytes.byteLength, addedAt: now() };
      writeDocumentIndex(rt, [...documentIndex(rt).filter((d) => d.name !== safe), entry]);
      return entry;
    },

    deleteDocument(name) {
      const safe = basename(name);
      const file = join(rt.paths.documentsDir, safe);
      if (existsSync(file)) rmSync(file);
      writeDocumentIndex(rt, documentIndex(rt).filter((d) => d.name !== safe));
    },

    async tenantProfilePdf() {
      const file = await tenantProfileFile(rt);
      if (!file) throw new Error('Fill in your profile first.');
      return new Uint8Array(readFileSync(file));
    },

    stats(): StatsView {
      return computeStats(rt);
    },

    notifyTest: () => d.notifyTest(),
  };
  void openTask;
  return actions;
}

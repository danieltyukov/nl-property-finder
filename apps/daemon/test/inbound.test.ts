import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ConfigSchema, createEventBus, memoryLogger, openStore, resolvePaths, type InboundMessage, type NlpfEvent } from '@nlpf/core';
import { handleInbound } from '../src/pipelines/inbound.js';
import { notificationFor } from '../src/pipelines/notify.js';
import type { Runtime } from '../src/runtime.js';

const T = '2026-10-01T18:56:15.000Z';

function runtime() {
  const store = openStore(':memory:');
  const config = ConfigSchema.parse({ profile: { firstName: 'Sam', lastName: 'de Vries', email: 'sam@example.test' } });
  const rt = {
    paths: resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-inbound-')) }),
    store,
    bus: createEventBus(store),
    log: memoryLogger(),
    demo: false,
    config: () => config,
    secrets: () => ({}),
    now: () => new Date('2026-10-01T18:57:11.000Z'),
    adapters: () => [],
    adapter: () => undefined,
    ai: () => {
      throw new Error('the model is not asked about a request to confirm an email address');
    },
    mailbox: () => undefined,
  } as unknown as Runtime;
  const p = store.properties.create(
    { id: 'p_rietdijk', key: 'k', title: 'Rietdijk 2 B', address: { street: 'Rietdijk', houseNumber: '2', addition: 'B', postcode: '3082 DS', city: 'Rotterdam' } },
    T,
  );
  const app = store.applications.update(store.applications.ensure(p.id, T).id, { status: 'contacted', contactedAt: T }, T);
  return { rt, store, app };
}

const leadflow: InboundMessage = {
  id: '<welkom@leadflow.example>',
  channel: 'email',
  from: { address: 'contact@leadflow.rent' },
  subject: '[Actie vereist] Welkom bij leadflow Sam de Vries! Bevestig jouw e-mailadres.',
  text: 'Je hebt gereageerd op de woning aan de Rietdijk, 3082DS, Rotterdam, aangeboden door Randstad Vastgoed.\n\nBevestig e-mailadres ( https://u1.ct.sendgrid.net/ls/click?upn=confirm )',
  at: '2026-10-01T18:57:06.000Z',
  autoSubmitted: true,
  attachments: [],
};

test('a lead platform asking to confirm the email address becomes a confirm task on the right home, with the link', async () => {
  const { rt, store, app } = runtime();
  await handleInbound(rt, leadflow);
  const [task] = store.tasks.list({ state: 'active' });
  expect(task).toMatchObject({
    kind: 'confirm_email',
    priority: 1,
    title: 'Confirm your email with leadflow: Rietdijk 2 B',
    propertyId: 'p_rietdijk',
    applicationId: app.id,
    payload: { url: 'https://u1.ct.sendgrid.net/ls/click?upn=confirm' },
  });
  expect(store.conversations.get(task!.conversationId!)?.applicationId).toBe(app.id);
});

test('a phone notification offers Send draft only when there is a draft', () => {
  const { rt, store } = runtime();
  const open = (payload: Record<string, unknown>) =>
    store.tasks.open({ kind: 'reply_needed', title: 'Answer', reason: 'r', priority: 2, payload }, T, `k${Object.keys(payload).length}`).task;
  const event = (taskId: string) => ({ id: 1, type: 'task.created', at: T, summary: '', data: { taskId } }) as NlpfEvent;
  expect(notificationFor(rt, event(open({}).id))?.actions).toEqual([{ id: 'snooze', label: 'Later' }]);
  expect(notificationFor(rt, event(open({ draft: 'Beste,' }).id))?.actions?.map((a) => a.id)).toEqual(['send_draft', 'snooze']);
});

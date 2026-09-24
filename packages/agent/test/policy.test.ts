import { describe, expect, test } from 'vitest';
import {
  AutomationSchema,
  type Application,
  type AutomationConfig,
  type ClassifyOutput,
  type Intent,
  type ScamVerdict,
} from '@nlpf/core';
import { decidePolicy, type PolicyAction } from '../src/policy.js';

const automation = (over: Partial<AutomationConfig> = {}): AutomationConfig => ({
  ...AutomationSchema.parse({}),
  ...over,
});
const app: Application = {
  id: 'app_1',
  propertyId: 'p_1',
  status: 'contacted',
  firstSeenAt: 't',
  updatedAt: 't',
};
const clean: ScamVerdict = { level: 'none', signals: [] };
const slot = { start: '2026-09-24T16:30:00.000Z', text: 'donderdag 24 sept om 18:30', certain: true };
const classification = (intent: Intent, over: Partial<ClassifyOutput> = {}): ClassifyOutput => ({
  intent,
  confidence: 0.9,
  slots: intent.startsWith('viewing') ? [slot] : [],
  questions: [],
  documents: [],
  summary: 's',
  ...over,
});

const decide = (
  intent: Intent,
  over: {
    classification?: Partial<ClassifyOutput>;
    automation?: Partial<AutomationConfig>;
    application?: Application | null;
    scam?: ScamVerdict;
  } = {},
): PolicyAction =>
  decidePolicy(intent, {
    classification: classification(intent, over.classification),
    automation: automation(over.automation),
    application: over.application === null ? undefined : (over.application ?? app),
    scam: over.scam ?? clean,
  });

const kindOf = (a: PolicyAction) =>
  a.kind === 'task'
    ? `task:${a.task}:${a.priority}`
    : a.kind === 'auto_reply'
      ? `auto_reply:${a.purpose}`
      : a.kind === 'close'
        ? `close:${a.status}`
        : a.kind;

describe('spec defaults', () => {
  const expected: Record<Intent, string> = {
    viewing_invite: 'book_viewing',
    viewing_slots: 'book_viewing',
    info_request: 'task:reply_needed:2',
    documents_request: 'auto_reply:send_documents',
    application_form: 'task:application_form:2',
    rejection: 'close:rejected',
    listing_gone: 'close:gone',
    offer: 'task:offer_or_contract:1',
    contract: 'task:offer_or_contract:1',
    payment_request: 'task:payment_warning:1',
    scam_suspect: 'task:scam_review:2',
    alert: 'ingest_alert',
    newsletter: 'ignore',
    other: 'task:reply_needed:2',
  };
  for (const [intent, action] of Object.entries(expected) as [Intent, string][]) {
    test(`${intent} -> ${action}`, () => expect(kindOf(decide(intent))).toBe(action));
  }
});

test('info_request with questions is answered automatically', () => {
  expect(decide('info_request', { classification: { questions: ['Rookt u?'] } })).toEqual({
    kind: 'auto_reply',
    purpose: 'answer',
  });
});

test('scam_suspect becomes a scam_review task', () => {
  expect(decide('scam_suspect')).toMatchObject({ kind: 'task', task: 'scam_review' });
});

test('offer, contract and payment_request can never be automatic', () => {
  const policies = { payment_request: 'auto', offer: 'auto', contract: 'auto' } as const;
  expect(kindOf(decide('payment_request', { automation: { policies } }))).toBe('task:payment_warning:1');
  expect(kindOf(decide('offer', { automation: { policies } }))).toBe('task:offer_or_contract:1');
  expect(kindOf(decide('contract', { automation: { policies } }))).toBe('task:offer_or_contract:1');
});

test('configured policies override the defaults', () => {
  expect(kindOf(decide('viewing_invite', { automation: { policies: { viewing_invite: 'task' } } }))).toBe(
    'task:viewing_choice:1',
  );
  expect(
    kindOf(decide('documents_request', { automation: { policies: { documents_request: 'task' } } })),
  ).toBe('task:documents_approval:2');
  expect(kindOf(decide('rejection', { automation: { policies: { rejection: 'ignore' } } }))).toBe('ignore');
  expect(kindOf(decide('newsletter', { automation: { policies: { newsletter: 'task' } } }))).toBe(
    'task:reply_needed:3',
  );
});

test('viewings are not booked automatically when auto-accept is off or no slot is certain', () => {
  expect(kindOf(decide('viewing_invite', { automation: { autoAcceptViewings: false } }))).toBe(
    'task:viewing_choice:1',
  );
  expect(kindOf(decide('viewing_slots', { classification: { slots: [{ ...slot, certain: false }] } }))).toBe(
    'task:viewing_choice:1',
  );
  expect(kindOf(decide('viewing_invite', { classification: { slots: [] } }))).toBe('task:viewing_choice:1');
});

test('a reply that matches no application is never dropped (Review Focus 3)', () => {
  for (const intent of [
    'viewing_invite',
    'info_request',
    'documents_request',
    'rejection',
    'listing_gone',
    'other',
  ] as Intent[]) {
    const a = decide(intent, { application: null, classification: { questions: ['x'] } });
    expect(a).toMatchObject({ kind: 'task', task: 'reply_needed', priority: 2 });
  }
  expect(kindOf(decide('payment_request', { application: null }))).toBe('task:payment_warning:1');
  expect(kindOf(decide('alert', { application: null }))).toBe('ingest_alert');
});

test('a likely scam gets no automatic reply', () => {
  const scam: ScamVerdict = { level: 'likely', signals: ['keys_by_post'] };
  expect(kindOf(decide('documents_request', { scam }))).toBe('task:scam_review:2');
  expect(kindOf(decide('viewing_invite', { scam }))).toBe('task:scam_review:2');
});

test('paused automation turns automatic replies into tasks', () => {
  expect(kindOf(decide('viewing_invite', { automation: { paused: true } }))).toBe('task:viewing_choice:1');
  expect(
    kindOf(decide('info_request', { automation: { paused: true }, classification: { questions: ['x'] } })),
  ).toBe('task:reply_needed:2');
  expect(kindOf(decide('rejection', { automation: { paused: true } }))).toBe('close:rejected');
});

test('a low-confidence classification is checked by a person', () => {
  expect(kindOf(decide('rejection', { classification: { confidence: 0.2 } }))).toBe('task:reply_needed:2');
  expect(kindOf(decide('viewing_invite', { classification: { confidence: 0.2 } }))).toBe(
    'task:viewing_choice:1',
  );
});

test('a withdrawn application gets no automatic action', () => {
  expect(kindOf(decide('viewing_invite', { application: { ...app, status: 'withdrawn' } }))).toBe(
    'task:reply_needed:3',
  );
});

test('tasks carry a reason', () => {
  const a = decide('payment_request');
  expect(a.kind === 'task' && a.reason).toMatch(/payment/i);
});

import { expect, test } from 'vitest';
import { AutomationSchema, type Application, type ClassifyOutput } from '@nlpf/core';
import { decidePolicy } from '../src/policy.js';
import { chooseSlot, parseSlots } from '../src/slots.js';

// Review Focus 5 end to end: text, slots, policy, choice.
const now = new Date('2026-09-23T10:00:00Z');
const automation = AutomationSchema.parse({});
const app: Application = {
  id: 'app_1',
  propertyId: 'p_1',
  status: 'contacted',
  firstSeenAt: 't',
  updatedAt: 't',
};

function decide(text: string) {
  const slots = parseSlots(text, now);
  const classification: ClassifyOutput = {
    intent: 'viewing_slots',
    confidence: 0.9,
    slots,
    questions: [],
    documents: [],
    summary: '',
  };
  const action = decidePolicy('viewing_slots', {
    classification,
    automation,
    application: app,
    scam: { level: 'none', signals: [] },
  });
  return { slots, action };
}

test('an ambiguous time becomes a viewing_choice task, not a booking', () => {
  expect(decide('Kunt u donderdag 26 sept om half zeven?').action).toMatchObject({
    kind: 'task',
    task: 'viewing_choice',
  });
  expect(decide('Zondag 25 oktober 02:30 kan ook').action).toMatchObject({
    kind: 'task',
    task: 'viewing_choice',
  });
});

test('a clear time inside availability is booked', () => {
  const { slots, action } = decide('Bezichtiging donderdag 24 sept om 18:30 of vrijdag om 19:00?');
  expect(action).toEqual({ kind: 'book_viewing' });
  expect(chooseSlot(slots, automation.availability, automation.viewingBufferMin, [])?.start).toBe(
    '2026-09-24T16:30:00.000Z',
  );
});

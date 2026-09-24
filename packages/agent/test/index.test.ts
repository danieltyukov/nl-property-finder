import { expect, test } from 'vitest';
import * as agent from '../src/index.js';

// The names the daemon (Task 14) calls, as listed under Task 8 in the plan.
const PLANNED = [
  'normaliseListing',
  'createGeocoder',
  'clusterKey',
  'assignProperty',
  'evaluateFilters',
  'evaluateRequirements',
  'scamSignals',
  'scamLevel',
  'effectiveContactMode',
  'planContact',
  'inSendWindow',
  'nextWindowStart',
  'decidePolicy',
  'parseSlots',
  'chooseSlot',
  'matchInbound',
  'documentsToSend',
  'renderTenantProfilePdf',
  'estimateMaxRent',
  'commuteMinutes',
  'pickVariant',
  'lookupPropertyFacts',
  'rentCheck',
  'feeFlags',
  'watermarkDocument',
  'followUpDue',
  'isAutoSubmitted',
  'replyBudgetLeft',
  'adaptiveInterval',
];

test('the package exports every planned function', () => {
  const missing = PLANNED.filter((name) => typeof (agent as Record<string, unknown>)[name] !== 'function');
  expect(missing).toEqual([]);
});

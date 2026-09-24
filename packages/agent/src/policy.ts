import type {
  Application,
  ApplicationStatus,
  AutomationConfig,
  ClassifyOutput,
  Intent,
  ReplyInput,
  ScamVerdict,
  TaskKind,
} from '@nlpf/core';

export type PolicyAction =
  | { kind: 'auto_reply'; purpose: ReplyInput['purpose'] }
  | { kind: 'book_viewing' }
  | { kind: 'task'; task: TaskKind; priority: 1 | 2 | 3; reason?: string }
  | { kind: 'close'; status: ApplicationStatus }
  | { kind: 'ingest_alert' }
  | { kind: 'ignore' };

export interface PolicyContext {
  classification: ClassifyOutput;
  automation: AutomationConfig;
  application?: Application;
  scam: ScamVerdict;
}

/** Money and signatures always go to a person, whatever the config says. */
const NEVER_AUTO = new Set<Intent>(['offer', 'contract', 'payment_request']);

/** Below this the classifier is guessing, so automatic actions become tasks. */
export const MIN_AUTO_CONFIDENCE = 0.35;

type TaskAction = Extract<PolicyAction, { kind: 'task' }>;
const task = (t: TaskKind, priority: 1 | 2 | 3, reason: string): TaskAction => ({
  kind: 'task',
  task: t,
  priority,
  reason,
});

/** The task an intent becomes when a person has to handle it. */
export function taskFor(intent: Intent): TaskAction {
  switch (intent) {
    case 'viewing_invite':
    case 'viewing_slots':
      return task('viewing_choice', 1, 'The landlord invited you to a viewing. Choose a time.');
    case 'info_request':
      return task(
        'reply_needed',
        2,
        'The landlord asked something the agent cannot answer from your profile.',
      );
    case 'documents_request':
      return task('documents_approval', 2, 'The landlord asked for documents.');
    case 'application_form':
      return task('application_form', 2, 'The landlord sent an application form to fill in.');
    case 'offer':
    case 'contract':
      return task('offer_or_contract', 1, 'An offer or contract arrived. Read it before you answer.');
    case 'payment_request':
      return task(
        'payment_warning',
        1,
        'The landlord asks for a payment. Do not pay before a viewing and a signed contract.',
      );
    case 'scam_suspect':
      return task('scam_review', 2, 'This message looks like a scam. Nothing was sent.');
    case 'other':
      return task('reply_needed', 2, 'A reply needs your answer.');
    default:
      return task('reply_needed', 3, 'Check this message.');
  }
}

function defaultAction(intent: Intent, ctx: PolicyContext, explicitAuto: boolean): PolicyAction {
  const c = ctx.classification;
  switch (intent) {
    case 'viewing_invite':
    case 'viewing_slots': {
      if (!explicitAuto && !ctx.automation.autoAcceptViewings) return taskFor(intent);
      // Only a slot parsed without doubt may be booked (Review Focus 5).
      return c.slots.some((s) => s.certain) ? { kind: 'book_viewing' } : taskFor(intent);
    }
    case 'info_request':
      return c.questions.length > 0 ? { kind: 'auto_reply', purpose: 'answer' } : taskFor(intent);
    case 'documents_request':
      return { kind: 'auto_reply', purpose: 'send_documents' };
    case 'rejection':
      return { kind: 'close', status: 'rejected' };
    case 'listing_gone':
      return { kind: 'close', status: 'gone' };
    case 'alert':
      return { kind: 'ingest_alert' };
    case 'newsletter':
      return { kind: 'ignore' };
    default:
      return taskFor(intent);
  }
}

const isAutomatic = (a: PolicyAction) =>
  a.kind === 'auto_reply' || a.kind === 'book_viewing' || a.kind === 'close';

/**
 * Maps a classified inbound message to what the agent does. The model never
 * decides actions; this table does (spec, Agent pipeline step 11), with
 * `automation.policies` overriding per intent. Then the guards: a message
 * that matches no application always becomes a `reply_needed` task (Review
 * Focus 3), a likely scam gets no reply, and paused automation or a
 * low-confidence classification turns automatic actions into tasks.
 */
export function decidePolicy(intent: Intent, ctx: PolicyContext): PolicyAction {
  const configured = ctx.automation.policies[intent];
  if (configured === 'ignore') return { kind: 'ignore' };

  let action: PolicyAction;
  if (NEVER_AUTO.has(intent) || configured === 'task') action = taskFor(intent);
  else action = defaultAction(intent, ctx, configured === 'auto');

  if (!isAutomatic(action)) return action;
  if (!ctx.application)
    return task('reply_needed', 2, 'A reply arrived that matches none of your applications.');
  if (action.kind === 'close') {
    return ctx.classification.confidence < MIN_AUTO_CONFIDENCE
      ? task('reply_needed', 2, 'This looks like a rejection, but the agent is not sure.')
      : action;
  }
  if (ctx.application.status === 'withdrawn')
    return task('reply_needed', 3, 'A landlord wrote about an application you withdrew.');
  if (ctx.scam.level === 'likely')
    return task('scam_review', 2, 'This conversation shows scam signals, so the agent did not reply.');
  if (ctx.classification.confidence < MIN_AUTO_CONFIDENCE)
    return taskFor(intent === 'info_request' ? 'other' : intent);
  if (ctx.automation.paused) return taskFor(intent);
  return action;
}

/*
 * Words for the daemon's enums. One table per enum, so a status reads the same
 * on the board, in the table, in the drawer and in the feed.
 */
import type {
  ApplicationStatus,
  EventType,
  Intent,
  NlpfEvent,
  PropertyView,
  SourceHealth,
  TaskKind,
} from '@nlpf/core';

/** The six status colours from the design, plus the live dot. */
export type Tone = 'found' | 'contacted' | 'needs-you' | 'viewing' | 'closed' | 'error' | 'live';

export interface Status {
  label: string;
  tone: Tone;
  busy?: boolean;
}

export const APPLICATION_STATUS: Record<ApplicationStatus, Status> = {
  queued: { label: 'Sending', tone: 'contacted', busy: true },
  contacted: { label: 'Sent', tone: 'contacted' },
  replied: { label: 'Replied', tone: 'needs-you' },
  viewing_proposed: { label: 'Viewing proposed', tone: 'viewing' },
  viewing_booked: { label: 'Viewing', tone: 'viewing' },
  viewed: { label: 'Viewed', tone: 'viewing' },
  offer: { label: 'Offer', tone: 'needs-you' },
  rejected: { label: 'Rejected', tone: 'closed' },
  withdrawn: { label: 'Withdrawn', tone: 'closed' },
  gone: { label: 'Gone', tone: 'closed' },
  skipped: { label: 'Skipped', tone: 'closed' },
  manual: { label: 'React yourself', tone: 'needs-you' },
};

/** What a property is right now: its application when there is one, else its match. */
export function propertyStatus(view: Pick<PropertyView, 'application' | 'match'>): Status {
  if (view.application) return APPLICATION_STATUS[view.application.status] ?? { label: view.application.status, tone: 'closed' };
  const match = view.match;
  if (!match) return { label: 'Found', tone: 'found' };
  if (match.scam.level === 'likely') return { label: 'Scam', tone: 'error' };
  if (!match.passed) return { label: 'Skipped', tone: 'closed' };
  if (match.scam.level === 'possible') return { label: 'Check', tone: 'needs-you' };
  return { label: 'Matched', tone: 'found' };
}

export const SOURCE_HEALTH: Record<SourceHealth, Status> = {
  ok: { label: 'Working', tone: 'live' },
  degraded: { label: 'Degraded', tone: 'needs-you' },
  down: { label: 'Down', tone: 'error' },
  disabled: { label: 'Off', tone: 'closed' },
  needs_login: { label: 'Log in needed', tone: 'needs-you' },
  watch_only: { label: 'Watch only', tone: 'found' },
};

export const TASK_KIND: Record<TaskKind, string> = {
  viewing_booked: 'Viewing booked',
  viewing_choice: 'Pick a viewing time',
  reply_needed: 'Reply needed',
  documents_approval: 'Documents to approve',
  application_form: 'Application form',
  offer_or_contract: 'Offer or contract',
  payment_warning: 'Payment request',
  scam_review: 'Possible scam',
  react_manually: 'React yourself',
  approve_outreach: 'Approve first message',
  send_uncertain: 'Check if it was sent',
  reconnect: 'Log in again',
  captcha: 'Captcha',
  source_broken: 'Source not working',
  config_invalid: 'Config error',
  call_now: 'Call now',
  registration_renewal: 'Renew registration',
};

export const INTENT: Record<Intent, string> = {
  viewing_invite: 'Viewing invite',
  viewing_slots: 'Viewing times',
  info_request: 'Question',
  documents_request: 'Documents request',
  application_form: 'Application form',
  rejection: 'Rejection',
  listing_gone: 'Listing gone',
  offer: 'Offer',
  contract: 'Contract',
  payment_request: 'Payment request',
  scam_suspect: 'Scam suspect',
  alert: 'Alert email',
  newsletter: 'Newsletter',
  confirmation: 'Confirmation',
  other: 'Other',
};

/** Default policy per intent, from the spec. offer, contract and payment_request are always tasks. */
export const INTENT_DEFAULT: Record<Intent, 'auto' | 'task' | 'ignore'> = {
  viewing_invite: 'auto',
  viewing_slots: 'auto',
  info_request: 'auto',
  documents_request: 'auto',
  application_form: 'task',
  rejection: 'auto',
  listing_gone: 'auto',
  offer: 'task',
  contract: 'task',
  payment_request: 'task',
  scam_suspect: 'task',
  alert: 'auto',
  newsletter: 'ignore',
  confirmation: 'ignore',
  other: 'task',
};

export const LOCKED_INTENTS: Intent[] = ['offer', 'contract', 'payment_request'];

/** How each event shows in the live feed and the activity log. */
export function eventStatus(event: Pick<NlpfEvent, 'type' | 'data'>): Status {
  const t: EventType = event.type;
  switch (t) {
    case 'listing.new':
      return { label: 'Found', tone: 'found' };
    case 'listing.changed':
      return { label: 'Changed', tone: 'found' };
    case 'listing.gone':
      return { label: 'Gone', tone: 'closed' };
    case 'property.matched':
      return { label: 'Matched', tone: 'found' };
    case 'property.rejected':
      return { label: 'Skipped', tone: 'closed' };
    case 'property.scam':
      return { label: 'Scam', tone: 'error' };
    case 'application.updated':
      return { label: 'Updated', tone: 'closed' };
    case 'message.sent':
      return { label: 'Sent', tone: 'contacted' };
    case 'message.drafted':
      return { label: 'Drafted', tone: 'contacted' };
    case 'message.received':
      return { label: 'Reply', tone: 'needs-you' };
    case 'message.failed':
      return { label: 'Error', tone: 'error' };
    case 'followup.sent':
      return { label: 'Follow-up', tone: 'contacted' };
    case 'task.created':
      return { label: 'Needs you', tone: 'needs-you' };
    case 'task.updated':
      return { label: 'Done', tone: 'closed' };
    case 'viewing.booked':
      return { label: 'Viewing', tone: 'viewing' };
    case 'viewing.cancelled':
      return { label: 'Cancelled', tone: 'closed' };
    case 'source.polled':
      return { label: 'Checked', tone: 'closed' };
    case 'source.health': {
      const health = String(event.data?.health ?? '');
      return health === 'ok' ? { label: 'Recovered', tone: 'live' } : { label: 'Error', tone: 'error' };
    }
    case 'automation.paused':
      return { label: 'Paused', tone: 'closed' };
    case 'automation.resumed':
      return { label: 'Running', tone: 'live' };
    case 'config.updated':
      return { label: 'Config', tone: 'closed' };
    case 'mail.status':
      return event.data?.error ? { label: 'Error', tone: 'error' } : { label: 'Mail', tone: 'live' };
    case 'daemon.started':
      return { label: 'Started', tone: 'live' };
    case 'applications.withdrawn':
      return { label: 'Withdrawn', tone: 'closed' };
    case 'action.received':
      return { label: 'Phone', tone: 'contacted' };
    default:
      return { label: String(t), tone: 'closed' };
  }
}

export type FeedFilter = 'all' | 'found' | 'sent' | 'replies' | 'errors';

export const FEED_FILTERS: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'found', label: 'Found' },
  { id: 'sent', label: 'Sent' },
  { id: 'replies', label: 'Replies' },
  { id: 'errors', label: 'Errors' },
];

export function matchesFeedFilter(event: Pick<NlpfEvent, 'type' | 'data'>, filter: FeedFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'found') return event.type === 'listing.new' || event.type === 'property.matched';
  if (filter === 'sent') return event.type === 'message.sent' || event.type === 'followup.sent';
  if (filter === 'replies') return event.type === 'message.received';
  return eventStatus(event).tone === 'error';
}

/** Events too frequent to be worth a feed row. */
export function isQuietEvent(type: string): boolean {
  return type === 'source.polled' || type === 'task.updated' || type === 'config.updated';
}

const SOURCE_NAMES: Record<string, string> = {
  funda: 'Funda',
  kamernet: 'Kamernet',
  pararius: 'Pararius',
  huurwoningen: 'Huurwoningen',
  housinganywhere: 'HousingAnywhere',
  marktplaats: 'Marktplaats',
  vesteda: 'Vesteda',
  ssh: 'SSH',
  roommatch: 'RoomMatch',
  'woonnet-haaglanden': 'Woonnet Haaglanden',
  'woonnet-rijnmond': 'Woonnet Rijnmond',
  plaza: 'Plaza',
  'holland-rijnland': 'Holland Rijnland',
  kamernl: 'Kamer.nl',
  holland2stay: 'Holland2Stay',
  huisje: 'Huisje',
};

/** A readable name for a source id, for places that only have the id. */
export function sourceName(id: string | undefined, names?: Map<string, string>): string {
  if (!id) return '';
  const known = names?.get(id) ?? SOURCE_NAMES[id];
  if (known) return known;
  const bare = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  return bare
    .split(/[-_]/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export const CHANNEL: Record<string, string> = {
  form: 'Contact form',
  message: 'Platform message',
  email: 'Email',
  booking: 'Booking',
  platform: 'Platform message',
};

export const OCCUPATION: Record<string, string> = {
  student: 'Student',
  phd: 'PhD candidate',
  employed: 'Employed',
  self_employed: 'Self-employed',
  starting_job: 'Starting a job',
  other: 'Other',
};

export const PROPERTY_TYPE: Record<string, string> = {
  room: 'Room',
  studio: 'Studio',
  apartment: 'Apartment',
  house: 'House',
  other: 'Other',
};

export const FURNISHING: Record<string, string> = {
  unfurnished: 'Unfurnished',
  upholstered: 'Upholstered',
  furnished: 'Furnished',
  unknown: 'Not stated',
};

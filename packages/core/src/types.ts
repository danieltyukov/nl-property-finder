export type Iso = string;
export type PropertyType = 'room' | 'studio' | 'apartment' | 'house' | 'other';
export type Furnishing = 'unfurnished' | 'upholstered' | 'furnished' | 'unknown';
export type ChannelKind = 'form' | 'message' | 'email' | 'booking';
export type ContactMethod = ChannelKind | 'lottery' | 'none';
export type Lang = 'nl' | 'en';

export interface Address {
  street?: string; houseNumber?: string; addition?: string; postcode?: string;
  city?: string; municipality?: string; neighbourhood?: string; lat?: number; lon?: number;
}

export interface Agent { name?: string; url?: string; email?: string; phone?: string }

export interface RawListing {
  sourceId: string;
  externalId: string;
  url: string;
  title: string;
  priceEur?: number;
  priceBasis?: 'excl' | 'incl' | 'unknown';
  serviceCostsEur?: number;
  depositEur?: number;
  sizeM2?: number;
  rooms?: number;
  bedrooms?: number;
  type?: PropertyType;
  furnishing?: Furnishing;
  address: Address;
  availableFrom?: string;          // YYYY-MM-DD
  description?: string;
  images?: string[];
  energyLabel?: string;
  agent?: Agent;
  contact: ContactMethod;
  contactUrl?: string;
  publishedAt?: Iso;
  language?: Lang;
  extra?: Record<string, unknown>;
}

export interface Listing extends RawListing {
  id: string;                       // `${sourceId}:${externalId}`
  propertyId: string | null;
  firstSeenAt: Iso;
  lastSeenAt: Iso;
  state: 'active' | 'gone';
  via: 'poll' | 'alert' | 'manual';
}

export interface Property {
  id: string;
  key: string;                      // cluster key, see agent/cluster
  address: Address;
  title: string;
  priceEur?: number;
  sizeM2?: number;
  type?: PropertyType;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface Requirements {
  incomeMultiple?: number;
  minIncomeEur?: number;
  registrationAllowed?: boolean;
  studentsAllowed?: boolean;
  sharingAllowed?: boolean;
  contract?: 'indefinite' | 'temporary' | 'unknown';
  minMonths?: number;
  maxMonths?: number;
  petsAllowed?: boolean;
  smokingAllowed?: boolean;
  genderRestriction?: 'female' | 'male' | null;
  ageMin?: number;
  ageMax?: number;
  guarantorAccepted?: boolean;
  notes?: string[];
}

export interface ScamVerdict { level: 'none' | 'possible' | 'likely'; signals: string[] }

export interface Match {
  propertyId: string;
  passed: boolean;
  failedRule?: string;              // e.g. "price > 1400"
  score: number;                    // 0-100
  reasons: string[];
  requirements: Requirements;
  scam: ScamVerdict;
  summary?: string;                 // in the user's language, so Dutch listings read in English when wanted
  searchId?: string;                // which named search it matched
  rentCheck?: RentCheck;
  by: 'rules' | 'ai';
  evaluatedAt: Iso;
}

export interface RentCheck {
  points: number;
  maxRentEur: number;
  sector: 'social' | 'middle' | 'free';
  aboveMaxPct?: number;             // how far the asking rent is above the estimate
  inputs: { sizeM2?: number; energyLabel?: string; wozEur?: number; buildYear?: number };
  sources: ('bag' | 'woz' | 'ep-online' | 'listing')[];
  note: string;                     // always says it is an estimate
}

export type ApplicationStatus =
  | 'queued' | 'contacted' | 'replied' | 'viewing_proposed' | 'viewing_booked' | 'viewed'
  | 'offer' | 'rejected' | 'withdrawn' | 'gone' | 'skipped' | 'manual';

export interface Channel { kind: ChannelKind; sourceId?: string; listingId?: string; address?: string; url?: string }

export interface Application {
  id: string;
  propertyId: string;
  status: ApplicationStatus;
  channel?: Channel;
  firstSeenAt: Iso;
  contactedAt?: Iso;
  reactionMs?: number;              // contactedAt - earliest listing firstSeenAt
  updatedAt: Iso;
  note?: string;
}

export type Intent =
  | 'viewing_invite' | 'viewing_slots' | 'info_request' | 'documents_request' | 'application_form'
  | 'rejection' | 'listing_gone' | 'offer' | 'contract' | 'payment_request' | 'scam_suspect'
  | 'alert' | 'newsletter' | 'other';

export type Author = 'agent' | 'human' | 'landlord' | 'system';

export interface Attachment { filename: string; contentType?: string; size?: number; path?: string }

export interface Message {
  id: string;
  conversationId: string;
  direction: 'in' | 'out';
  author: Author;
  channel: ChannelKind | 'platform';
  subject?: string;
  body: string;
  at: Iso;
  externalId?: string;              // Message-ID or platform message id
  status: 'draft' | 'queued' | 'sent' | 'failed' | 'received';
  intent?: Intent;
  rationale?: string;
  attachments?: Attachment[];
}

export interface Conversation {
  id: string;
  applicationId: string | null;
  propertyId: string | null;
  counterpart: { name?: string; email?: string; sourceId?: string; threadId?: string };
  subject?: string;
  lastMessageAt: Iso;
  unread: number;
}

export type TaskKind =
  | 'viewing_booked' | 'viewing_choice' | 'reply_needed' | 'documents_approval' | 'application_form'
  | 'offer_or_contract' | 'payment_warning' | 'scam_review' | 'react_manually' | 'approve_outreach'
  | 'send_uncertain' | 'reconnect' | 'captcha' | 'source_broken' | 'config_invalid'
  | 'call_now' | 'registration_renewal';

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  reason: string;
  priority: 1 | 2 | 3;              // 1 = most urgent
  propertyId?: string;
  applicationId?: string;
  conversationId?: string;
  sourceId?: string;
  dueAt?: Iso;
  state: 'open' | 'snoozed' | 'done' | 'dismissed';
  snoozedUntil?: Iso;
  payload?: Record<string, unknown>;
  createdAt: Iso;
  updatedAt: Iso;
  resolvedBy?: 'human' | 'agent';
}

export interface Viewing {
  id: string;
  applicationId: string;
  propertyId: string;
  startsAt: Iso;
  endsAt: Iso;
  location?: string;
  state: 'proposed' | 'booked' | 'cancelled' | 'done';
  bookedBy: 'agent' | 'human';
  note?: string;
}

export type SourceHealth = 'ok' | 'degraded' | 'down' | 'disabled' | 'needs_login' | 'watch_only';

export interface SourceState {
  sourceId: string;
  name: string;
  enabled: boolean;
  health: SourceHealth;
  lastRunAt?: Iso;
  lastOkAt?: Iso;
  lastError?: string;
  consecutiveFailures: number;
  consecutiveEmpty: number;
  lastLatencyMs?: number;
  lastCount?: number;
  nextRunAt?: Iso;
}

export type EventType =
  | 'listing.new' | 'listing.changed' | 'listing.gone'
  | 'property.matched' | 'property.rejected' | 'property.scam'
  | 'application.updated'
  | 'message.sent' | 'message.received' | 'message.failed' | 'message.drafted'
  | 'task.created' | 'task.updated'
  | 'viewing.booked' | 'viewing.cancelled'
  | 'source.polled' | 'source.health'
  | 'automation.paused' | 'automation.resumed'
  | 'config.updated' | 'mail.status' | 'daemon.started'
  | 'applications.withdrawn' | 'followup.sent' | 'action.received';

export interface NlpfEvent { id: number; type: EventType; at: Iso; summary: string; data: Record<string, unknown> }

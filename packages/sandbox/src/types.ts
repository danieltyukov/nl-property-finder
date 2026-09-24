import type { Furnishing, InboundMessage, Lang, Logger, PropertyType } from '@nlpf/core';

/** The two fake sources the sandbox serves on one port. */
export type SourceName = 'huisje' | 'gracht';
export const SOURCE_NAMES: readonly SourceName[] = ['huisje', 'gracht'];

/** What a landlord can answer. Each kind has Dutch and English texts in `data/replies.json`. */
export const REPLY_KINDS = [
  'viewing_slots',
  'info_request',
  'documents_request',
  'rejection',
  'payment_request',
  'offer',
  'listing_gone',
] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

/** Listings built for one test or demo scene. */
export type Scenario = 'scam' | 'no_students' | 'no_registration';

export interface Landlord {
  name: string;
  email: string;
  /** A private owner on Huisje, or an estate agent (every De Gracht listing). */
  kind: 'particulier' | 'makelaar';
}

export type ListingStatus = 'available' | 'option' | 'rented';

export interface SandboxListing {
  /** "hj-1001" on Huisje, "dg-2001" on De Gracht. */
  id: string;
  /** Catalogue key from `data/listings.json`, or "gen-<n>" for generated listings. */
  key: string;
  source: SourceName;
  title: string;
  /** Street and number the way this source writes them, such as "Tulpgracht 12-A" or "Tulpgracht 12 a". */
  addressText: string;
  street: string;
  houseNumber: string;
  addition?: string;
  postcode: string;
  city: string;
  lat: number;
  lon: number;
  priceEur: number;
  priceBasis: 'excl' | 'incl';
  serviceCostsEur?: number;
  depositEur?: number;
  sizeM2: number;
  rooms: number;
  bedrooms: number;
  type: PropertyType;
  furnishing: Exclude<Furnishing, 'unknown'>;
  energyLabel?: string;
  /** YYYY-MM-DD. */
  availableFrom: string;
  publishedAt: string;
  language: Lang;
  description: string;
  landlord: Landlord;
  status: ListingStatus;
  /** Taken offline: search leaves it out and its pages answer 404. */
  removed: boolean;
  scenarios: Scenario[];
  /** Automatic landlord replies: the first answers the first contact, the next answers the agent's next message. */
  script: ReplyKind[];
  /** Id of the listing this one copies from the other source (the same home, written differently). */
  duplicateOf?: string;
}

/** What `control.addListing` accepts. Everything is optional; missing fields get realistic defaults. */
export interface ListingInput {
  /** Copy a catalogue entry from `data/listings.json` by key. */
  key?: string;
  /** Publish the same home on the other source, with the address written differently. */
  duplicateOf?: string;
  scenario?: Scenario;
  source?: SourceName;
  id?: string;
  title?: string;
  addressText?: string;
  street?: string;
  houseNumber?: string;
  addition?: string;
  postcode?: string;
  city?: string;
  lat?: number;
  lon?: number;
  priceEur?: number;
  priceBasis?: 'excl' | 'incl';
  serviceCostsEur?: number;
  depositEur?: number;
  sizeM2?: number;
  rooms?: number;
  bedrooms?: number;
  type?: PropertyType;
  furnishing?: Exclude<Furnishing, 'unknown'>;
  energyLabel?: string;
  availableFrom?: string;
  publishedAt?: string;
  language?: Lang;
  description?: string;
  landlord?: Landlord;
  status?: ListingStatus;
  script?: ReplyKind[];
}

export interface SandboxAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** Where the sandbox keeps the file. */
  path: string;
}

export interface ViewingSlot {
  start: string;
  end?: string;
  /** The words used in the message, such as "donderdag 1 oktober om 18:30". */
  text: string;
}

export interface ThreadMessage {
  /** "m-1", unique in the sandbox. */
  id: string;
  submissionId: string;
  from: 'landlord' | 'agent';
  /** How it travelled: the first contact form, a Huisje platform message, or an email. */
  channel: 'form' | 'platform' | 'email';
  /** Landlord messages only. */
  kind?: ReplyKind;
  /** RFC Message-ID, for email. */
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
  text: string;
  at: string;
  attachments: SandboxAttachment[];
  /** The times offered in a viewing_slots message. */
  slots?: ViewingSlot[];
  /** Why a landlord email did not reach the agent (SMTP failure, or the agent's handler threw). */
  deliveryError?: string;
}

/** One application from the agent: the first contact and every message after it. */
export interface Submission {
  /** "sub-1". */
  id: string;
  source: SourceName;
  /** Null when an email could not be tied to a listing. */
  listingId: string | null;
  /** How the agent made first contact. */
  channel: 'form' | 'email';
  /** Where the landlord answers: the Huisje platform thread or email. */
  replyChannel: 'platform' | 'email';
  /** Huisje thread id ("th-1"); every submission has one so the ids line up. */
  threadId: string;
  name: string;
  email: string;
  phone?: string;
  message: string;
  at: string;
  landlord: Landlord;
  messages: ThreadMessage[];
  /** How many messages the agent has sent in this conversation, the first contact included. */
  agentTurns: number;
  /** A viewing booked on the De Gracht booking page. */
  booking?: { slot: ViewingSlot; at: string };
  /** Set when the agent answered offered viewing times with a confirmation, by email or in the Huisje thread. */
  viewingConfirmed?: { at: string; messageId: string; slot?: ViewingSlot };
}

/** An email the agent sent to a landlord, in the shape the memory mailbox records. */
export interface AgentEmail {
  to: string;
  subject: string;
  text: string;
  messageId?: string;
  from?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; path?: string; contentType?: string; content?: string }[];
  at?: string;
}

/** An agent email as the sandbox recorded it. */
export interface ReceivedEmail extends AgentEmail {
  receivedAt: string;
  /** The submission it continued or started; null when it matched no landlord or listing. */
  submissionId: string | null;
  /** True when it confirmed offered viewing times. */
  viewingConfirmation: boolean;
}

/**
 * Where landlord email goes.
 *
 * In-process (demo mode, unit tests): `deliver` hands each landlord email to
 * the agent's mailbox, `address` is the agent's own address (the `To` of
 * landlord email), and `onSend` subscribes to every email the agent sends, so
 * landlords see confirmations, documents and withdrawals. With the memory
 * mailbox from `@nlpf/mail`:
 * `{ deliver: (m) => box.deliver(m), onSend: (fn) => box.onSend(fn), address: box.address }`.
 *
 * SMTP (GreenMail integration tests): landlord email is sent to `to` through
 * the SMTP server; `from` is the envelope sender. The agent's email then goes
 * to GreenMail users the test reads itself, or to `control.receiveMail`.
 */
export type MailTarget =
  | {
      deliver(m: InboundMessage): Promise<void>;
      onSend?(listener: (m: AgentEmail) => void | Promise<void>): () => void;
      address?: string;
    }
  | { smtp: { host: string; port: number }; from: string; to: string };

export interface SandboxOptions {
  /** 0 or omitted picks a free port. The server binds 127.0.0.1 only. */
  port?: number;
  /** Seed for everything random: generated listings, reply wording, reply delays. Default 1. */
  seed?: number;
  /** Landlords answer this many times faster than a person would. Default 1; demo mode uses 10, e2e 20. */
  speed?: number;
  /** Where landlord emails go: an in-process mailbox, or SMTP (GreenMail in tests). */
  mail: MailTarget;
  /**
   * Listings online at start: the whole catalogue (default), none, or a list
   * such as `demoSeed()`. Catalogue entries that are not online at start can
   * appear later through `drip` or `control.addListing({ key })`.
   */
  listings?: 'catalogue' | 'none' | ListingInput[];
  /** Publish the remaining catalogue entries one by one, one every `everySec / speed` seconds (default 90). */
  drip?: boolean | { everySec?: number };
  /** Landlords answer every submission on their own (default true). `control.landlordReply` works either way. */
  autoReply?: boolean;
  /** Where Huisje landlords answer: in the platform thread (default) or by email. */
  huisjeReplies?: 'platform' | 'email';
  /** Folder for attachments the landlords send and receive. Default: a temporary folder removed on stop. */
  dataDir?: string;
  now?: () => Date;
  log?: Logger;
}

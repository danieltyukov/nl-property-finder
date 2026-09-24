import { existsSync, readFileSync } from 'node:fs';
import { amsterdam, type Logger } from '@nlpf/core';
import { Landlords } from './landlord.js';
import { AttachmentStore, MailHub } from './mailhub.js';
import type {
  AgentEmail,
  Landlord,
  ReceivedEmail,
  SandboxAttachment,
  SandboxListing,
  SandboxOptions,
  SourceName,
  Submission,
  ThreadMessage,
  ViewingSlot,
} from './types.js';
import { CATALOGUE, GRACHT_EMAIL, heldCatalogue, World } from './world.js';

export interface CoreState {
  blocked: Record<SourceName, { on: boolean; retryAfterSec?: number }>;
  loginRequired: boolean;
  autoReply: boolean;
  /** Huisje sessions: cookie token to e-mail address. */
  sessions: Map<string, string>;
  /** Every email the agent sent that reached the sandbox, oldest first. */
  emails: ReceivedEmail[];
}

export interface NewSubmission {
  source: SourceName;
  listing?: SandboxListing;
  channel: 'form' | 'email';
  name: string;
  email: string;
  phone?: string;
  subject?: string;
  message: string;
  messageId?: string;
  attachments?: SandboxAttachment[];
  landlord?: Landlord;
}

const AGENCY: Landlord = { name: 'Eva Brouwer', email: GRACHT_EMAIL, kind: 'makelaar' };

/** The name under "Met vriendelijke groet" or "Kind regards" in an email, when there is one. */
export function signatureName(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (
      /^(met vriendelijke groet(en)?|vriendelijke groet(en)?|groet(en)?|kind regards|best regards|regards|best|thanks)[,.!]?$/i.test(
        lines[i]!,
      )
    ) {
      const name = lines.slice(i + 1).find(Boolean);
      if (name && /^[\p{Lu}][\p{L}'-]+(\s+[\p{L}'-]+){0,3}$/u.test(name)) return name;
    }
  }
  return '';
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** True when the text names the listing's street and house number (any spelling), its id, or its page. */
export function mentionsListing(text: string, l: SandboxListing): boolean {
  const t = fold(text);
  if (t.includes(l.id)) return true;
  const street = fold(l.street)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`${street}\\s*${l.houseNumber}(?!\\d)`).test(t);
}

/**
 * Everything the HTTP handlers, the landlords and `Control` share: the
 * world, the mail hub, the attachment folder and the switches.
 */
export class SandboxCore {
  url = '';
  readonly seed: number;
  readonly speed: number;
  readonly now: () => Date;
  readonly log: Logger;
  readonly world: World;
  readonly mail: MailHub;
  readonly files: AttachmentStore;
  readonly landlords: Landlords;
  readonly state: CoreState;
  private dripTimer?: ReturnType<typeof setInterval>;

  constructor(
    readonly opts: SandboxOptions,
    dataDir: string,
    log: Logger,
  ) {
    this.seed = opts.seed ?? 1;
    this.speed = opts.speed ?? 1;
    this.now = opts.now ?? (() => new Date());
    this.log = log;
    this.world = new World({ seed: this.seed, now: this.now });
    this.mail = new MailHub(opts.mail, this.seed, log);
    this.files = new AttachmentStore(dataDir);
    this.landlords = new Landlords(this);
    this.state = {
      blocked: { huisje: { on: false }, gracht: { on: false } },
      loginRequired: false,
      autoReply: opts.autoReply ?? true,
      sessions: new Map(),
      emails: [],
    };
    this.populate();
  }

  /** Puts the starting listings online. */
  populate(): void {
    const initial = this.opts.listings ?? 'catalogue';
    if (initial === 'catalogue') for (const e of CATALOGUE) this.world.add({ key: e.key });
    else if (Array.isArray(initial)) for (const input of initial) this.world.add(input);
  }

  /** Back to the starting listings, with no submissions, blocks or login wall. Ids keep counting. */
  reset(): void {
    this.landlords.cancelAll();
    this.world.clear();
    this.state.blocked = { huisje: { on: false }, gracht: { on: false } };
    this.state.loginRequired = false;
    this.state.autoReply = this.opts.autoReply ?? true;
    this.state.sessions.clear();
    this.state.emails = [];
    this.populate();
    this.setDrip(Boolean(this.opts.drip));
  }

  /** Publishes the next catalogue listing that is not online yet, if any. */
  dripOne(): SandboxListing | undefined {
    const next = heldCatalogue(this.world)[0];
    return next ? this.world.add({ key: next.key }) : undefined;
  }

  get dripping(): boolean {
    return this.dripTimer !== undefined;
  }

  setDrip(enabled: boolean): void {
    if (this.dripTimer) clearInterval(this.dripTimer);
    this.dripTimer = undefined;
    if (!enabled) return;
    const everySec = typeof this.opts.drip === 'object' ? (this.opts.drip.everySec ?? 90) : 90;
    this.dripTimer = setInterval(
      () => {
        const added = this.dripOne();
        if (added) this.log.info('sandbox listing published', { id: added.id, key: added.key });
        else this.setDrip(false);
      },
      Math.max(50, (everySec * 1000) / this.speed),
    );
  }

  stop(): void {
    this.setDrip(false);
    this.landlords.cancelAll();
    this.mail.close();
  }

  /** Records a first contact and lets the landlord's script answer it. */
  submit(input: NewSubmission): Submission {
    const n = this.world.next('submission');
    const at = this.now().toISOString();
    const replyChannel =
      input.source === 'huisje' && input.channel === 'form'
        ? (this.opts.huisjeReplies ?? 'platform')
        : 'email';
    const sub: Submission = {
      id: `sub-${n}`,
      source: input.source,
      listingId: input.listing?.id ?? null,
      channel: input.channel,
      replyChannel,
      threadId: `th-${n}`,
      name: input.name,
      email: input.email,
      message: input.message,
      at,
      landlord: input.landlord ?? input.listing?.landlord ?? AGENCY,
      messages: [],
      agentTurns: 0,
    };
    if (input.phone) sub.phone = input.phone;
    this.world.addSubmission(sub);
    this.agentMessage(sub, {
      channel: input.channel,
      subject: input.subject ?? '',
      text: input.message,
      messageId: input.messageId,
      attachments: input.attachments ?? [],
    });
    this.log.info('sandbox submission', {
      id: sub.id,
      source: sub.source,
      listing: sub.listingId,
      channel: sub.channel,
    });
    return sub;
  }

  /** Records a message from the agent in a conversation and schedules the landlord's next scripted answer. */
  agentMessage(
    sub: Submission,
    m: {
      channel: ThreadMessage['channel'];
      subject: string;
      text: string;
      messageId?: string;
      inReplyTo?: string;
      references?: string[];
      attachments: SandboxAttachment[];
    },
  ): ThreadMessage {
    const msg: ThreadMessage = {
      id: `m-${this.world.next('message')}`,
      submissionId: sub.id,
      from: 'agent',
      channel: m.channel,
      subject: m.subject,
      text: m.text,
      at: this.now().toISOString(),
      attachments: m.attachments,
    };
    if (m.messageId) msg.messageId = m.messageId;
    if (m.inReplyTo) msg.inReplyTo = m.inReplyTo;
    if (m.references?.length) msg.references = m.references;
    const offered = [...sub.messages].reverse().find((x) => x.from === 'landlord' && x.slots?.length);
    const confirmed =
      offered && !sub.viewingConfirmed ? viewingConfirmation(m.text, offered.slots ?? []) : undefined;
    if (confirmed) {
      sub.viewingConfirmed = { at: msg.at, messageId: msg.id };
      if (confirmed.slot) sub.viewingConfirmed.slot = confirmed.slot;
    }
    sub.messages.push(msg);
    sub.agentTurns += 1;
    this.landlords.afterAgentTurn(sub);
    return msg;
  }

  /**
   * An email from the agent to a landlord. A reply (In-Reply-To or
   * References naming a message in a conversation) continues that
   * conversation; a new email to a landlord's address about one of their
   * listings starts a submission. Every email is kept in `state.emails`,
   * matched or not.
   */
  receiveMail(mail: AgentEmail): Submission | undefined {
    const attachments = (mail.attachments ?? []).map((a) => this.agentAttachment(a));
    const record = (sub: Submission | undefined): Submission | undefined => {
      const last = sub?.messages.at(-1);
      this.state.emails.push({
        ...mail,
        receivedAt: this.now().toISOString(),
        submissionId: sub?.id ?? null,
        viewingConfirmation: Boolean(
          sub?.viewingConfirmed && last && sub.viewingConfirmed.messageId === last.id,
        ),
      });
      return sub;
    };
    const refs = [mail.inReplyTo, ...(mail.references ?? [])]
      .filter((r): r is string => Boolean(r))
      .map(normId);
    if (refs.length) {
      const sub = this.world
        .submissions()
        .find((s) => s.messages.some((m) => m.messageId && refs.includes(normId(m.messageId))));
      if (sub) {
        this.agentMessage(sub, {
          channel: 'email',
          subject: mail.subject,
          text: mail.text,
          messageId: mail.messageId,
          inReplyTo: mail.inReplyTo,
          references: mail.references,
          attachments,
        });
        return record(sub);
      }
    }
    const to = mail.to.trim().toLowerCase();
    const candidates = this.world
      .listings({ includeRemoved: true })
      .filter((l) => l.landlord.email.toLowerCase() === to);
    const text = `${mail.subject}\n${mail.text}`;
    const mentioned = candidates.filter((l) => mentionsListing(text, l));
    const listing = mentioned[0] ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!listing) {
      this.log.info('sandbox email matched no listing', { to });
      return record(undefined);
    }
    return record(
      this.submit({
        source: listing.source,
        listing,
        channel: 'email',
        name: signatureName(mail.text),
        email: mail.from ?? '',
        subject: mail.subject,
        message: mail.text,
        messageId: mail.messageId,
        attachments,
      }),
    );
  }

  /** A copy of a file the agent attached, so it stays readable after the agent cleans up. */
  private agentAttachment(a: NonNullable<AgentEmail['attachments']>[number]): SandboxAttachment {
    const contentType = a.contentType ?? 'application/octet-stream';
    if (a.content !== undefined)
      return this.files.save(a.filename, contentType, Buffer.from(a.content, 'base64'));
    if (a.path && existsSync(a.path)) return this.files.save(a.filename, contentType, readFileSync(a.path));
    return this.files.save(a.filename, contentType, Buffer.alloc(0));
  }
}

/** Message-IDs compare without angle brackets and case of the domain. */
function normId(id: string): string {
  return id.trim().replace(/^<|>$/g, '').toLowerCase();
}

const DECLINE =
  /\b(helaas|unfortunately|kan ik niet|kan niet|lukt (?:mij |me )?niet|niet mogelijk|cannot|can't|can not|unable)\b/i;
const CONFIRM =
  /\b(bevestig\w*|confirm\w*|kom graag|graag langs|tot dan|see you|look forward|kijk ernaar uit|ik kom|i will come|i'll be there|past (?:mij|me) goed|works for me|suits me)\b/i;
const MONTHS_NL = [
  'januari',
  'februari',
  'maart',
  'april',
  'mei',
  'juni',
  'juli',
  'augustus',
  'september',
  'oktober',
  'november',
  'december',
];
const MONTHS_EN = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * Whether an agent message accepts one of the offered viewing times. A
 * message that names an offered day and a time inside that slot counts, and
 * so does a plain confirmation ("Graag bevestig ik de bezichtiging"). A
 * refusal never counts.
 */
export function viewingConfirmation(text: string, slots: ViewingSlot[]): { slot?: ViewingSlot } | undefined {
  if (!slots.length || DECLINE.test(text)) return undefined;
  const t = text.toLowerCase();
  const times = [...t.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g)].map(
    (m) => Number(m[1]) * 60 + Number(m[2]),
  );
  const minutes = (iso: string) => {
    const p = amsterdam(new Date(iso));
    return p.hh * 60 + p.mm;
  };
  for (const slot of slots) {
    const p = amsterdam(new Date(slot.start));
    const named = t.includes(`${p.d} ${MONTHS_NL[p.m - 1]}`) || t.includes(`${p.d} ${MONTHS_EN[p.m - 1]}`);
    if (!named) continue;
    const from = minutes(slot.start);
    const to = slot.end ? minutes(slot.end) : from;
    if (times.some((x) => x >= from && x <= to)) return { slot };
  }
  return CONFIRM.test(text) ? {} : undefined;
}

import type { Lang } from '@nlpf/core';
import repliesFile from '../data/replies.json' with { type: 'json' };
import { longDate, viewingSlots } from './dates.js';
import { makePdf, type PdfLine } from './pdf.js';
import { rngFor, type Rng } from './rng.js';
import type { SandboxCore } from './core.js';
import type {
  ReplyKind,
  SandboxAttachment,
  SandboxListing,
  Submission,
  ThreadMessage,
  ViewingSlot,
} from './types.js';
import { euros } from './world.js';

interface RepliesFile {
  fallbackName: Record<Lang, string>;
  bookingLine: Record<Lang, string>;
  subjects: Record<ReplyKind, Record<Lang, string>>;
  texts: Record<ReplyKind, Record<Lang, string[]>>;
}

/** The landlord texts from `data/replies.json`. */
export const REPLIES = repliesFile as RepliesFile;

/** Seconds a person takes to answer at speed 1; the sandbox divides by `speed` and adds up to 25% either way. */
export const REPLY_DELAY_SEC: Record<ReplyKind, number> = {
  payment_request: 30,
  listing_gone: 20,
  info_request: 40,
  viewing_slots: 45,
  documents_request: 60,
  rejection: 90,
  offer: 120,
};

export function replyDelayMs(kind: ReplyKind, speed: number, rng: Rng): number {
  const jitter = 0.75 + 0.5 * rng.next();
  return Math.max(20, Math.round((REPLY_DELAY_SEC[kind] * 1000 * jitter) / Math.max(speed, 0.001)));
}

/** A fake account number that is clearly not a real IBAN. */
export const SANDBOX_IBAN = 'NL00 SBOX 0000 0000 00';

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, name: string) => vars[name] ?? all);
}

/** The first name the applicant gave, or nothing. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

export interface ComposedReply {
  subject: string;
  text: string;
  slots?: ViewingSlot[];
  variant: number;
}

export interface ComposeContext {
  kind: ReplyKind;
  lang: Lang;
  listing?: SandboxListing;
  applicantName: string;
  landlordName: string;
  agency: boolean;
  bookingUrl?: string;
  now: Date;
  rng: Rng;
}

/** Fills one of the templates for `kind` in `lang`, chosen by the seeded stream. */
export function composeReply(c: ComposeContext): ComposedReply {
  const texts = REPLIES.texts[c.kind][c.lang];
  const variant = c.rng.int(0, texts.length - 1);
  const set = viewingSlots(c.now, c.rng);
  const l = c.listing;
  const vars: Record<string, string> = {
    name: firstName(c.applicantName) || REPLIES.fallbackName[c.lang],
    address: l?.addressText ?? (c.lang === 'nl' ? 'de woning' : 'the home'),
    city: l?.city ?? '',
    price: l ? euros(l.priceEur, c.lang) : '',
    deposit: l ? euros(l.depositEur ?? l.priceEur, c.lang) : '',
    available: l ? longDate(l.availableFrom, c.lang) : '',
    iban: SANDBOX_IBAN,
    signature: c.agency ? `${c.landlordName}\nMakelaardij De Gracht` : c.landlordName,
    bookingLine:
      c.kind === 'viewing_slots' && c.bookingUrl
        ? fill(REPLIES.bookingLine[c.lang], { bookingUrl: c.bookingUrl })
        : '',
    ...set.words[c.lang],
  };
  const out: ComposedReply = {
    subject: fill(REPLIES.subjects[c.kind][c.lang], vars),
    text: fill(texts[variant]!, vars),
    variant,
  };
  if (c.kind === 'viewing_slots') out.slots = set.slots;
  return out;
}

/** The draft contract a landlord attaches to an offer. It asks for a deposit of three months, above the legal maximum of two. */
export function contractPdf(
  l: SandboxListing | undefined,
  landlordName: string,
  tenantName: string,
  agency: boolean,
): Buffer {
  const price = l?.priceEur ?? 1000;
  const address = l ? `${l.addressText}, ${l.postcode} ${l.city}` : 'de woning';
  const start = l ? longDate(l.availableFrom, 'nl') : 'de ingangsdatum';
  const lines: PdfLine[] = [
    { text: 'CONCEPT HUUROVEREENKOMST WOONRUIMTE', bold: true, size: 14 },
    { text: agency ? 'Makelaardij De Gracht, namens de eigenaar' : 'Particuliere verhuur', gap: 4 },
    { text: 'De ondergetekenden', bold: true, size: 11, gap: 14 },
    { text: `Verhuurder: ${landlordName}, hierna te noemen verhuurder.` },
    { text: `Huurder: ${tenantName || 'de huurder'}, hierna te noemen huurder.` },
    { text: 'Artikel 1. Het gehuurde', bold: true, size: 11, gap: 12 },
    { text: `Verhuurder verhuurt aan huurder de woonruimte aan ${address}.` },
    { text: 'Artikel 2. Duur', bold: true, size: 11, gap: 12 },
    { text: `Deze overeenkomst gaat in op ${start} en is aangegaan voor onbepaalde tijd.` },
    { text: 'Artikel 3. Huurprijs', bold: true, size: 11, gap: 12 },
    { text: `De kale huur bedraagt ${euros(price, 'nl')} per maand.` },
    ...(l?.serviceCostsEur
      ? [{ text: `De servicekosten bedragen ${euros(l.serviceCostsEur, 'nl')} per maand.` }]
      : []),
    { text: 'De huur wordt voor de eerste van iedere maand voldaan.' },
    { text: 'Artikel 4. Waarborgsom', bold: true, size: 11, gap: 12 },
    { text: 'De huurder betaalt bij ondertekening een waarborgsom van 3 maanden kale huur.' },
    {
      text: `Dat is ${euros(price * 3, 'nl')}. De waarborgsom wordt binnen twee maanden na het einde van de huur terugbetaald.`,
    },
    { text: 'Artikel 5. Gebruik', bold: true, size: 11, gap: 12 },
    {
      text: 'Huurder gebruikt het gehuurde uitsluitend als woonruimte en onderhoudt het als een goed huurder.',
    },
    { text: 'Opgemaakt in tweevoud.', gap: 14 },
    {
      text: 'Dit concept komt uit de sandbox van nl-property-finder. De partijen en de woning zijn verzonnen.',
      size: 8,
      gap: 20,
    },
  ];
  return makePdf(`Concept huurovereenkomst ${l?.addressText ?? ''}`.trim(), lines);
}

const stripRe = (s: string) => s.replace(/^\s*((re|aw|antw|fw|fwd)\s*:\s*)+/i, '').trim();

/**
 * The landlords: each submission gets the listing's scripted replies, one
 * after each message the agent sends, after a delay scaled by `speed`.
 * `reply` sends one reply of any kind right away.
 */
export class Landlords {
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly core: SandboxCore) {}

  /** Schedules the scripted answer to the agent's latest message, if the script has one. */
  afterAgentTurn(sub: Submission): void {
    if (!this.core.state.autoReply || !sub.listingId) return;
    const listing = this.core.world.listing(sub.listingId);
    if (!listing) return;
    const gone = listing.removed || listing.status !== 'available';
    let kind = listing.script[sub.agentTurns - 1];
    // A first message about a home that is no longer for rent gets a short "already rented".
    if (sub.agentTurns === 1 && gone) kind = 'listing_gone';
    if (!kind) return;
    const delay = replyDelayMs(
      kind,
      this.core.speed,
      rngFor(this.core.seed, `delay:${sub.id}:${sub.agentTurns}`),
    );
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.reply(sub.id, kind, { scripted: true }).catch((e: unknown) =>
        this.core.log.warn('landlord reply failed', {
          submission: sub.id,
          kind,
          error: (e as Error).message,
        }),
      );
    }, delay);
    this.timers.add(timer);
  }

  cancelAll(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  pending(): number {
    return this.timers.size;
  }

  /**
   * Sends a reply of `kind` now and returns it. A scripted friendly reply
   * about a home that went offline in the meantime becomes "already rented";
   * a reply asked for through `control.landlordReply` is always sent as asked.
   */
  async reply(
    submissionId: string,
    requested: ReplyKind,
    opts: { scripted?: boolean } = {},
  ): Promise<ThreadMessage> {
    const core = this.core;
    const sub = core.world.submission(submissionId);
    if (!sub) throw new Error(`no submission ${submissionId}`);
    const listing = sub.listingId ? core.world.listing(sub.listingId) : undefined;
    let kind = requested;
    const friendly: ReplyKind[] = ['viewing_slots', 'info_request', 'documents_request'];
    if (
      opts.scripted &&
      listing &&
      (listing.removed || listing.status !== 'available') &&
      friendly.includes(kind)
    )
      kind = 'listing_gone';
    const lang: Lang = listing?.language ?? 'nl';
    const agency = sub.landlord.kind === 'makelaar';
    const n = sub.messages.filter((m) => m.from === 'landlord').length;
    const composed = composeReply({
      kind,
      lang,
      listing,
      applicantName: sub.name,
      landlordName: sub.landlord.name,
      agency,
      bookingUrl: sub.source === 'gracht' ? `${core.url}/gracht/bezichtiging/${sub.id}` : undefined,
      now: core.now(),
      rng: rngFor(core.seed, `reply:${sub.id}:${n}`),
    });
    const attachments: SandboxAttachment[] = [];
    if (kind === 'offer') {
      const pdf = contractPdf(listing, sub.landlord.name, sub.name, agency);
      attachments.push(core.files.save('concept-huurovereenkomst.pdf', 'application/pdf', pdf));
    }
    const at = core.now().toISOString();
    const msg: ThreadMessage = {
      id: `m-${core.world.next('message')}`,
      submissionId: sub.id,
      from: 'landlord',
      channel: sub.replyChannel,
      kind,
      subject: composed.subject,
      text: composed.text,
      at,
      attachments,
    };
    if (composed.slots) msg.slots = composed.slots;

    if (sub.replyChannel === 'email') {
      const emails = sub.messages.filter((m) => m.messageId);
      const last = emails.at(-1);
      // "Re: <the thread's subject>", or "Re: <listing title>" when the agent came in through a form.
      const lastSubject = [...sub.messages]
        .reverse()
        .find((m) => m.channel === 'email' && m.subject)?.subject;
      msg.subject = `Re: ${stripRe(lastSubject ?? listing?.title ?? composed.subject)}`;
      const references = emails.map((m) => m.messageId!);
      msg.messageId = core.mail.newMessageId(sub.landlord.email);
      if (last?.messageId) msg.inReplyTo = last.messageId;
      if (references.length) msg.references = references;
      // Record the message before delivering it: an in-process agent may answer it before deliver returns.
      sub.messages.push(msg);
      try {
        await core.mail.send({
          messageId: msg.messageId,
          from: {
            name: agency ? `${sub.landlord.name} | Makelaardij De Gracht` : sub.landlord.name,
            address: sub.landlord.email,
          },
          to: core.mail.recipient(sub.email),
          subject: msg.subject,
          text: msg.text,
          inReplyTo: last?.messageId,
          references,
          attachments,
          at,
        });
      } catch (e) {
        // The landlord did write it; an agent that failed to handle it is the agent's problem.
        msg.deliveryError = (e as Error).message;
        core.log.warn('landlord email not delivered', { submission: sub.id, kind, error: msg.deliveryError });
      }
    } else {
      sub.messages.push(msg);
    }
    core.log.info('landlord replied', { submission: sub.id, kind, channel: msg.channel });
    return msg;
  }
}

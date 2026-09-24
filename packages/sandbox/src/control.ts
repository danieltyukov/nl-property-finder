import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { SandboxCore } from './core.js';
import {
  REPLY_KINDS,
  SOURCE_NAMES,
  type AgentEmail,
  type ListingInput,
  type ReceivedEmail,
  type ReplyKind,
  type SandboxListing,
  type SourceName,
  type Submission,
  type ThreadMessage,
} from './types.js';

export interface SandboxState {
  blocked: Record<SourceName, boolean>;
  loginRequired: boolean;
  autoReply: boolean;
  drip: boolean;
  /** Landlord replies waiting on their timer. */
  pendingReplies: number;
}

/**
 * Drives the fake Netherlands from a test or the demo. Everything here is
 * also available over HTTP under `/_control` (see `controlRoutes`). Reads
 * return copies, so changing them changes nothing in the sandbox.
 */
export interface Control {
  /** Puts a listing online: a catalogue entry (`{ key }`), a copy on the other source (`{ duplicateOf }`), or a new one with realistic defaults (a Delft apartment on Huisje that fits a 1400 budget). */
  addListing(input?: ListingInput): SandboxListing;
  /** Takes a listing offline (its pages answer 404), or with `'rented'` marks it rented. */
  removeListing(id: string, how?: 'removed' | 'rented'): boolean;
  /** Publishes the next catalogue listing that is not online yet, as `drip` would. */
  publishNext(): SandboxListing | undefined;
  listings(opts?: { includeRemoved?: boolean }): SandboxListing[];
  submissions(): Submission[];
  submission(id: string): Submission | undefined;
  /** The landlord answers a submission right away with a reply of this kind. */
  landlordReply(submissionId: string, kind: ReplyKind): Promise<ThreadMessage>;
  /** Hands the sandbox an email the agent sent to a landlord. `startSandbox` does this itself when `mail.onSend` is given. */
  receiveMail(mail: AgentEmail): Submission | undefined;
  /** Every email the agent sent that reached the sandbox, with the submission it belongs to. */
  emails(): ReceivedEmail[];
  /** Every request to the source answers 429, with `Retry-After` when `retryAfterSec` is given. */
  setBlocked(source: SourceName, blocked: boolean, opts?: { retryAfterSec?: number }): void;
  /** Huisje's contact form, inbox and thread replies need a logged-in session. */
  setLoginRequired(required: boolean): void;
  setAutoReply(enabled: boolean): void;
  setDrip(enabled: boolean): void;
  state(): SandboxState;
  /** Back to the starting listings with no submissions, blocks, login wall or pending replies. Ids keep counting. */
  reset(): void;
}

const copy = <T>(v: T): T => structuredClone(v);

export function createControl(core: SandboxCore): Control {
  const control: Control = {
    addListing: (input = {}) => copy(core.world.add(input)),
    removeListing: (id, how = 'removed') => core.world.remove(id, how),
    publishNext: () => {
      const l = core.dripOne();
      return l ? copy(l) : undefined;
    },
    listings: (opts = {}) => copy(core.world.listings(opts)),
    submissions: () => copy(core.world.submissions()),
    submission: (id) => {
      const s = core.world.submission(id);
      return s ? copy(s) : undefined;
    },
    landlordReply: async (id, kind) => {
      if (!(REPLY_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown reply kind "${kind}"`);
      return copy(await core.landlords.reply(id, kind));
    },
    receiveMail: (mail) => {
      const s = core.receiveMail(mail);
      return s ? copy(s) : undefined;
    },
    emails: () => copy(core.state.emails),
    setBlocked: (source, blocked, opts = {}) => {
      if (!SOURCE_NAMES.includes(source)) throw new Error(`unknown source "${source}"`);
      core.state.blocked[source] = blocked
        ? { on: true, ...(opts.retryAfterSec !== undefined ? { retryAfterSec: opts.retryAfterSec } : {}) }
        : { on: false };
    },
    setLoginRequired: (required) => {
      core.state.loginRequired = required;
    },
    setAutoReply: (enabled) => {
      core.state.autoReply = enabled;
      if (!enabled) core.landlords.cancelAll();
    },
    setDrip: (enabled) => {
      core.setDrip(enabled);
    },
    state: () => ({
      blocked: { huisje: core.state.blocked.huisje.on, gracht: core.state.blocked.gracht.on },
      loginRequired: core.state.loginRequired,
      autoReply: core.state.autoReply,
      drip: core.dripping,
      pendingReplies: core.landlords.pending(),
    }),
    reset: () => {
      core.reset();
    },
  };
  return control;
}

/**
 * The same controls over HTTP, for the e2e walkthrough and for poking at the
 * demo with curl. JSON in, JSON out. Never blocked.
 *
 *   GET    /_control                         state
 *   GET    /_control/listings                listings (?includeRemoved=1)
 *   POST   /_control/listings                add a listing (body: ListingInput) -> 201
 *   POST   /_control/listings/publish-next   the next catalogue listing
 *   DELETE /_control/listings/:id            remove (?how=rented to mark it rented)
 *   GET    /_control/submissions             submissions with their messages
 *   GET    /_control/submissions/:id
 *   POST   /_control/submissions/:id/reply   { kind } -> the landlord's message
 *   POST   /_control/mail                    an email the agent sent -> { submissionId }
 *   GET    /_control/emails                  every email the agent sent that reached the sandbox
 *   POST   /_control/blocked                 { source, blocked, retryAfterSec? }
 *   POST   /_control/login-required          { required }
 *   POST   /_control/auto-reply              { enabled }
 *   POST   /_control/drip                    { enabled }
 *   POST   /_control/reset
 *   GET    /_control/attachments/:id         a file a landlord or the agent sent
 */
export function controlRoutes(core: SandboxCore, control: Control): Hono {
  const app = new Hono({ strict: false });
  const body = async (c: { req: { json(): Promise<unknown> } }) =>
    ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const bad = (message: string) => ({ error: 'bad_request', message });

  app.get('/', (c) =>
    c.json({
      state: control.state(),
      listings: core.world.listings().length,
      submissions: core.world.submissions().length,
    }),
  );

  app.get('/listings', (c) =>
    c.json({ listings: control.listings({ includeRemoved: Boolean(c.req.query('includeRemoved')) }) }),
  );

  app.post('/listings', async (c) => {
    try {
      return c.json(control.addListing((await body(c)) as ListingInput), 201);
    } catch (e) {
      return c.json(bad((e as Error).message), 400);
    }
  });

  app.post('/listings/publish-next', (c) => c.json({ listing: control.publishNext() ?? null }));

  app.delete('/listings/:id', (c) => {
    const how = c.req.query('how') === 'rented' ? 'rented' : 'removed';
    return control.removeListing(c.req.param('id'), how)
      ? c.json({ ok: true })
      : c.json({ error: 'not_found' }, 404);
  });

  app.get('/submissions', (c) => c.json({ submissions: control.submissions() }));

  app.get('/submissions/:id', (c) => {
    const s = control.submission(c.req.param('id'));
    return s ? c.json(s) : c.json({ error: 'not_found' }, 404);
  });

  app.post('/submissions/:id/reply', async (c) => {
    const kind = (await body(c)).kind;
    if (typeof kind !== 'string' || !(REPLY_KINDS as readonly string[]).includes(kind)) {
      return c.json(bad(`kind must be one of ${REPLY_KINDS.join(', ')}`), 400);
    }
    if (!core.world.submission(c.req.param('id'))) return c.json({ error: 'not_found' }, 404);
    return c.json(await control.landlordReply(c.req.param('id'), kind as ReplyKind));
  });

  app.post('/mail', async (c) => {
    const b = await body(c);
    if (typeof b.to !== 'string' || typeof b.text !== 'string')
      return c.json(bad('to and text are required'), 400);
    const sub = control.receiveMail({
      ...(b as unknown as AgentEmail),
      subject: typeof b.subject === 'string' ? b.subject : '',
    });
    return c.json({ submissionId: sub?.id ?? null });
  });

  app.get('/emails', (c) => c.json({ emails: control.emails() }));

  app.post('/blocked', async (c) => {
    const b = await body(c);
    if (typeof b.source !== 'string' || !SOURCE_NAMES.includes(b.source as SourceName))
      return c.json(bad('source must be huisje or gracht'), 400);
    const retryAfterSec = typeof b.retryAfterSec === 'number' ? b.retryAfterSec : undefined;
    control.setBlocked(
      b.source as SourceName,
      b.blocked !== false,
      retryAfterSec === undefined ? {} : { retryAfterSec },
    );
    return c.json(control.state());
  });

  app.post('/login-required', async (c) => {
    control.setLoginRequired((await body(c)).required !== false);
    return c.json(control.state());
  });

  app.post('/auto-reply', async (c) => {
    control.setAutoReply((await body(c)).enabled !== false);
    return c.json(control.state());
  });

  app.post('/drip', async (c) => {
    control.setDrip((await body(c)).enabled !== false);
    return c.json(control.state());
  });

  app.post('/reset', (c) => {
    control.reset();
    return c.json(control.state());
  });

  app.get('/attachments/:id', (c) => {
    const id = c.req.param('id');
    const found = core.world
      .submissions()
      .flatMap((s) => s.messages.flatMap((m) => m.attachments))
      .find((a) => a.id === id);
    if (!found) return c.json({ error: 'not_found' }, 404);
    try {
      return c.body(new Uint8Array(readFileSync(found.path)), 200, { 'content-type': found.contentType });
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }
  });

  return app;
}

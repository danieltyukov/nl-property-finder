import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  NamedSearchSchema,
  ProfileSchema,
  RegionSchema,
  ResolveTaskBody,
  SearchSchema,
  type Page,
} from '@nlpf/core';
import type { NlpfClient } from '../client.js';

/*
 * The MCP tools, one per thing a model may want to do. Each description says
 * what the tool does, when to use it, and what it never does. The ones that
 * reach a landlord or agent say so plainly, because a model cannot undo a
 * message once it is sent.
 */

type Shape = Record<string, z.ZodType>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: Shape;
  annotations: ToolAnnotations;
  run(client: NlpfClient, args: Record<string, unknown>): Promise<unknown>;
}

function defineTool<S extends Shape>(def: {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations: ToolAnnotations;
  run(client: NlpfClient, args: z.infer<z.ZodObject<S>>): Promise<unknown>;
}): ToolDef {
  return def as unknown as ToolDef;
}

/** A config field as an optional tool input: defaults removed, so a missing field means "leave it as it is". */
function optional(schema: z.ZodType, description: string): z.ZodOptional<z.ZodType> {
  let inner: z.ZodType = schema;
  while (inner instanceof z.ZodDefault) inner = inner.unwrap() as z.ZodType;
  return inner.optional().describe(description);
}

function withoutUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Lists come back without the page wrapper unless there is a next page to ask for. */
function listResult<T>(page: Page<T>): unknown {
  return page.next ? page : page.items;
}

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const LOCAL_WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const CONTACTS_PEOPLE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

const applicationStatus = z.enum([
  'queued',
  'contacted',
  'replied',
  'viewing_proposed',
  'viewing_booked',
  'viewed',
  'offer',
  'rejected',
  'withdrawn',
  'gone',
  'skipped',
  'manual',
]);

const S = SearchSchema.shape;
const P = ProfileSchema.shape;

export const TOOLS: ToolDef[] = [
  defineTool({
    name: 'status',
    title: 'Agent status',
    description:
      "Returns the agent's current state: whether automation is paused or in dry run, the health of every rental source, the mailbox connection, AI usage this month, and today's numbers (listings seen, matched, contacted, replies, open tasks, upcoming viewings). Call it first to orient yourself, or when the user asks how the search is going. Read only: it never changes anything and never contacts anyone.",
    input: {},
    annotations: READ,
    run: (c) => c.status(),
  }),

  defineTool({
    name: 'search_listings',
    title: 'Search found homes',
    description:
      'Searches the rental homes the agent has found, newest first. Each result is one property (one home, even when several sites list it) with its listings, the match verdict and score, the application and its status, and any viewings. Filter with q (free text on address and title) and status (an application status). Use it to answer questions about what is on the market or what happened to a home. Read only: it never contacts anyone.',
    input: {
      q: z
        .string()
        .optional()
        .describe('Free text matched against address and title, for example "Oude Delft" or "studio".'),
      status: applicationStatus.optional().describe('Only homes whose application has this status.'),
      limit: z.number().int().min(1).max(100).default(20).describe('How many properties to return.'),
      before: z
        .string()
        .optional()
        .describe('The next value from a previous result, to get the page after it.'),
    },
    annotations: READ,
    run: async (c, a) => listResult(await c.properties(withoutUndefined(a))),
  }),

  defineTool({
    name: 'get_property',
    title: 'Property details',
    description:
      'Returns one property by id with everything known about it: every listing across sites, the match verdict with its reasons or the failed rule, the scam check, the rent check estimate, the application, viewings, and the ids of its conversations. Use it after search_listings when the user asks about one home. Read only.',
    input: { id: z.string().describe('The property id, as returned by search_listings.') },
    annotations: READ,
    run: (c, a) => c.property(a.id),
  }),

  defineTool({
    name: 'list_applications',
    title: 'Application board',
    description:
      'Returns the application board: every home the agent has queued or contacted, by status (queued, contacted, replied, viewing proposed or booked, offer, rejected, withdrawn, gone), with reaction times, the channel used and the last message. Use it for an overview of how the applications stand. Read only.',
    input: {},
    annotations: READ,
    run: (c) => c.applications(),
  }),

  defineTool({
    name: 'list_tasks',
    title: 'Action inbox',
    description:
      'Returns the Action inbox: the things that need the user, such as a viewing to confirm, a reply the agent could not answer, documents to approve, an offer or contract, a payment warning, or a source that stopped working. Each task has a kind, a one-sentence reason, a priority (1 is most urgent), an optional deadline and details. Use it whenever the user asks what needs their attention. Read only; to act on a task, use resolve_task.',
    input: {
      state: z
        .enum(['open', 'snoozed', 'done', 'dismissed'])
        .default('open')
        .describe('Which tasks to list. Open tasks are the ones waiting for the user.'),
    },
    annotations: READ,
    run: async (c, a) => listResult(await c.tasks({ state: a.state })),
  }),

  defineTool({
    name: 'resolve_task',
    title: 'Act on a task',
    description:
      "Acts on one task from the Action inbox. done and dismiss close it, snooze hides it until the time in until, and reject declines what the task proposes. approve and send_draft CONTACT REAL PEOPLE: approve carries out the task's primary action (for example sending the drafted message, confirming a viewing, or sending the requested documents), and send_draft sends the text in draft as the reply. Only use approve or send_draft when the user has explicitly told you to for this task, after showing them what will be sent. Never approve anything that pays money, signs a contract, or shares identity documents unless the user said so for that specific task.",
    input: {
      id: z.string().describe('The task id, as returned by list_tasks.'),
      action: ResolveTaskBody.shape.action.describe(
        'done, dismiss, snooze or reject change only the inbox. approve and send_draft contact a landlord or agent.',
      ),
      until: z
        .string()
        .optional()
        .describe('For snooze: when the task should come back, as an ISO 8601 time.'),
      draft: z.string().optional().describe('For send_draft: the exact text to send.'),
      slot: z
        .number()
        .int()
        .optional()
        .describe('For viewing choices: the index of the proposed slot to accept.'),
    },
    annotations: CONTACTS_PEOPLE,
    run: (c, a) =>
      c.resolveTask(
        a.id,
        withoutUndefined({ action: a.action, until: a.until, draft: a.draft, slot: a.slot }) as never,
      ),
  }),

  defineTool({
    name: 'list_conversations',
    title: 'Conversations',
    description:
      'Lists the message threads with landlords and letting agents, most recent first, with the counterpart, subject, unread count and the property they are about. Use it to find a conversation before reading it with get_conversation. Read only.',
    input: {},
    annotations: READ,
    run: async (c) => listResult(await c.conversations()),
  }),

  defineTool({
    name: 'get_conversation',
    title: 'Read a conversation',
    description:
      'Returns one conversation with every message in order: who wrote it, the channel, the intent the agent recognised, and for messages the agent wrote, why it wrote them. Also returns the property and application the conversation belongs to. Use it to read what a landlord said before drafting or sending anything. Read only.',
    input: {
      id: z.string().describe('The conversation id, as returned by list_conversations or get_property.'),
    },
    annotations: READ,
    run: (c, a) => c.conversation(a.id),
  }),

  defineTool({
    name: 'draft_message',
    title: 'Draft a message',
    description:
      "Writes a message without sending it: a first message to the landlord of a property (propertyId) or a reply in an existing conversation (conversationId), in the user's name and from their profile, following instructions when given (for example: ask whether registration at the address is allowed). Returns the draft and the reasoning behind it. Use it to show the user a message before they decide. It never sends anything; sending is send_message.",
    input: {
      propertyId: z.string().optional().describe('Draft a first message about this property.'),
      conversationId: z.string().optional().describe('Draft a reply in this conversation.'),
      instructions: z.string().optional().describe('What the message should say or ask, in plain words.'),
    },
    annotations: LOCAL_WRITE,
    run: (c, a) => {
      if (!a.propertyId && !a.conversationId) throw new Error('Pass propertyId or conversationId.');
      return c.draft(withoutUndefined(a));
    },
  }),

  defineTool({
    name: 'send_message',
    title: 'Send a message',
    description:
      "Sends a message in an existing conversation. This CONTACTS A REAL PERSON (a landlord or letting agent) from the user's own mailbox or platform account, and a sent message cannot be taken back. Only call it when the user has explicitly asked you to send this exact text, ideally after you showed it to them (draft_message helps with that). Never use it to agree to pay money, to sign anything, or to share identity documents, bank details or a BSN.",
    input: {
      conversationId: z.string().describe('The conversation to reply in.'),
      body: z.string().min(1).describe('The exact text to send.'),
      subject: z
        .string()
        .optional()
        .describe('A subject line, for email conversations. Usually leave it out to keep the thread.'),
    },
    annotations: CONTACTS_PEOPLE,
    run: (c, a) =>
      c.sendMessage(
        a.conversationId,
        withoutUndefined({ body: a.body, subject: a.subject, send: true }) as never,
      ),
  }),

  defineTool({
    name: 'list_viewings',
    title: 'Viewings',
    description:
      'Lists viewings: proposed and booked appointments with start and end times (ISO 8601 in UTC; show them to the user in Europe/Amsterdam time), the location, and whether the agent or the user booked them. Use it when the user asks when and where their viewings are. Read only; confirming or cancelling a viewing goes through its task.',
    input: {},
    annotations: READ,
    run: async (c) => listResult(await c.viewings()),
  }),

  defineTool({
    name: 'get_searches',
    title: 'Searches',
    description:
      "Returns the user's named searches: regions (municipalities, postcode ranges, drawn areas), price range, size, rooms, property types, furnishing, move-in date, must-haves, deal-breakers and the minimum score. Use it before update_search, or when the user asks what the agent is looking for. Read only.",
    input: {},
    annotations: READ,
    run: async (c) => (await c.config()).searches,
  }),

  defineTool({
    name: 'update_search',
    title: 'Change a search',
    description:
      'Changes one named search, found by id. Only the fields you pass change; the others stay as they are. Set create to true to add a new search with that id. The change applies to listings from now on and does not undo anything already sent, but homes that now match may be contacted automatically according to the automation settings. Use it when the user wants to change where or what they are looking for.',
    input: {
      id: z.string().describe('The search id, lowercase letters, digits and dashes, for example "main".'),
      create: z
        .boolean()
        .default(false)
        .describe('Add a new search with this id instead of changing an existing one.'),
      name: z.string().optional().describe('A readable name for the search.'),
      enabled: z.boolean().optional().describe('Whether the agent uses this search.'),
      regions: z
        .array(RegionSchema)
        .optional()
        .describe(
          'Replaces the regions. Each has a name and municipalities, postcode ranges like "2611-2629", or a polygon.',
        ),
      priceMinEur: optional(S.priceMinEur, 'Minimum monthly rent in euros.'),
      priceMaxEur: optional(S.priceMaxEur, 'Maximum monthly rent in euros.'),
      sizeMinM2: optional(S.sizeMinM2, 'Minimum living area in square metres.'),
      roomsMin: optional(S.roomsMin, 'Minimum number of rooms.'),
      bedroomsMin: optional(S.bedroomsMin, 'Minimum number of bedrooms.'),
      types: optional(S.types, 'Property types to include: room, studio, apartment, house, other.'),
      furnishing: optional(
        S.furnishing,
        'Furnishing to include: unfurnished, upholstered, furnished, unknown.',
      ),
      availableBy: optional(S.availableBy, 'Only homes available by this date, YYYY-MM-DD.'),
      mustHaves: optional(S.mustHaves, 'Replaces the must-haves, as short phrases.'),
      dealBreakers: optional(
        S.dealBreakers,
        'Replaces the deal-breakers; a listing whose text contains one is skipped.',
      ),
      minScore: optional(S.minScore, 'Minimum match score from 0 to 100.'),
    },
    annotations: LOCAL_WRITE,
    run: async (c, a) => {
      const { id, create, ...rest } = a;
      const changes = withoutUndefined(rest);
      const searches = (await c.config()).searches;
      const index = searches.findIndex((s) => s.id === id);
      if (index < 0 && !create) {
        throw new Error(
          `No search with id ${id}. Existing searches: ${searches.map((s) => s.id).join(', ')}. Pass create: true to add it.`,
        );
      }
      const base = index >= 0 ? searches[index] : { id, name: changes.name ?? id };
      const updated = NamedSearchSchema.parse({ ...base, ...changes, id });
      const next = index >= 0 ? searches.map((s, i) => (i === index ? updated : s)) : [...searches, updated];
      await c.patchConfig({ section: 'searches', value: next });
      return updated;
    },
  }),

  defineTool({
    name: 'get_profile',
    title: 'Profile',
    description:
      "Returns the user's profile as the agent uses it to introduce them to landlords: name, contact details, occupation and organisation, income or guarantor, household, pets, smoking, move-in dates, languages, an about-me text, and extra facts for answering landlords' questions. Use it before update_profile or before drafting in the user's name. Read only.",
    input: {},
    annotations: READ,
    run: async (c) => (await c.config()).profile,
  }),

  defineTool({
    name: 'update_profile',
    title: 'Change the profile',
    description:
      "Changes fields of the user's profile. Only the fields you pass change. facts are merged into the existing facts, and a fact set to an empty string is removed. Use it when the user tells you something about themselves that landlords ask about. Record only what the user said; never invent details, and never store a BSN, bank details or passwords here.",
    input: {
      firstName: optional(P.firstName, 'First name.'),
      lastName: optional(P.lastName, 'Last name.'),
      phone: optional(P.phone, 'Phone number shared with landlords.'),
      birthYear: optional(P.birthYear, 'Year of birth.'),
      occupation: optional(P.occupation, 'student, phd, employed, self_employed, starting_job or other.'),
      organisation: optional(P.organisation, 'University or employer.'),
      incomeMonthlyGrossEur: optional(P.incomeMonthlyGrossEur, 'Gross monthly income in euros.'),
      guarantor: optional(P.guarantor, 'A guarantor: relation, gross monthly income, country.'),
      household: optional(P.household, 'Adults, children and pets moving in.'),
      smoker: optional(P.smoker, 'Whether the user smokes.'),
      moveInFrom: optional(P.moveInFrom, 'Earliest move-in date, YYYY-MM-DD.'),
      moveInLatest: optional(P.moveInLatest, 'Latest move-in date, YYYY-MM-DD.'),
      stayMonths: optional(P.stayMonths, 'How many months the user plans to stay.'),
      languages: optional(P.languages, 'Languages the user speaks, as codes like "en" and "nl".'),
      messageLanguage: optional(
        P.messageLanguage,
        'Language for messages: auto (follow the listing), nl or en.',
      ),
      about: optional(P.about, "A short introduction in the user's own words."),
      facts: z
        .record(z.string(), z.string())
        .optional()
        .describe('Extra question and answer pairs, merged into the existing facts.'),
      signature: optional(P.signature, 'How messages are signed.'),
    },
    annotations: LOCAL_WRITE,
    run: async (c, a) => {
      const profile = (await c.config()).profile;
      const { facts, ...rest } = a;
      const mergedFacts = Object.fromEntries(
        Object.entries({ ...profile.facts, ...(facts ?? {}) }).filter(([, v]) => v !== ''),
      );
      const updated = ProfileSchema.parse({ ...profile, ...withoutUndefined(rest), facts: mergedFacts });
      await c.patchConfig({ section: 'profile', value: updated });
      return updated;
    },
  }),

  defineTool({
    name: 'pause',
    title: 'Pause automation',
    description:
      'Pauses automation: the agent keeps reading every source so nothing is missed, but sends nothing (no first messages, replies or follow-ups) until resume. Use it when the user wants the agent to stop contacting people, for example while they decide on an offer. Safe to call at any time.',
    input: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (c) => c.pause(),
  }),

  defineTool({
    name: 'resume',
    title: 'Resume automation',
    description:
      'Resumes automation after a pause. From then on the agent again messages the landlords of new matches and answers routine replies according to the automation settings, so resuming leads to real people being contacted. Only call it when the user asked for it.',
    input: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: (c) => c.resume(),
  }),

  defineTool({
    name: 'source_health',
    title: 'Source health',
    description:
      'Returns every rental source (site) the agent reads, with whether it is enabled, its health (ok, degraded, down, needs_login, watch_only, disabled), the last run and last success, the last error, how many listings the last run returned, and when it runs next. Use it when the user asks whether a site is being watched or why it seems quiet. Read only.',
    input: {},
    annotations: READ,
    run: async (c) => listResult(await c.sources()),
  }),

  defineTool({
    name: 'test_source',
    title: 'Test a source',
    description:
      'Runs one search on a source right now against the live site and reports what came back, to check that the site still works with the agent. It can take a minute when the site needs a browser. It never sends messages to anyone. Use it when source_health shows a problem or the user asks whether a site works.',
    input: {
      id: z.string().describe('The source id, as returned by source_health, for example "kamernet".'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: (c, a) => c.testSource(a.id),
  }),

  defineTool({
    name: 'stats',
    title: 'Search statistics',
    description:
      'Returns statistics for the last 7 days: the median time from first seeing a listing to contacting it, daily counts, results per source, reply rates per message variant and per agency, and how quickly each source shows new listings. Use it when the user asks how well the search is working. Read only.',
    input: {},
    annotations: READ,
    run: (c) => c.stats(),
  }),

  defineTool({
    name: 'withdraw_all',
    title: 'I found a place',
    description:
      'For when the user has found a home: sends a withdrawal message on every open conversation, marks those applications withdrawn, and by default pauses automation. This CONTACTS REAL PEOPLE, possibly many at once, and cannot be undone. Pass foundAddress (the home the user took) so that conversation is left alone. It requires confirm: true, and you should only call it after the user has explicitly confirmed that they found a place and want every other landlord told.',
    input: {
      confirm: z.literal(true).describe('Must be true. Set it only after the user explicitly confirmed.'),
      foundAddress: z
        .string()
        .optional()
        .describe('The address of the home the user took; its conversation gets no withdrawal.'),
      message: z
        .string()
        .optional()
        .describe('The withdrawal text. Leave it out to use the configured or built-in message.'),
      pause: z.boolean().default(true).describe('Pause automation afterwards so no new homes are contacted.'),
    },
    annotations: CONTACTS_PEOPLE,
    run: (c, a) =>
      c.withdrawAll(withoutUndefined({ foundAddress: a.foundAddress, message: a.message, pause: a.pause })),
  }),
];

import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const propertyType = z.enum(['room', 'studio', 'apartment', 'house', 'other']);
const furnishing = z.enum(['unfurnished', 'upholstered', 'furnished', 'unknown']);
const intent = z.enum([
  'viewing_invite', 'viewing_slots', 'info_request', 'documents_request', 'application_form', 'rejection',
  'listing_gone', 'offer', 'contract', 'payment_request', 'scam_suspect', 'alert', 'newsletter', 'other',
]);

export const ProfileSchema = z.object({
  firstName: z.string().default(''),
  lastName: z.string().default(''),
  email: z.string().default(''),                     // the dedicated mailbox address
  phone: z.string().optional(),
  birthYear: z.number().int().optional(),
  nationality: z.string().optional(),
  occupation: z.enum(['student', 'phd', 'employed', 'self_employed', 'starting_job', 'other']).default('student'),
  organisation: z.string().optional(),               // university or employer
  incomeMonthlyGrossEur: z.number().optional(),
  guarantor: z.object({ relation: z.string(), incomeMonthlyGrossEur: z.number().optional(), country: z.string().optional() }).optional(),
  coApplicants: z.array(z.object({
    name: z.string(), relation: z.string().default('partner'), occupation: z.string().optional(), incomeMonthlyGrossEur: z.number().optional(),
  })).default([]),                                   // household or group search: incomes add up in requirement checks and messages mention them
  household: z.object({ adults: z.number().int().min(1).default(1), children: z.number().int().min(0).default(0), pets: z.boolean().default(false) }).default({ adults: 1, children: 0, pets: false }),
  smoker: z.boolean().default(false),
  moveInFrom: z.string().optional(),                 // YYYY-MM-DD
  moveInLatest: z.string().optional(),
  stayMonths: z.number().int().optional(),
  languages: z.array(z.string()).default(['en']),
  about: z.string().default(''),                     // free-text introduction in the user's words
  facts: z.record(z.string(), z.string()).default({}), // extra Q&A the agent may use when answering
  messageLanguage: z.enum(['auto', 'nl', 'en']).default('auto'),
  signature: z.string().optional(),
});

export const RegionSchema = z.object({
  name: z.string(),
  municipalities: z.array(z.string()).default([]),
  postcodes: z.array(z.string().regex(/^\d{4}(-\d{4})?$/)).default([]),
  polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
});

export const SearchSchema = z.object({
  regions: z.array(RegionSchema).default([]),
  priceMinEur: z.number().optional(),
  priceMaxEur: z.number().optional(),
  priceIncludesServiceCosts: z.boolean().default(true),
  sizeMinM2: z.number().optional(),
  roomsMin: z.number().optional(),
  bedroomsMin: z.number().optional(),
  types: z.array(propertyType).default(['room', 'studio', 'apartment', 'house']),
  furnishing: z.array(furnishing).default(['unfurnished', 'upholstered', 'furnished', 'unknown']),
  availableBy: z.string().optional(),
  requireRegistration: z.boolean().default(true),
  mustHaves: z.array(z.string()).default([]),
  dealBreakers: z.array(z.string()).default([]),
  commute: z.array(z.object({
    name: z.string(), lat: z.number(), lon: z.number(),
    mode: z.enum(['bike', 'walk', 'transit', 'car']).default('bike'), maxMinutes: z.number().optional(),
  })).default([]),
  minScore: z.number().min(0).max(100).default(0),
  skipAboveLegalMaxPct: z.number().optional(),       // skip listings whose rent is this % above the estimated legal maximum
});

export const NamedSearchSchema = SearchSchema.extend({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  enabled: z.boolean().default(true),
});

export const SourceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSec: z.number().int().min(30).optional(),
  contact: z.enum(['auto', 'watch_only']).optional(), // explicit per-source choice; unset means: auto when terms are 'allows' or 'unknown', watch_only when 'forbids'
  termsAcknowledgedAt: z.string().optional(),         // set when the user opted in to automated contact on a platform whose terms forbid it
  paidPlan: z.string().optional(),                    // e.g. "kamernet-premium"
  searchUrls: z.array(z.string().url()).default([]),
  options: z.record(z.string(), z.unknown()).default({}),
});

export const AutomationSchema = z.object({
  mode: z.enum(['auto', 'threshold', 'approve']).default('auto'),
  scoreThreshold: z.number().min(0).max(100).default(60),
  paused: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  dailyCap: z.number().int().min(0).default(40),
  sendWindow: z.object({ start: hhmm.default('07:00'), end: hhmm.default('23:30') }).default({ start: '07:00', end: '23:30' }),
  policies: z.partialRecord(intent, z.enum(['auto', 'task', 'ignore'])).default({}),
  availability: z.array(z.object({ days: z.array(day), start: hhmm, end: hhmm })).default([
    { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '20:00' },
    { days: ['sat', 'sun'], start: '10:00', end: '18:00' },
  ]),
  viewingBufferMin: z.number().int().default(45),
  autoAcceptViewings: z.boolean().default(true),
  documents: z.object({
    public: z.enum(['auto', 'approve']).default('auto'),
    private: z.enum(['after_viewing_booked', 'approve']).default('after_viewing_booked'),
    identity: z.literal('approve').default('approve'),
  }).default({ public: 'auto', private: 'after_viewing_booked', identity: 'approve' }),
  templates: z.object({
    first: z.object({ nl: z.string().default(''), en: z.string().default('') }).default({ nl: '', en: '' }),
  }).default({ first: { nl: '', en: '' } }),
  variants: z.array(z.object({ id: z.string(), instruction: z.string(), weight: z.number().default(1) })).default([]),
  recheckBeforeSend: z.boolean().default(true),      // confirm the listing is still online right before contacting
  followUp: z.object({ enabled: z.boolean().default(true), afterDays: z.number().int().min(1).default(3), max: z.number().int().min(0).max(2).default(1) })
    .default({ enabled: true, afterDays: 3, max: 1 }),  // one polite follow-up when a landlord has not answered and the listing is still online
  maxAutoRepliesPerConversationPerDay: z.number().int().min(0).default(3),   // loop guard against auto-responders
  disclosure: z.object({ enabled: z.boolean().default(false), nl: z.string().default('Dit bericht is opgesteld met hulp van mijn assistent.'), en: z.string().default('This message was drafted with help from my assistant.') })
    .default({ enabled: false, nl: 'Dit bericht is opgesteld met hulp van mijn assistent.', en: 'This message was drafted with help from my assistant.' }),
  withdraw: z.object({ nl: z.string().default(''), en: z.string().default('') }).default({ nl: '', en: '' }),   // "I found a place" message; built-in text when empty
  callNowMinScore: z.number().min(0).max(100).default(85),   // push a "call now" with the agent's number for very strong matches
});

export const MailSchema = z.object({
  provider: z.enum(['imap', 'memory', 'none']).default('none'),
  address: z.string().default(''),
  user: z.string().optional(),
  imap: z.object({ host: z.string().default('imap.gmail.com'), port: z.number().default(993), secure: z.boolean().default(true) }).default({ host: 'imap.gmail.com', port: 993, secure: true }),
  smtp: z.object({ host: z.string().default('smtp.gmail.com'), port: z.number().default(465), secure: z.boolean().default(true) }).default({ host: 'smtp.gmail.com', port: 465, secure: true }),
  passwordEnv: z.string().default('NLPF_MAIL_PASSWORD'),
  folder: z.string().default('INBOX'),
});

export const NotifySchema = z.object({
  ntfy: z.object({ server: z.string().url().default('https://ntfy.sh'), topic: z.string(), actions: z.boolean().default(true) }).optional(),  // actions: buttons post to "<topic>-actions", which the daemon subscribes to
  telegram: z.object({ chatId: z.string(), tokenEnv: z.string().default('NLPF_TELEGRAM_TOKEN'), actions: z.boolean().default(true) }).optional(), // inline buttons and replies via getUpdates long polling
  email: z.object({ to: z.string(), digest: z.enum(['instant', 'daily']).default('daily') }).optional(),   // sent from the dedicated mailbox; off unless configured
  desktop: z.boolean().default(true),
  quietHours: z.object({ start: hhmm, end: hhmm }).optional(),
  minPriority: z.number().int().min(1).max(5).default(3),
  includeDetails: z.boolean().default(false),        // false => titles only leave the machine
});

const op = z.object({ model: z.string().default('claude-opus-5'), effort: z.enum(['low', 'medium', 'high']).default('low') });

export const AiSchema = z.object({
  provider: z.enum(['claude', 'rules', 'demo']).default('rules'),
  keyEnv: z.string().default('ANTHROPIC_API_KEY'),
  extract: op.default({ model: 'claude-opus-5', effort: 'low' }),
  compose: op.default({ model: 'claude-opus-5', effort: 'medium' }),
  classify: op.default({ model: 'claude-opus-5', effort: 'low' }),
  reply: op.default({ model: 'claude-opus-5', effort: 'medium' }),
  monthlyTokenBudget: z.number().int().optional(),
});

export const RegistrationSchema = z.object({
  portal: z.string(),                                // e.g. "ROOM", "Woonnet Haaglanden", "WoningNet"
  since: z.string(),                                 // YYYY-MM-DD, registration date (waiting time counts from here)
  renewBy: z.string().optional(),                    // YYYY-MM-DD; a task opens 30 days before
  url: z.string().url().optional(),
  note: z.string().optional(),
});

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  profile: ProfileSchema.default(ProfileSchema.parse({})),
  searches: z.array(NamedSearchSchema).default([NamedSearchSchema.parse({ id: 'main', name: 'Main search' })]),
  registrations: z.array(RegistrationSchema).default([]),
  rentCheck: z.object({ enabled: z.boolean().default(true), epOnlineKeyEnv: z.string().default('NLPF_EPONLINE_KEY') }).default({ enabled: true, epOnlineKeyEnv: 'NLPF_EPONLINE_KEY' }),
  sources: z.record(z.string(), SourceConfigSchema).default({}),
  agencies: z.array(z.string()).default([]),          // paths to agency YAML files, relative to the config dir
  automation: AutomationSchema.default(AutomationSchema.parse({})),
  mail: MailSchema.default(MailSchema.parse({})),
  notify: NotifySchema.default(NotifySchema.parse({})),
  ai: AiSchema.default(AiSchema.parse({})),
  server: z.object({ port: z.number().int().default(7431), lan: z.boolean().default(false) }).default({ port: 7431, lan: false }),  // lan: also bind the LAN address so a phone on the same Wi-Fi can open the dashboard (token still required)
});

export type Config = z.infer<typeof ConfigSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type SearchConfig = z.infer<typeof SearchSchema>;
export type NamedSearch = z.infer<typeof NamedSearchSchema>;
export type Registration = z.infer<typeof RegistrationSchema>;
export type RegionConfig = z.infer<typeof RegionSchema>;
export type SourceConfig = z.infer<typeof SourceConfigSchema>;
export type AutomationConfig = z.infer<typeof AutomationSchema>;

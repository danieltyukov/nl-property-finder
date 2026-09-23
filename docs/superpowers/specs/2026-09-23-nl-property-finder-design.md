# nl-property-finder: design

Date: 2026-09-23. Status: design approved in conversation; this document
records it for review. Decisions marked (owner) were made by the owner, the
rest by the implementer so they can be challenged.

## What it is

A local agent that looks for a rental home in the Netherlands for you. It
watches every Dutch rental platform it can reach, notices a new listing within
a minute or two, writes to the landlord or agent straight away through the
best free channel, reads the replies, answers the routine ones itself, books
viewings inside the times you said you are free, and puts only the things that
need a person in one Action inbox. It runs on your own computer as a
background service that starts at login and stops with one command. Nothing is
hosted anywhere.

The repository is `nl-property-finder`, the CLI is `nlpf`, and the app calls
itself NL Property Finder.

The repository previously held FreeKamerBot, an Express + Create React App
prototype that scraped three sites with brittle selectors, stored everything in
a JSON file, and could auto-reply on Kamernet with a stored password. The
rebuild keeps the goal and replaces the code. Nothing from it survives except
the knowledge of which pages exist.

## Decisions

| Decision | Choice |
|---|---|
| Name | `nl-property-finder`, CLI `nlpf` (owner) |
| Mail | A new dedicated Gmail account used only by this tool, read over IMAP IDLE and written over SMTP with an app password. Nothing reaches the owner's personal inbox (owner) |
| Paid platforms | Free only for the owner. Paid features are rebuilt where our own architecture legitimately can (aggregation, instant alerts, cross-site dedupe, finding a free channel for the same property). Paywalls are never circumvented. Paid plans such as Kamernet Premium are a settings toggle for users who have them (owner, with the circumvention line drawn by the implementer) |
| Regions | Configurable for any Dutch city or region. Owner default: Delft, Rotterdam, Den Haag (owner) |
| Platform terms | Pararius, Huurwoningen, Funda, Kamernet, HousingAnywhere, Vesteda, Marktplaats and Holland2Stay forbid automated access in their terms. Reading public listings at a low rate for personal use is what every alert service does; sending messages automatically from the user's account risks that account. Each adapter records what its platform's terms say, and automatic contact on a platform that forbids it is an explicit per-platform opt-in, with the risk stated, during onboarding (implementer, from the platform research) |
| Autonomy | Full auto by default: message every listing that passes filters and the scam guard, answer routine replies, accept viewing slots inside availability. Contracts, money, identity documents and uncertainty always go to a person (owner) |
| AI | Claude through the official Anthropic SDK, behind a provider interface. Every feature has a template or rule fallback so the tool works with no key at all |
| Language | TypeScript on Node 22, ESM, npm workspaces |
| Platform first | Linux (systemd user service). macOS (launchd) and Windows (Task Scheduler) are implemented from templates and documented as untested |

## Goals

1. Every new matching listing on a supported source is contacted within 60
   seconds of the tool first seeing it, when the source allows contact.
2. The owner's attention is spent only on items in the Action inbox, and each
   item says why it is there and what one click does.
3. Adding a source is a small typed module with recorded fixtures, or for an
   ordinary estate-agent website, a YAML file.
4. Claude (or any agent) can operate the whole tool through MCP, a REST API
   with an OpenAPI description, or the CLI with `--json`.
5. Free to run. The only optional cost is Claude API usage, which the owner
   controls by model choice and which is zero in no-AI mode.
6. A stranger can clone the repository, run `nlpf init`, and be searching in
   their own city in ten minutes.

## Non-goals

- A hosted service, accounts, or a mobile app. Phone alerts go through ntfy or
  Telegram.
- Circumventing paywalls, captchas, or login walls. When a platform needs a
  human (captcha, first login, paid plan), the tool asks for one.
- Facebook groups and WhatsApp communities. They need a personal account and
  their terms forbid automation. They are listed in the docs as manual.
- Signing contracts or paying anything, ever.
- Buying property. Rentals only (huur), though the model does not preclude it.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 22.12 or newer, TypeScript 5.9, ESM | The existing repo is Node; Playwright is native to it; one language for contributors |
| HTTP server | Hono on `@hono/node-server` | Small, typed, built-in SSE streaming |
| Database | SQLite through `better-sqlite3`, hand-written SQL migrations | One file, synchronous and fast, prebuilt binaries for all three OSes |
| Validation | zod 4 | Config schema, API bodies, AI structured output; `z.toJSONSchema` generates the editor schema |
| HTTP scraping | Node's built-in `fetch` + `cheerio` | Fast path for JSON endpoints and static HTML; no extra dependency |
| Browser | `playwright-core` driving Playwright's Chromium, persistent contexts per platform | JS-rendered sources, contact forms, logged-in sessions |
| Mail | `imapflow`, `nodemailer`, `mailparser` | IMAP IDLE for instant arrival, SMTP for replies |
| AI | `@anthropic-ai/sdk` | Structured outputs for classification and extraction, prompt caching for the profile |
| MCP | `@modelcontextprotocol/sdk` | stdio server for Claude Code and Claude Desktop |
| CLI | `commander` | Familiar, small |
| Geocoding | PDOK Locatieserver (Dutch government, free, no key) | Normalises addresses to postcode, coordinates and municipality |
| Map | Leaflet + OpenStreetMap tiles + `leaflet-geoman-free` | Drawing search areas, free |
| Dashboard | React 19 + Vite + TanStack Query + wouter, plain CSS with shared design tokens | Fast, no CSS framework lock-in, tokens shared with the site |
| Tests | vitest (unit, integration), Playwright Test (e2e), GreenMail in Docker (mail integration) | |

## Repository layout

    apps/
      daemon/            the background service: scheduler, pipelines, HTTP API, SSE, serves the dashboard
      dashboard/         React UI
      cli/               nlpf: init, on/off, pause, connect, doctor, sources, mcp, and --json everywhere
    packages/
      core/              domain types, config schema, SQLite store and migrations, event bus, logger
      sources/           adapter SDK, built-in adapters, generic agency adapter, fixtures
      agent/             matching, dedupe, scam guard, scoring, composer, channel router, triage, policy, scheduler for viewings
      ai/                provider interface, Claude provider, rule-based fallback provider, prompts
      mail/              IMAP/SMTP mailbox, alert-email parsers, thread matching
      notify/            ntfy, Telegram, desktop
      sandbox/           the fake Netherlands: a demo platform, an agency site and a landlord simulator, used by demo mode and every integration and e2e test
    e2e/                 Playwright walkthrough of the whole product
    site/                one-page project site (GitHub Pages)
    docs/                ARCHITECTURE, SETUP, CONFIG, ADAPTERS, AGENTS, PRIVACY, img/, superpowers/
    examples/            example configs: delft-student, amsterdam-professional, utrecht-couple, agency YAMLs
    skills/              a Claude Code skill that teaches an agent to operate nlpf
    .github/             CI, Pages, issue and PR templates, dependabot

## Runtime model

One process, `nlpf daemon`, runs everything. It binds `127.0.0.1:7431` only.

- `nlpf on` installs and starts the user service (`nl-property-finder.service`
  under `systemctl --user`, enabled so it starts at login). `nlpf off` stops
  and disables it. `nlpf status` prints health; `nlpf open` opens the
  dashboard.
- `nlpf pause` and `nlpf resume` stop and start automation without stopping
  the service: sources keep being read so nothing is missed, but nothing is
  sent. The dashboard has the same switch in its header.
- A `.desktop` launcher named NL Property Finder opens the dashboard.
- On macOS a LaunchAgent plist and on Windows a Task Scheduler entry are
  generated by the same `nlpf on`.

Inside the daemon:

- **Scheduler.** Each source has an interval (default 90 s for tier-1, 5 min
  for tier-2) with ±20% jitter, a per-host minimum gap, and exponential backoff
  on 403, 429 or a challenge page. Five consecutive failures mark the source
  degraded and raise an Action inbox item after an hour.
- **Job queue.** In-process, persisted in SQLite so a restart resumes pending
  sends. Jobs: `poll`, `detail`, `score`, `compose`, `send`, `triage`, `reply`,
  `notify`.
- **Event bus.** Every state change is an event row and a live SSE message.
  The dashboard, MCP and notifications all consume the same stream.
- **Browser pool.** One persistent Playwright context per platform that needs
  a login, stored under the data directory. Contexts are kept warm so a
  contact form submits in seconds.

## Configuration, secrets, data

- `~/.config/nl-property-finder/config.yaml`: everything a user chooses.
  Validated by zod at load and on every change; a JSON schema is written next
  to it so editors autocomplete. The dashboard edits the same file.
- `~/.config/nl-property-finder/secrets.env` (mode 0600): Anthropic key, Gmail
  app password, Telegram token, platform passwords if the user chooses to store
  any. Never written to logs, never returned by the API.
- `~/.local/share/nl-property-finder/`: `nlpf.db`, `browser/<platform>/`,
  `documents/`, `logs/`.
- `NLPF_HOME` overrides both roots, which is what the tests use.

Config sections: `profile` (who you are and your co-applicants, used to
write and answer), `searches` (one or more named searches: regions, price,
size, rooms, type, furnishing, move-in window, must-haves, deal-breakers,
commute anchors, legal-rent threshold), `registrations` (social-housing
portals and renewal dates), `rentCheck`, `sources` (per-source enable,
interval, contact opt-in, paid plan, imported search URLs), `automation`
(autonomy level, daily cap, send window, dry-run, re-check, follow-up, reply
cap, per-intent policy, viewing availability, document policy, templates,
variants, disclosure line, withdrawal message), `mail`, `notify` (ntfy,
Telegram, email, desktop, quiet hours, buttons), `ai` (provider, model and
effort per operation, monthly token budget), `server` (port, optional LAN).

## Domain model

- **Listing**: one advert on one source. Source id, URL, title, price (and
  whether it includes service costs), size, rooms, type, furnishing, address
  as given, available from, description, images, agent or landlord name,
  contact capability, first seen, last seen, raw payload.
- **Property**: a cluster of listings believed to be the same home. Key: PDOK
  normalised address (postcode + house number + addition) when available,
  otherwise a fingerprint of street, price band and size band. A property is
  contacted at most once across all its listings.
- **Match**: a property's evaluation: hard-filter result with the failing rule,
  score 0-100 with reasons, extracted requirements (income multiple,
  registration allowed, students allowed, contract type, minimum duration),
  scam verdict with signals.
- **Application**: our pursuit of one property: status (`new`, `contacted`,
  `replied`, `viewing_proposed`, `viewing_booked`, `viewed`, `offer`,
  `rejected`, `withdrawn`, `gone`), channel used, timestamps for reaction time.
- **Conversation** and **Message**: every inbound and outbound message on any
  channel (platform messaging, email, form submission), with who wrote it
  (agent, human, landlord), the AI rationale when the agent wrote it, and
  delivery state.
- **Task**: an Action inbox item: kind, property, reason, deadline, priority,
  suggested action, payload (for example a prefilled message), state (`open`,
  `snoozed`, `done`, `dismissed`).
- **Viewing**: time, place, application, confirmation state; exported as ICS.
- **SourceState**: health, last success, last error, latency, counts.
- **Event**: append-only log of everything above.

## Sources

### Adapter SDK

```ts
interface SourceAdapter {
  id: string;                     // "pararius"
  name: string;
  homepage: string;
  regions: 'nl' | string[];       // which municipalities it covers
  capabilities: {
    search: 'json' | 'html' | 'browser' | 'email-alert';
    detail: boolean;
    contact: 'form' | 'message' | 'email' | 'booking' | 'lottery' | 'none';
    login: 'none' | 'optional' | 'required';
    paid?: { feature: 'contact' | 'early-access'; plan: string };
  };
  buildSearches(search: SearchConfig): SearchRequest[];
  search(req: SearchRequest, ctx: SourceContext): Promise<RawListing[]>;
  detail?(listing: RawListing, ctx: SourceContext): Promise<RawListing>;
  contact?(listing: Listing, message: OutboundMessage, ctx: SourceContext): Promise<ContactResult>;
  inbox?(ctx: SourceContext): Promise<InboundMessage[]>;      // platform messaging
  checkSession?(ctx: SourceContext): Promise<'ok' | 'expired'>;
}
```

`SourceContext` provides a polite fetch (per-host gap, backoff, cache
headers), a browser page from the pool, the logger, and the profile. Adapters
are pure with respect to storage: they return data and the daemon persists it.

Every adapter ships with recorded fixtures (`fixtures/<id>/*.html|json`) and a
test that parses them. `npm run record -- <id>` refreshes fixtures from the
live site. CI never touches a live site.

### Generic agency adapter

Most Dutch estate agents run their site on a handful of backends. The generic
adapter reads a YAML file per agency: listing page URL, item selector, field
selectors or a JSON path, detail selectors, contact form selectors or contact
email. Contributors add an agency by adding a YAML file under
`examples/agencies/` and a fixture. Known backends get presets so most
agencies need only a URL.

### Alert-email ingestion

Most platforms send saved-search alerts. The dedicated mailbox receives them,
IMAP IDLE delivers them within seconds, and a parser per platform turns them
into listings. This is a second, independent path that keeps working when
polling is rate-limited or selectors break.

### Logins

`nlpf connect <platform>` opens a visible browser window on the platform's
login page with the platform's persistent profile. The user logs in (and
solves any captcha) once; the tool detects success and closes the window.
Later sessions run headless on the same profile. An expired session raises a
"Reconnect" Action inbox item. Passwords are never required; storing one in
`secrets.env` is optional for platforms that allow scripted login.

### Platform tiers

From the platform research of 2026-09-23 (`docs/research/platforms.md`, every
claim marked VERIFIED or REPORTED). Highlights that shape the design:

- Funda's contact form is a guest form with no login and no payment. It is the
  best free automatic channel in the country.
- Pararius, Huurwoningen.nl, Kamer.nl and Xior sit behind a Cloudflare managed
  challenge that headless Chromium fails and a headed Chromium passes. The
  browser pool therefore runs `headed` sessions on a private Xvfb display the
  daemon starts itself, so no window ever appears on the user's screen.
- Kamernet, HousingAnywhere (public Algolia index), Marktplaats, Vesteda, SSH,
  Woonnet Rijnmond and every Zig portal (RoomMatch for DUWO, Woonnet
  Haaglanden, Plaza, Huren in Holland Rijnland) and every OGonline agency
  site expose JSON that works with a plain request.
- Replying on Kamernet needs Premium except on listings flagged free to react.
  Kamer.nl, Directwonen, Huurstunt, Rentola and Huurzone are paid to react and
  are ingested for discovery and dedupe only.
- Holland2Stay shows an interactive Turnstile. It gets an assisted mode: a
  matching unit opens its booking page on the user's screen with an urgent
  push. The tool never solves the challenge.
- Jaap.nl no longer exists, uitzicht.nl is not a housing site, and Stekkies is
  a paid alert service (a competitor), so none of them is a source.

| Tier | Sources | Contact by default |
|---|---|---|
| 1 | Funda, Kamernet, Pararius, Huurwoningen, HousingAnywhere, Zig portals (RoomMatch/DUWO, Woonnet Haaglanden, Plaza, Holland Rijnland), OGonline agencies (generic), alert emails for every platform that sends them | Funda form, Pararius and Huurwoningen form after one login, HousingAnywhere message after login, agency forms and email; Kamernet only for free-to-react listings or with a plan; Zig portals only when the user connects and opts in |
| 2 | Marktplaats, Vesteda, SSH, Woonnet Rijnmond (Embrace), MVGM (ikwilhuren), Stadswonen Rotterdam, WoningNet DAK, Holland2Stay (assisted), Realworks and Kolibri agency sites via YAML presets | Vesteda form after login; the rest watch-only or assisted until the user opts in |
| 3 | Kamer.nl, Directwonen, Huurstunt, Rentola, Huurzone (paid aggregators); 123Wonen, Rotsvast, NederWoon, Interhouse, Van der Linden (low-volume agents); Xior, The Social Hub (booking) | Ingest only, or agent form where it is a plain form |
| Manual | Facebook groups, WhatsApp communities | Listed in docs only |

Polling budget: JSON sources every 60 s, Cloudflare HTML sources every 2 to 3
minutes from one persistent profile, portals every 2 to 5 minutes, all with
jitter. That stays under a few hundred requests an hour in total.

## Agent pipeline

1. **Ingest.** Poll results and alert emails become Listings. New or changed
   ones emit `listing.new` or `listing.changed`.
2. **Normalise.** PDOK geocoding for postcode, coordinates and municipality.
   Price parsed with service costs noted. Dutch and English field names mapped.
3. **Cluster.** Attach to an existing Property or create one.
4. **Hard filters.** Region (municipality list, PC4 ranges, drawn polygons),
   price, size, rooms, type, furnishing, move-in window, and deal-breakers.
   No AI is spent on a listing that fails here.
5. **Extract and score.** One AI call per surviving property reads the
   description and returns structured requirements (income multiple,
   registration allowed, students allowed, contract type, pets, smoking,
   gender or age restrictions) plus a 0-100 fit score with reasons. Rules
   provide the same fields from keywords when AI is off.
6. **Scam guard.** Rules first: price far below the area median, landlord
   abroad, payment before viewing, keys by post, off-platform contact demanded,
   copied text. The AI verdict adds signals. A likely scam is never contacted
   and is logged; a possible one becomes a task.
7. **Channel router.** Chooses how to reach the property: platform form,
   platform message, agent email, booking link, or none. The **paywall
   router** is part of this step: if the only listing is behind a paid
   feature the user does not have, it looks for the same property on another
   source or on the agency's own site (through the Property cluster and a
   targeted search on the agency name and address) and uses that channel. If
   nothing free exists, it creates a "React manually" task with the message
   ready to copy.
8. **Compose.** The AI writes the first message from the profile, the
   listing, and the user's template, in Dutch when the listing is Dutch
   unless configured otherwise, within the channel's length limit. The
   template alone is used without AI.
9. **Send.** Immediately, inside the send window (default 07:00-23:30;
   outside it the message waits for 07:00), within the daily cap, never twice
   per property. Dry-run records everything and sends nothing.
10. **Triage.** Every inbound message is matched to its application (thread
    headers, sender domain, address in text, platform thread id) and
    classified: `viewing_invite`, `viewing_slots`, `info_request`,
    `documents_request`, `application_form`, `rejection`, `listing_gone`,
    `offer`, `contract`, `payment_request`, `scam_suspect`, `alert`,
    `newsletter`, `other`.
11. **Policy.** Each class maps to an action, configurable:
    - `info_request`: answer from the profile automatically; a question the
      profile cannot answer becomes a task with a drafted reply.
    - `viewing_invite` / `viewing_slots`: pick the earliest slot inside
      availability (with a travel buffer), confirm, add to the calendar,
      push a high-priority notification that can be undone. No fitting slot:
      task with the options.
    - `documents_request`: public documents (the generated tenant profile
      PDF) are sent automatically; private documents (income, enrolment) are
      sent automatically only to a non-suspect agency after a viewing is
      booked; identity documents always need approval.
    - `application_form`: task with the form link and a copy-ready data sheet.
    - `rejection`, `listing_gone`: close the application, no notification.
    - `offer`, `contract`, `payment_request`: task, top priority, never
      answered automatically.
    - `scam_suspect`: task with the signals, no reply.
    - `alert`: fed to ingestion. `newsletter`: archived.
12. **Notify.** Only tasks and wins (viewing booked, offer received) are
    pushed. Quiet hours hold non-urgent pushes.

## Action inbox

The one place a human looks. Task kinds: `viewing_booked` (confirm or cancel),
`reply_needed`, `documents_approval`, `application_form`, `offer_or_contract`,
`payment_warning`, `scam_review`, `react_manually` (paid-only or lottery
source, message prefilled), `reconnect` (session expired), `source_broken`,
`captcha`. Each has a reason sentence, the property card, a deadline when one
is known, and one primary action. Everything the agent did without asking is
in the Activity log, filterable, with the AI rationale for each message it
wrote.

Tasks reach the phone with buttons. Telegram inline buttons (read by long
polling) and ntfy action buttons (posted to a secret reply topic the daemon
subscribes to) both work over outbound connections only, so the phone can
approve, dismiss, snooze or answer a task from anywhere while the daemon stays
bound to localhost. Every button carries an HMAC signature. An optional email
channel sends from the dedicated mailbox, instantly or as a daily digest, to
an address the user chooses.

## Beyond the competition

The competitor research of 2026-09-23 (`docs/research/competitors.md`) found
at least twenty Dutch services selling "alerts within 30 seconds" and a few
that auto-apply (Uprent at EUR 29 a month, Findify, RentHunter). None of them
reads the replies, books viewings, finds a free channel for a paywalled
listing, or can be driven by an agent. Their users' most common complaints are
stale listings, subscription traps, double paywalls, landlords who never
answer, fake listings, duplicate applications, document requests before a
viewing, and rents above the legal maximum. The design answers each:

| Feature | What it does |
|---|---|
| Availability re-check | Confirms the listing is still online right before any message goes out, and before a follow-up |
| Legal-rent check | Estimates the maximum rent under the Dutch point system from free official data (BAG floor area and build year via PDOK, the WOZ value, the EP-Online energy label) and flags listings far above it; always labelled an estimate |
| Fee and deposit flags | Flags mediation fees charged to tenants, deposits above twice the base rent, and key money, in listings and in messages |
| Contract review | Reads an offer or contract (PDF included) and flags illegal or unusual clauses on the offer task |
| Tenant dossier | Documents stored locally with sensitivity levels; identity documents always sent watermarked with the recipient, address and date; a generated one-page tenant profile PDF |
| Follow-up | One polite follow-up after three days without an answer, only if the listing is still online |
| Explained scores | Every match shows the rules and extracted requirements behind its score; Dutch listings summarised in the user's language |
| Multiple named searches | For example rooms in Delft up to EUR 750 and studios in Rotterdam up to EUR 1,100, each with regions, polygons and PC4 ranges; a portal's own search URL can be imported |
| Household and group search | Co-applicants' incomes count in requirement checks and are mentioned in messages |
| Commute scoring | Minutes by bike, foot, transit or car to the places that matter |
| Applications board | Every pursuit by status, with reaction time and next follow-up; "I found a place" withdraws every open application politely and pauses the agent |
| Call now | A push with a call button when a very strong match lists a phone number |
| Adaptive polling | Shorter intervals in the hours a source actually publishes, learned from the tool's own data; floor polling for first-come-first-served portals |
| Measured speed | Median reaction time per source and freshness per source, shown on the dashboard, so the speed claim is a measurement |
| Agency memory | Reply rate and reply time per agency, and message-variant results |
| Registrations tracker | Social-housing registrations with waiting time and renewal reminders |
| Prompt-injection and loop guards | Listing and email text is always treated as data; actions are decided by the policy table, never by model output; auto-replies are never answered and every conversation has a daily reply cap |
| AI disclosure line | Optional sentence saying the message was drafted with an assistant, off by default |

## AI layer

`packages/ai` defines `AiProvider` with five operations: `extract` (listing to
requirements and score), `compose` (first message), `classify` (inbound
message to intent and entities such as proposed slots), `reply` (answer an
info request from the profile), and `reviewContract`. Two providers:

- **Claude** via `@anthropic-ai/sdk`, structured outputs validated by zod, the
  profile and instructions in a cached system prefix so repeated calls read it
  from cache. Model per operation is configurable; the default is
  `claude-opus-5` with low effort for `extract` and `classify` and medium for
  `compose` and `reply`. A monthly token budget stops AI calls (falling back to
  rules) when reached.
- **Rules**: keyword extraction, template composition, regex classification.
  Always available, used when no key is set, when the budget is reached, and
  as the fallback on any API error.

A deterministic **demo** provider serves demo mode and the e2e tests, so they
never call the API. A small live eval suite runs only when `ANTHROPIC_API_KEY` is set.

## Agent access

- **REST API** under `/api/v1`, described by `/api/v1/openapi.json`, with
  `/api/v1/events` as an SSE stream. Requests need the `X-NLPF-Token` header
  (token in the data directory). The server also checks `Host` and `Origin`,
  so a web page in the user's browser cannot drive it.
- **MCP** via `nlpf mcp` (stdio), which talks to the daemon's API. Tools:
  `status`, `search_listings`, `get_property`, `list_applications`,
  `list_tasks`, `resolve_task`, `list_conversations`, `get_conversation`,
  `draft_message`, `send_message`, `list_viewings`, `get_searches`,
  `update_search`, `get_profile`, `update_profile`, `pause`, `resume`,
  `source_health`, `test_source`, `stats`, `withdraw_all`. Tools that
  contact real people say so in their descriptions, and `withdraw_all` needs
  an explicit confirmation. Resources: the config and the profile.
- **CLI**: every command accepts `--json`.
- **Skill**: `skills/nl-property-finder/SKILL.md` teaches Claude Code the CLI
  and MCP, and `AGENTS.md` at the root explains how to develop in the repo.

## Dashboard

Pages: Overview (live activity feed, today's numbers, median reaction time,
source health strip), Action inbox, Properties (table and map, cluster view
across sources, status per application), Conversations, Viewings (week view
plus ICS link), Sources (health, connect, paid toggles, test now), Search
(filters and region map), Profile and documents (including the generated
tenant profile PDF), Automation (autonomy, policies, templates, window, caps,
dry-run), Settings (AI, mail, notifications, service, API token, MCP snippet).
A first-run wizard walks through profile, search, mail, notifications and
sources. A command palette (Ctrl-K) reaches every action. The header carries
the pause switch and a live connection indicator.

## Visual system, site and logo

Direction **Canal Light**, recorded in `docs/design/canal-light.md` and
`docs/design/site-3d.md` (committed copies of the two design briefs,
including measurements of the ten reference sites and nineteen more in
Solais's league).

- **Idea.** A row of Dutch canal-house gables at dusk. Each lit window is a
  listing the agent found. The logo, the site's 3D centrepiece and the
  dashboard's status light are the same drawing.
- **Logo.** "One window": a stepped gable in solid silhouette with one square
  window, lit orange in colour and knocked out in monochrome. Drawn on a
  16-unit grid so the favicon is pixel-exact.
- **Tokens.** Paper `#F5F2EA` and ink `#13201F` in light, the same street at
  night in dark (`#0C1515`), one dusk gradient (apricot to oranje) reserved
  for the moments that involve the person, six status colours that all pass
  WCAG AA on their tints. Instrument Serif for display, Instrument Sans for UI,
  JetBrains Mono for labels and data, self-hosted.
- **Site.** Solais's grammar (uppercase mono, slash nav, label chips,
  bracketed callouts joined to the 3D by lines, floating data labels, a
  perspective grid, particles, grain, a warm bleed) around "the Street": six
  extruded gables in scratched dark metal, rendered with three.js loaded
  after first paint over an identical poster, a camera that moves with the
  scroll story through ten sections, and GSAP for scroll and text motion.
  It beats the references where it can be measured: LCP under 1.5 s
  throttled (Solais: 4.7 s), zero animation frames at rest (Solais: 305 per
  second), full content without JavaScript, reduced motion honoured, every
  3D hotspot reachable by keyboard. Budget about 190 KB for the first view
  and about 405 KB with 3D, enforced in CI.
- **Dashboard.** Same tokens and type grammar, no WebGL. Home is the Action
  inbox; a live feed column; a pipeline strip; keyboard-first.

## Security and privacy

- Binds to localhost only; token plus Host/Origin checks on every API call.
- Secrets in a 0600 file, redacted in logs and API responses.
- Identity documents are never sent without an explicit click.
- The tool never pays, never signs, never shares a BSN or bank details.
- Everything stays on the machine except: requests to listing sites, mail via
  Gmail, Claude API calls (listing text, inbound messages, the profile), ntfy
  or Telegram pushes (titles only by default), PDOK geocoding (addresses).
  `docs/PRIVACY.md` lists these.

## Testing

- **Unit** (vitest): filters, clustering, scam rules, router, policy table,
  send window, config schema, each adapter's parser against fixtures, alert
  parsers against sample emails, the rule-based AI provider.
- **Integration** (vitest): daemon + fake Netherlands server + fake AI, from
  listing appearance to message received by the fake platform; mailbox
  against GreenMail in Docker (IDLE delivery, SMTP send, threading).
- **E2E** (Playwright): one walkthrough that starts a clean daemon on a temp
  `NLPF_HOME` pointed at the fake Netherlands server and GreenMail, then goes
  through onboarding, a new listing appearing live, the automatic message,
  a landlord reply with viewing slots, the automatic booking, the Action
  inbox, a document approval, pause and resume, source health, and an MCP
  call. It records video and screenshots used in the README and site.
- **Site**: Playwright checks for layout at phone and desktop widths, theme
  toggle, no console errors; Lighthouse performance and accessibility at 95+.
- **Live smoke** (manual, owner setup): each enabled adapter's `test` against
  the real site, read-only.

## Open source

README, LICENSE (MIT, kept), CONTRIBUTING (adding a source, recording
fixtures, running the fake Netherlands locally), SECURITY, CODE_OF_CONDUCT,
CHANGELOG, issue templates (bug, feature, request a source, broken source),
PR template, CI (typecheck, lint, unit, integration, e2e), Pages deploy,
Dependabot. The repository description and topics are updated on GitHub.

## Owner setup

After the build: the owner creates the dedicated Gmail (phone verification
needs a human) and an app password; the implementer configures the mailbox,
creates saved-search alerts and free accounts on the platforms with that
address (pausing for any captcha or login the owner must do), sets up an ntfy
topic, copies the Anthropic key from the meeting-copilot config into
`secrets.env`, runs a profile interview, enables the service, and runs the
live smoke tests. The local folder is renamed last.

## Milestones

The plan (`docs/superpowers/plans/2026-09-23-nl-property-finder.md`) orders
the work in waves:

1. Foundation: workspace, design tokens and logo, core contracts (types,
   config, store, jobs, events, API contract).
2. In parallel: sources runtime, AI providers, agent logic, mail and
   notifications, dashboard, site, CLI and MCP. Then adapters and the sandbox.
3. The daemon that wires everything together, with integration tests.
4. In parallel: the end-to-end walkthrough with media; docs, open-source
   scaffolding and CI.
5. Owner setup with live sources, then rename and publish.

## Risks and honest limits

- Sites change. Fixtures and the alert-email path limit the damage; the
  `source_broken` task makes breakage visible within an hour.
- Some sources block automated reading outright. Those fall back to alert
  emails or to watch-only.
- Speed is bounded by polling. Ninety seconds is polite and still well ahead
  of people refreshing by hand; users can lower it at their own risk.
- Automated contact is against the terms of several large platforms. The
  README says so plainly, every adapter declares it, those adapters default to
  watch-only, and the user opts in per platform knowing the risk is a
  suspended account on that platform.
- Claude costs money per call. The owner's model choice and the monthly budget
  cap control it; no-AI mode costs nothing.

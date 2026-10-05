# Changelog

## Unreleased

## 0.1.13 - 2026-10-05

### Added

- A home that is only on a paid platform is emailed to its agent when the
  listing's photos come from that agent's own website. Huurwoningen hides the
  agent from non-members, but its photos keep the address they were copied
  from. Known so far: CityBird Rentals, Frisia Makelaars and Minor
  Makelaardij. Agents that take reactions on their own website only are left
  out on purpose.

### Fixed

- Email sends again after the computer starts. The agent starts before Wi-Fi
  has an IPv4 address, and the mail library then only ever tried the server's
  IPv6 address: every send failed with ENETUNREACH until a restart. The SMTP
  connection now uses the system resolver on every send and tries IPv4 and
  IPv6 side by side.

## 0.1.12 - 2026-10-01

### Changed

- Dependencies: typescript-eslint 8.71, Anthropic SDK 0.129, MCP SDK 1.31,
  imapflow 2.1.2, mailparser 3.9.31.

## 0.1.11 - 2026-10-01

### Added

- A "Confirm email" inbox item. Lead platforms such as leadflow ask you to
  confirm your email address before the agency sees your reaction; the item
  carries the confirmation link and names the home. The agent does not open
  links from mail itself.

### Fixed

- The status pill no longer says "mail is not connected" while the mailbox is
  connected. An error from startup (no network yet at boot) stayed until the
  agent restarted.
- The activity feed logs the mailbox only when its connection changes, not
  after every five-minute check.
- Log in opens its window when the agent runs as a service that started
  before the desktop session. A window that cannot open is an error on the
  button instead of a message saying it opened.
- Mail that names a street and postcode without a house number ("Rietdijk,
  3082DS") is matched to the one open application there.
- An answer item without a draft starts with Write reply. Send reply used to
  fail with "There is no draft to send". The phone offers Send draft only when
  there is a draft.
- Reaction times read as "2 days" instead of "206570 s".

### Changed

- Dependencies: TypeScript 6.0, vitest 5.0.2, imapflow 2.1.1, nodemailer
  10.0.12, mailparser 3.9.30, hono 4.13.10, TanStack Query 5.104, wouter
  3.11.1, three 0.186.1. TypeScript 7 waits for typescript-eslint to support
  it.

## 0.1.10 - 2026-09-26

### Fixed

- MVGM viewing requests go through: the remark is fitted to the form's
  450-character limit, which silently blocked sending before.
- An inbox item that needs you says what the site asked for, instead of a
  fixed sentence.

## 0.1.9 - 2026-09-26

### Fixed

- A home listed on MVGM or Vesteda and also on a listing platform is applied
  for on the landlord's own portal. A Funda message to MVGM only got "apply on
  our website" back.

## 0.1.8 - 2026-09-26

### Added

- Viewing requests on MVGM (ikwilhuren.nu) and Vesteda: the agent fills the
  application from your profile, keeps the answers the portal remembered from
  your previous application, adds its message as the remark and sends. Log in
  once with `nlpf connect mvgm` and `nlpf connect vesteda`, and make one
  application yourself on each so the portal holds your documents.

## 0.1.7 - 2026-09-26

### Fixed

- A queued home whose listings are all on sources you switched off is skipped
  instead of staying queued.

## 0.1.6 - 2026-09-26

### Fixed

- Resolving a "send it yourself" item settles its application: Dismiss closes
  it as skipped, Mark as sent counts it as contacted. Before, every such home
  stayed open on the board.
- A queued home that no longer matches your searches when checked again is
  skipped instead of staying queued.
- The applications board has a Needs you column; homes waiting on you are no
  longer listed under Replied, and skipped homes are left off.
- The overview says why a source sent nothing (switched off, watch only,
  needs a paid plan, no automatic contact, none sent yet) instead of calling
  every such source watch only.

## 0.1.5 - 2026-09-26

### Added

- `profile.address` and `profile.birthDate`, for application forms that
  require them. First messages leave them out; they are given only when asked.

## 0.1.4 - 2026-09-26

### Fixed

- A captcha item in the inbox opens the listing, with the message ready to
  copy, instead of a login window that failed for sources without a login.

## 0.1.3 - 2026-09-26

### Fixed

- Logins on platforms that use a session-only cookie (Pararius) survive the
  login window closing and the agent restarting: each browser profile keeps
  its session cookies, the way Chrome does with "continue where you left off".

## 0.1.2 - 2026-09-26

### Fixed

- The Pararius login check opens a listing's contact page instead of reading
  the page header. The header check reported a login that had not happened,
  and closed the login window before the login finished.
- The agent reports its real version in `nlpf status` and the dashboard.

## 0.1.1 - 2026-09-26

### Added

- A `confirmation` intent: automatic receipts for your own message (such as
  Funda's "Bevestiging van je reactie") are kept in the conversation and no
  longer land in the inbox as something to answer.
- When a form shows a captcha and the listing names the agency's email, the
  message goes to that address by email. The captcha is never solved.

### Fixed

- Homes drafted during a dry run are contacted once dry run is switched off,
  if they still match your searches. Before, they were never sent.
- Funda messages: the form is filled after Funda's page has taken over, fields
  the page clears are filled again, and a consent banner that returns is
  declined before sending.
- Messages go out one at a time per site, so parallel sessions in one
  browser no longer slow a site's forms until they fail.
- Homes listed only on a source you switched off are no longer evaluated or
  turned into inbox items.

## 0.1.0 - 2026-09-26

The project is rebuilt from FreeKamerBot as nl-property-finder: a local agent
that watches Dutch rental platforms, contacts landlords through the best free
channel, sorts the replies, books viewings inside your availability and leaves
you only the decisions. See `docs/superpowers/specs/` for the design.

### Added

- `profile.job` for a student who also works. Where a listing turns students
  away, the agent applies as a working tenant and introduces the person by the
  job; elsewhere it mentions studies and job. The dashboard profile page and
  the tenant PDF show it.
- Passport is its own document kind. A request for ID, or one that accepts
  either, proposes the ID card; the passport only when a landlord names it.

### Fixed

- `nlpf on` installs the app icon, so the application menu no longer shows a
  generic gear.
- A search that names Den Haag by its official name, 's-Gravenhage, now turns
  on sources that list "den haag".
- Secrets with a backslash or a double quote read back exactly; before, such a
  password came back with escape characters and every login failed.
- Outgoing email sets Reply-To to the sending address, so replies reach a
  +address the mailbox reads even when Gmail rewrites From.
- Claude now sees `profile.job`, and first messages no longer accept anything
  on the person's behalf that the profile does not say.
- A HousingAnywhere login is recognised even when the page's preloaded state
  still says logged out, so `nlpf connect` completes and messaging does not
  stop at a login wall.
- `nlpf connect` on a source without a login (Marktplaats, Vesteda) says so,
  instead of reporting that a login window is opening.

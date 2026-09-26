# Changelog

## Unreleased

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

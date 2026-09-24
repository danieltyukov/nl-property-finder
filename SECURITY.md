# Security

## Reporting

Use GitHub's private vulnerability reporting: the Security tab of
<https://github.com/danieltyukov/nl-property-finder>, then "Report a
vulnerability". That opens a private thread visible only to the maintainers.

This is a side project with no service behind it and no on-call rotation.
Expect a reply in days, not hours. There is no bounty.

## What the agent holds

Everything lives on your machine. There is no server, no account with this
project, and no telemetry.

| What | Where | Why |
| --- | --- | --- |
| Your configuration and profile | `~/.config/nl-property-finder/config.yaml` | What you search for and what the agent may say about you |
| Secrets (Claude API key, mail app password, Telegram token) | `~/.config/nl-property-finder/secrets.env`, mode 0600 | Calling Claude, reading and sending mail, pushing to your phone |
| Listings, conversations, tasks | `~/.local/share/nl-property-finder/nlpf.db` | The agent's memory |
| Logged-in browser profiles | `~/.local/share/nl-property-finder/browser/<source>/` | Staying logged in to the platforms you connected |
| Your documents | `~/.local/share/nl-property-finder/documents/` | Sending them to landlords when the policy or you allow it |
| The API token | `~/.local/share/nl-property-finder/api-token`, mode 0600 | Authenticating the dashboard, the CLI and MCP to the daemon |

On macOS both folders are under `~/Library/Application Support/nl-property-finder/`,
and on Windows under `%APPDATA%\nl-property-finder\`.

Anyone who can read these folders can read your conversations and act as you on
the platforms you connected. Treat them like your mail folder.

## The local API

The daemon listens on `127.0.0.1:7431` only, unless you turn on `server.lan`.
Every request needs the token from `api-token`. The daemon also rejects any
request whose `Host` is not its own address and any request carrying a foreign
`Origin`, so a web page open in your browser cannot drive it, and DNS
rebinding does not help.

## What leaves the machine

- Requests to the rental platforms you enabled, at a low rate.
- Mail through the mailbox you configured (a dedicated one is recommended).
- Claude API calls, when AI is on: listing text, landlord messages and the
  parts of your profile the agent writes from. With AI off, nothing goes to
  Anthropic.
- Push notifications through ntfy or Telegram, when configured. By default
  they carry titles only.
- Address lookups to PDOK and the WOZ and BAG registers for geocoding and the
  rent check.

`docs/PRIVACY.md` goes into each of these.

## What the agent never does

It never pays, signs, or shares a BSN or bank details. Identity documents are
never sent without an explicit click, and are watermarked with the recipient
and date when they are. Text from listings and emails is treated as data, never
as instructions: a landlord cannot talk the agent into doing something the
policy table does not allow.

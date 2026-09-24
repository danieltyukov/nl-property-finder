# Architecture

nl-property-finder is one Node process, the daemon, that runs on your own
computer. Everything else is a client of it: the dashboard in your browser, the
`nlpf` command, and the MCP server that Claude talks to. There is no server
anywhere else.

## The pieces

    apps/daemon       the background service: scheduler, job runner, pipelines, HTTP API, event stream
    apps/dashboard    React UI, served by the daemon at http://127.0.0.1:7431
    apps/cli          nlpf: init, on, off, pause, connect, doctor, sources, tasks, mcp, demo
    packages/core     types, the config schema, the SQLite store, the job queue, the event bus, the API contract
    packages/sources  the adapter SDK, polite fetching, the browser pool, every built-in source, the agency YAML adapter
    packages/agent    pure decisions: clustering, filters, requirements, scam signals, routing, policy, viewing slots, rent check
    packages/ai       the AiProvider interface with a Claude implementation, a rules implementation and a demo one
    packages/mail     the dedicated mailbox over IMAP IDLE and SMTP, and parsers for platform alert emails
    packages/notify   ntfy, Telegram, email and desktop notifications, and the two-way button channels
    packages/sandbox  the fake Netherlands: a fake platform, a fake estate agent and a landlord simulator
    packages/design   Canal Light tokens, fonts and the logo, shared by the dashboard and the site

The dependency direction is one way. `core` depends on nothing of ours. The
packages depend on `core`. The daemon depends on the packages. The dashboard,
CLI and MCP depend only on `core`'s API contract and talk HTTP to the daemon.

## Where a listing goes

1. **Ingest.** The scheduler enqueues a `poll` job per source when it is due
   (60 to 180 seconds, with jitter, faster in the hours that source usually
   publishes). The runner runs at most one job per source at a time. An
   adapter returns `RawListing`s; alert emails from the dedicated mailbox
   produce the same shape. Each is normalised and upserted; a new one emits
   `listing.new`.
2. **Cluster.** The same home on Funda, Pararius and the agent's own site
   becomes one `Property`, keyed by postcode, house number and addition when
   known, and by a fingerprint of street, price band and size band when not.
   A property is contacted at most once, whatever the number of listings.
3. **Evaluate.** Hard filters first, per named search: region (municipality,
   postcode ranges, drawn polygons), price with or without service costs,
   size, rooms, type, furnishing, move-in date, deal-breakers. Only a passing
   property costs an AI call, which extracts requirements (income multiple,
   registration, students, contract type) and scores the fit. The scam guard,
   the fee flags and the legal-rent estimate run here too.
4. **Contact.** The channel router picks the fastest free way to reach the
   landlord across every listing of the property: a guest form, a form after
   login, a platform message, the agent's email. When the only copy is behind
   a paid feature the user does not have, it looks for another copy (the
   paywall router), and when there is none it opens a "react manually" task
   with the message ready. The listing is re-checked right before sending.
5. **Triage.** Every reply, by email or platform message, is matched to its
   conversation (mail headers, platform thread, sender, the address in the
   text) and classified. The policy table decides: answer routine questions
   from the profile, book a viewing slot inside your availability, send
   documents the policy allows, close the application on a rejection, or open
   a task. Offers, contracts and payment requests always become tasks.
6. **Notify.** Only tasks and wins go to your phone, with buttons that work
   from anywhere without exposing the daemon.

## State

One SQLite database (`nlpf.db`) holds listings, properties, matches,
applications, conversations, messages, tasks, viewings, source health, the
event log and the job queue. Every table has a few indexed columns and the
full object as JSON. Jobs are keyed (`contact:<property>`), so a restart never
repeats one; a `contact` job interrupted mid-run is never retried
automatically, because the form may already have been submitted, and becomes a
task asking you to check.

Configuration is `config.yaml`, validated by a zod schema whose JSON Schema
sits next to it for editor autocompletion. A bad edit never stops the agent: it
keeps the last good configuration and opens a task naming the field.

## The API

`http://127.0.0.1:7431/api/v1`, described by `/api/v1/openapi.json`. Every
request needs the token from the `api-token` file. The daemon checks the
`Host` header (against DNS rebinding) and the `Origin` header (against other
web pages in your browser). `/api/v1/events` is a server-sent event stream
with `Last-Event-ID` replay, which is what the dashboard's live feed reads.

## Speed

The target is a message sent within 60 seconds of the agent first seeing a
matching listing. The measured median reaction time per source is on the
dashboard's Overview, so the claim is a measurement, not a promise.

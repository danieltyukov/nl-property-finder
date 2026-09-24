# Contributing

Bug reports, new sources and patches are welcome. There is no CLA. Match the
code that is already there.

## The most useful contribution: a source

Most Dutch rental homes are listed by estate agents on their own websites,
and most of those websites run on a handful of systems. Adding one is usually
a YAML file:

1. Copy `examples/agencies/_template.yaml` to `examples/agencies/<agency>.yaml`.
2. Set the listing page URL and, if the site runs on Realworks, Kolibri or
   OGonline, the matching `preset`, which fills in the selectors for you.
3. Record a fixture: `npm run record -- agency:<agency>`.
4. Run `nlpf sources test agency:<agency>` and check that the listings, prices
   and sizes look right.
5. Open a pull request with the YAML file and the fixture.

A platform with its own search API or an unusual site gets a small TypeScript
adapter in `packages/sources/src/adapters/`. `docs/ADAPTERS.md` walks through
one from start to finish: the `SourceAdapter` interface, parsing, contact,
recording fixtures and the tests a pull request needs.

Every adapter declares what the platform's terms say about automated access
(`terms: allows | forbids | unknown`). Be honest there: it decides whether the
agent messages landlords on that platform by default.

## Layout

    apps/daemon        the background service: scheduler, runner, pipelines, API
    apps/dashboard     React 19 and Vite
    apps/cli           nlpf, including the MCP server and the service installers
    packages/core      types, config schema, store, jobs, events, the API contract
    packages/sources   adapters, polite fetching, the browser pool
    packages/agent     pure decision logic
    packages/ai        Claude, rules and demo providers
    packages/mail      IMAP and SMTP, alert-email parsers
    packages/notify    ntfy, Telegram, email, desktop
    packages/sandbox   the fake Netherlands for demo mode and tests
    packages/design    tokens, fonts, logo
    site/              the project site
    e2e/               the Playwright walkthrough

`packages/core` is the contract everything else agrees on. A change there ripples
through every package, so it deserves its own pull request with a clear reason.

## Running the tests

```
npm ci
npm run lint
npm run typecheck
npm test                    # unit tests, offline, seconds
npm run test:integration    # the sandbox, the daemon, and GreenMail in Docker
npm run test:e2e            # Playwright against demo mode
```

Playwright needs Chromium once: `npx playwright install --with-deps chromium`.
The integration tests need Docker for the GreenMail mail server.

No test ever touches a live website. Adapters are tested against recorded
fixtures; `NLPF_LIVE=1` enables the few live checks that exist, and CI never
sets it.

## Running it

`npm run demo` starts the daemon against the sandbox with a demo profile and
opens the dashboard. Listings appear, messages go out to the fake platform,
and the simulated landlord answers, so every part of the product can be tried
without an account.

`npm run nlpf -- <command>` runs the CLI from source against your real setup.

## Style

- TypeScript strict mode, ESM, no default exports in libraries.
- Comments explain why, in full sentences.
- No emojis, and no em or en dashes, in code, comments, docs, UI text or commit
  messages.
- Commit messages start with `feat:`, `fix:`, `docs:`, `test:` or `chore:` and
  describe the change.

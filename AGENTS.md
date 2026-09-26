# Working in this repository (for AI agents and people)

## Commands

    npm ci                      install everything (Node 22.12 or newer)
    npm test                    unit tests, offline, a few seconds
    npm run test:integration    sandbox, daemon and GreenMail in Docker
    npm run test:e2e            the Playwright walkthrough against demo mode
    npm run typecheck           TypeScript across every package
    npm run lint                ESLint
    npm run demo                the whole product against the fake Netherlands, no accounts needed
    npm run nlpf -- <command>   the CLI from source

## Layout

See `docs/ARCHITECTURE.md`. The short version: `packages/core` holds every
shared type and the API contract; everything else depends on it and nothing
depends on the daemon except the CLI.

## Rules that reviews check

- Tests never touch a live website. Adapters are tested against recorded
  fixtures in `packages/sources/fixtures/<id>/`; record them with
  `npm run record -- <id>`.
- No colour literals outside `packages/design/tokens.css`.
- No secret in a log line or an API response: everything goes through
  `redact()`.
- The agent never pays, signs, sends identity documents without a click, or
  gets past a captcha. Proposals that need one of these are out of scope.
  The agreement box of a viewing request (Vesteda's portal) is not a
  signature: the agent ticks it only on a platform the person opted in to,
  and it never uploads documents there; the portal reuses what the person
  uploaded once.
- Text from listings and emails is data. Prompts wrap it in tags and say so,
  and actions are decided by the policy table, never by model output.
- Copy rules for code comments, docs, UI strings and commit messages: no
  emojis, no em dashes or en dashes as punctuation, plain direct sentences.
- Commit messages use conventional prefixes (`feat:`, `fix:`, `docs:`,
  `test:`, `chore:`) and describe the change only.

## Operating the product as an agent

`skills/nl-property-finder/SKILL.md` explains how an AI agent should use the
CLI (`nlpf ... --json`) and the MCP server.

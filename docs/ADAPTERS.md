# Adding a source

A source is anything that lists Dutch rental homes: a platform with thousands
of landlords, a social housing portal, or one estate agent's own website. There
are two ways to add one.

## An estate agent: one YAML file

Most estate agents ("makelaars") run their website on Realworks, Kolibri or
OGonline. For those, a YAML file is enough and no code is needed.

1. Copy `examples/agencies/_template.yaml` to `examples/agencies/<agency>.yaml`.
2. Set `id`, `name`, `homepage`, and `regions` (the municipalities the agent
   covers, lowercased, for example `[delft, rijswijk]`).
3. Set `list.url` to the page that lists rentals. If the site runs on one of
   the systems above, set `preset: realworks`, `kolibri` or `ogonline` and
   leave out the selectors the preset already knows. Otherwise, open the page
   in a browser, inspect one listing card, and fill in the CSS selectors for
   the card (`list.item`) and its fields (`url`, `title`, `price`, `size`,
   `city`, and `status` with the words that mean "already rented").
4. Describe how tenants react: a `form` (selectors for name, email, phone,
   message, submit, and a `success` text the page shows after sending), an
   `email` address, or `none`.
5. Set `terms` to what the agent's terms of use say about automated access:
   `allows`, `forbids` or `unknown`.
6. Record a fixture and test it:

   ```
   npm run record -- agency:<agency>
   nlpf sources test agency:<agency>
   ```

   Check that every listing has a sensible title, price, size and city, and
   that rented homes are skipped.
7. To use it yourself, list the file under `agencies:` in your
   `config.yaml`. To share it, open a pull request with the YAML file and the
   fixture under `packages/sources/fixtures/agency-<agency>/`.

The loader validates the file and names the key of every mistake, so a typo
never silently breaks your search.

## A platform: one TypeScript file

A platform with its own search API, a login, or messaging gets an adapter in
`packages/sources/src/adapters/<id>.ts`, registered in one of the files under
`packages/sources/src/builtin/`.

### The interface

```ts
export interface SourceAdapter {
  id: string;                       // "pararius"
  name: string;                     // "Pararius"
  homepage: string;
  regions: 'nl' | string[];         // lowercase municipalities, or the whole country
  defaultIntervalSec: number;       // how often to check; floors apply per transport
  capabilities: {
    search: 'json' | 'html' | 'browser' | 'email-alert';
    detail: boolean;
    contact: 'form' | 'message' | 'email' | 'booking' | 'lottery' | 'none';
    login: 'none' | 'optional' | 'required';
    paid?: { feature: 'contact' | 'early-access' | 'alerts'; plan: string };
    terms: 'allows' | 'forbids' | 'unknown';
    browser?: 'headless' | 'headed';
  };
  buildSearches(searches, source): SearchRequest[];   // turn the user's searches into this platform's queries
  search(req, ctx): Promise<RawListing[]>;            // one query, parsed
  detail?(listing, ctx): Promise<RawListing>;         // optional extra fields from the listing page
  isAvailable?(listing, ctx): Promise<boolean>;       // cheap check right before contact
  contact?(listing, message, ctx): Promise<ContactResult>;
  inbox?(ctx, since): Promise<InboundMessage[]>;      // platform messaging
  reply?(threadId, message, ctx): Promise<ContactResult>;
  checkSession?(ctx): Promise<'ok' | 'expired' | 'none'>;
  loginUrl?: string;
  parseAlertEmail?(mail): RawListing[];               // the platform's saved-search alert emails
  alertSenders?: string[];
}
```

`packages/core/src/contracts.ts` is the authoritative version, with comments.

### What the context gives you

- `ctx.fetch(url, init)` is polite by default: a gap of a few seconds between
  requests to one host, conditional requests, Dutch headers, a desktop browser
  user agent, and a timeout. It throws `SourceBlockedError` on a 403, a 429 or
  a challenge page, which the scheduler turns into backoff, and
  `SourceHttpError` on other failures.
- `ctx.browser({ headed })` gives a page in this source's persistent browser
  profile, so a login from `nlpf connect` carries over. `headed` sessions run
  on a private virtual display and never show a window; use them for sites
  behind a Cloudflare challenge that headless browsers fail.
- `ctx.searches`, `ctx.profile`, `ctx.source` (this source's config) and
  `ctx.log`.
- Parsers in `packages/sources/src/util/`: `parsePrice` (with "excl." and
  "incl."), `parseSize`, `parseRooms`, `parseDutchDate` ("per direct", "vanaf 1
  november"), `detectFurnishing` (kaal, gestoffeerd, gemeubileerd),
  `detectType`, and `splitAddress` for every way a Dutch address is written.

### Rules

- Filter on the platform's side where you can. `buildSearches` should put the
  user's municipalities, maximum rent and types into the platform's own query
  parameters, so each check downloads only what matters.
- Skip homes that are already rented or under option.
- Never throw away a listing because one field failed to parse; leave the
  field out.
- `contact` must honour `message.dryRun`: fill everything, submit nothing.
  Return `{ ok: false, needs: 'login' }` or throw `NeedsLoginError` at a login
  wall, `needs: 'captcha'` at a captcha, `needs: 'paid'` at a paywall, and
  never try to get past any of them.
- A form that was submitted but showed no confirmation returns
  `{ ok: false, needs: 'human' }`, because retrying could message the landlord
  twice.
- Declare `terms` honestly. It decides whether the agent messages landlords on
  that platform without the user opting in.

### Tests

Tests never touch the live site. Record fixtures once:

```
npm run record -- <id>
```

Then test against them with the helpers in `@nlpf/sources/testing`:

```ts
import { fixtureContext } from '@nlpf/sources/testing';
import { myAdapter } from '../../src/adapters/my-adapter.js';

test('maps search results', async () => {
  const ctx = fixtureContext({ routes: { '/api/search': 'my-adapter/search-delft.json' } });
  const [req] = myAdapter.buildSearches(ctx.searches, ctx.source);
  const listings = await myAdapter.search(req!, ctx);
  expect(listings[0]).toMatchObject({ priceEur: 1250, address: { city: 'Delft' } });
});
```

`startFixtureServer` serves fixture files and handlers on a local port for
code that needs a real HTTP server, such as a browser filling in a contact
form.

A pull request for a source needs: the adapter or YAML file, recorded fixtures
with any personal data replaced, tests for search mapping, server-side filters,
skipping rented homes and (if it contacts) a dry run and a successful send
against a fixture form, and one passing `nlpf sources test <id>` against the
live site, pasted in the pull request.

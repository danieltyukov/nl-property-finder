# Agency files

Many rental homes are only on the estate agent's own website, or appear there
first. An agency file teaches nl-property-finder to read one agent's site: where
the rental list is, how to pick out each listing, and how to contact the agent.
No code is needed.

## Adding an agent

1. Copy `_template.yaml` to a new file, for example `de-gracht.yaml`, and put
   it in your config folder (`~/.config/nl-property-finder/` on Linux).
2. Change `id`, `name`, `homepage` and the selectors to match the agent's site
   (see "Finding selectors" below).
3. List the file in `config.yaml`, relative to the config folder:

   ```yaml
   agencies:
     - de-gracht.yaml
   ```

The agent becomes a source called `agency:de-gracht`. It is polled every five
minutes unless you set `intervalSec` (at least 60). If a file has a mistake,
that file is skipped, the other agents keep running, and the error names the
file and the key, for example `list.item: is required`.

## Presets

Many agents run their website on the same backend. Name the backend and you
can often leave out the list URL and every selector:

```yaml
id: voorbeeld-makelaars
name: Voorbeeld Makelaars
homepage: https://www.voorbeeld-makelaars.nl
preset: realworks
regions: [delft]
```

| Preset | How to recognise the site | Status |
|---|---|---|
| `realworks` | Pages under `/aanbod/woningaanbod/huur/`, images from `images.realworks.nl` | Cards, detail page and contact form checked on a live site |
| `ogonline` | `/nl/realtime-listings/consumer` returns JSON; the HTML loads `s1.ogonline.nl` | JSON fields checked on five live sites; no contact form preset |
| `kolibri` | Kolibri makelaar websites | Not checked on a live site yet. Broad selectors to start from; record a page and adjust |

Anything you write in the file wins over the preset, so you can fix one
selector and keep the rest.

## The file, key by key

| Key | Meaning |
|---|---|
| `id` | Lowercase letters, digits and dashes. The source id is `agency:<id>`. |
| `name`, `homepage` | Shown in the dashboard and used as the agent's name and site on every listing. |
| `regions` | Municipalities the agent covers, lowercased. The agent is polled when one of your searches covers one of them, or when you list it under `sources` in `config.yaml`. Leave it out for agents that cover the whole country. |
| `preset` | `realworks`, `kolibri`, `ogonline` or `none`. |
| `intervalSec` | Seconds between polls. Default 300. |
| `list.url` | The rental list page, newest first if the site offers that. A list of URLs is allowed. |
| `list.format` | `html` (default) or `json` for sites that serve a JSON list. |
| `list.item` | CSS selector matching one listing card (HTML). |
| `list.items` | Dotted path to the array of listings (JSON). Leave it out when the response is the array. |
| `list.fields` | Where each value is. `url` is required; the others are `title`, `street`, `address`, `postcode`, `city`, `price`, `size`, `rooms`, `bedrooms`, `type`, `furnishing`, `availableFrom`, `status`, `image`, `publishedAt`, `lat`, `lon`, `description`, `energyLabel` and `externalId`. |
| `list.filters` | Extra conditions every listing must meet, for example `[{ path: isRentals, require: [true] }]`. |
| `list.next`, `list.maxPages` | Selector of the "next page" link and how many pages to read (default 3). New listings are usually on page one. |
| `detail.description`, `detail.images` | Read from the listing's own page when the agent opens it. |
| `detail.status` | Status on the listing page. With `exclude` it decides whether a listing is still available right before contacting. |
| `detail.fields` | More fields from the listing page; they only fill what the card did not show. |
| `contact.kind` | `form` (the agent's web form), `email`, or `none`. |
| `contact.url` | The page with the form. `{url}` is the listing URL, `{id}` its id, `{homepage}` the agent's homepage. |
| `contact.form` | Selectors for `name` (or `firstName` and `lastName`), `email`, `phone`, `subject`, `message`, checkboxes to tick under `check`, an `open` button for forms behind a tab, `submit`, and `success`: the text that shows after sending. |
| `contact.email` | The agent's rental address. Used for `kind: email`, and as a fallback when the form cannot be used. |
| `terms` | What the agent's website terms say about automated access: `allows`, `forbids` or `unknown`. With `forbids` the agent is watched but not contacted until you opt in. |

A field is either a selector string or a mapping:

```yaml
price: ".object-price"                                  # the text inside the element
url: { selector: "a", attr: href }                      # an attribute instead of the text
image: { selector: "img", attr: "data-src|src" }        # first attribute that has a value
status: { selector: ".status", exclude: [verhuurd, "onder optie"] }   # skip rented cards
rooms: { selector: ".features", pattern: "(\\d+) kamers" }            # first group of a regex
price: { path: "price.amount" }                         # JSON: a dotted path
furnishing: { path: isFurnished, map: { "true": gemeubileerd } }      # replace a value
```

Prices such as "€ 1.250,- per maand excl.", sizes such as "42 m²", dates such
as "per direct" or "beschikbaar vanaf 1 november" and Dutch addresses such as
"Oude Delft 12-A, 2611 BC Delft" are read for you, so a selector only has to
find the right element.

## Finding selectors

1. Open the agent's rental page in your browser, right-click a listing and
   choose Inspect.
2. Find the element that wraps one whole listing. Its class name, for example
   `.object`, is `list.item`.
3. Inside it, find the link to the listing, the price, the size, the city and
   the status label. Prefer short class names over long generated paths.
4. Open one listing and do the same for the description, the photos and the
   contact form fields.

Then check the file against the live site once with the recorder. It saves the
pages it reads and prints the first listing it parsed:

```sh
npx tsx packages/sources/scripts/record.ts agency:de-gracht --agencies ~/.config/nl-property-finder
```

In a dry run (`automation.dryRun: true` in `config.yaml`) the contact form is
filled and not submitted, so you can try an agent without writing to it.

## Contributing an agent

Add the YAML file to this folder and a recorded list page under
`packages/sources/fixtures/agency-<id>/`, with a test in
`packages/sources/test/` that parses it (see `agency.test.ts`). Remove anything
personal from recorded pages, such as names or phone numbers of private
landlords, before committing.

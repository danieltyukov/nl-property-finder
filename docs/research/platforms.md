# nl-property-finder: Dutch rental platform capability matrix

> Raw probe outputs and working files mentioned below under `scratchpad/` were not committed; the findings they support are recorded here.

Research date: 2026-09-23. Probed from a Linux laptop in NL (Cloudflare edge AMS).

How claims are marked:

- **VERIFIED**: seen today from this machine (curl with a Chrome 140 desktop UA, or Playwright 1.63 with Chromium r1243). Nothing was submitted, no accounts were created, no logins were attempted.
- **REPORTED**: taken from official help/pricing/ToS pages (sometimes via Wayback snapshots, because the live pages block fetchers), from web search, or from open-source repos. It was not reproduced here.

Probe setup (VERIFIED): `curl -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"` plus `Accept-Language: nl-NL`. Browser probes used Playwright `chromium.launch()` in two modes: new-headless (`channel: 'chromium'`) and headed under `xvfb-run` (no visible window).

Contents:

1. Key findings
2. Summary table
3. Anti-bot and browser strategy
4. Per-platform details (endpoints, selectors)
5. Pricing, login and ToS
6. Generic backend adapters (Zig, Embrace, OGonline, Realworks, Pararius family)
7. Email alerts as a second channel
8. Existing open-source projects
9. Recommended adapter tiers

---

## 1. Key findings

1. **Headless Chromium is not enough for the Cloudflare sites, but headed Chromium under Xvfb is.** Pararius, Huurwoningen.nl, Kamer.nl and Xior return a Cloudflare managed challenge (`403`, `cf-mitigated: challenge`) to curl. New-headless Chromium stays stuck on "Even geduld...". Headed Chromium under `xvfb-run` got `200` on the first request for all four (VERIFIED). OSS repos report the same thing: `cf_clearance` is bound to the TLS fingerprint, so a cookie cannot be handed from the browser to undici, and one headless run can taint a profile (REPORTED).
2. **Holland2Stay is the hardest target.** It shows an **interactive Turnstile checkbox** even in headed mode (VERIFIED, screenshot). According to OSS reverse-engineering (REPORTED), its data API also moved to an encrypted `POST /api/__enc__` envelope with an operation whitelist and a second site-clearance cookie. It needs a human-in-the-loop browser session.
3. **Many high-value sources have open JSON that works with plain curl** (VERIFIED):
   - Kamernet `POST /services/api/listing/findlistings`
   - HousingAnywhere public Algolia key
   - Marktplaats `GET /lrp/api/search`
   - Vesteda `POST /api/units/search/facet`
   - SSH `GET /api/v1/offer`
   - Woonnet Rijnmond Embrace GraphQL
   - every **Zig portal** (Woonnet Haaglanden, RoomMatch/DUWO, Plaza, Huren in Holland Rijnland and more) via `getallobjects`
   - every **OGonline** agent site via `/nl/realtime-listings/consumer` (verra.nl alone lists 655 rentals)
4. **Funda is the best free auto-contact channel.**
   - The contact form at `/makelaar-contact/?listingId=` is a **guest form with no login** (fields VERIFIED, not submitted).
   - The SSR search page works with plain curl today (JSON-LD `ItemList` plus cards, newest-first).
   - The mobile/OpenSearch search API is closed: `401 no token provided` (VERIFIED). OSS repos attribute this to Firebase App Check since 2026-08-18 (REPORTED).
   - The detail JSON `listing-detail-summary.funda.io` still answers curl (VERIFIED).
5. **Pararius is free to react but needs an account.** `/contact/{uuid}` redirects to `/inloggen` (VERIFIED). Login is Google, Facebook or email+password (VERIFIED). Free alerts are daily only; instant alerts need Pararius+ at EUR 29.95/month (REPORTED). So scraping is the only free fast channel.
6. **Paywalled reaction platforms**:
   - Kamernet Premium (2 weeks EUR 29, 4 weeks EUR 39, 12 weeks EUR 79; REPORTED)
   - Huurwoningen.nl Premium EUR 29.95/month (REPORTED; free Basic cannot react)
   - Kamer.nl EUR 29.95/month (VERIFIED)
   - HousingAnywhere NL messaging subscription (EUR 26 for 2 weeks to EUR 68 for 3 months; REPORTED 2024 prices)
   - Huurzone EUR 29/month (REPORTED)
   - Directwonen (paid, VERIFIED payment links)
   - Huurstunt Premium (VERIFIED text)
   - NederWoon paid account (REPORTED)

   Ingest these for discovery and dedupe. Auto-react only if the user has paid.
7. **Speed-critical allocation models** (first-come-first-served):
   - Funda, Pararius and agent forms (landlords often stop reading after the first dozens of replies)
   - Interhouse (explicitly FCFS)
   - Holland2Stay "Book directly"
   - Zig `reactiedatum` (icon `br_dth`, VERIFIED on RoomMatch and Plaza)
   - Woonnet Haaglanden "Eerste reageerder"
   - ROOM "Direct offer"

   Waiting-time and lottery models only need "react before the deadline".
8. **Dead or irrelevant**:
   - `jaap.nl` does not resolve (VERIFIED); offline since early 2024 (REPORTED).
   - `vbo.nl` redirects to a host with an expired TLS certificate (VERIFIED).
   - `uitzicht.nl` is an eye-research fund consortium (VERIFIED).
   - Stekkies and Rentbird are paid alert services, not sources. Their 30-second claim sets the latency bar.
9. **ToS**: Pararius, Huurwoningen, Funda, Kamernet, HousingAnywhere, Vesteda, Marktplaats and Holland2Stay all explicitly forbid scraping or automated access (REPORTED quotes in section 5). Holland2Stay explicitly forbids automated bookings. Design the tool as a personal, low-rate, single-user assistant with auto-react opt-in per platform.

---

## 2. Summary table

Anti-bot legend:

- **CF-MC**: Cloudflare managed challenge (curl 403, headless fails, headed Chromium passes)
- **CF-TS**: interactive Turnstile (fails even headed)
- **CF**: served via Cloudflare without a challenge
- **AK**: Akamai Bot Manager cookies present
- **none**: no bot wall seen

"VERIFIED" in a cell means verified today. Everything else in the contact, login and paid columns is REPORTED (section 5).

| Platform | Ingestion method | Anti-bot (curl) | Contact method | Login to react | Paid to react | Priority |
|---|---|---|---|---|---|---|
| Pararius | HTML cards via headed Chromium; `/sinds-1` path filter | CF-MC (VERIFIED) | Message form (VERIFIED login redirect); some listings are clickouts to agent sites | Yes: Google, Facebook, email+pw (VERIFIED) | No (Pararius+ optional) | High |
| Funda (huur) | SSR JSON-LD `ItemList` + card HTML via curl; detail JSON `listing-detail-summary.funda.io` | AK, HTML 200 (VERIFIED) | Guest form: message, email, first/last name, phone (VERIFIED) | No (VERIFIED) | No | High |
| Kamernet | JSON `POST /services/api/listing/findlistings` (VERIFIED) | none | In-platform message | Yes: email+pw, Facebook, Google | Yes: Premium EUR 29 / 2 weeks | High (rooms) |
| HousingAnywhere | Public Algolia query (VERIFIED) or SSR hydration JSON | none | Message, then book | Yes: email+pw, Google, Apple (VERIFIED) | Yes for NL: EUR 26-68 subscription | Medium |
| Huurwoningen.nl | Same card parser as Pararius, headed Chromium (VERIFIED) | CF-MC | Premium message | Yes: Google, Facebook, email+pw | Yes: EUR 29.95/month | Medium (ingest; mostly duplicates) |
| Kamer.nl | JSON-LD `ItemList` via headed Chromium (VERIFIED) | CF-MC | Premium reaction by email relay | Yes: email+pw, Google | Yes: EUR 29.95/month (VERIFIED) | Low-Medium |
| 123Wonen | SSR HTML `.pandlist-container` via curl (VERIFIED) | none | "Meer informatie aanvragen" form or email | No | No | Low-Medium |
| Rotsvast | WordPress HTML `/huren/` `.card--house` via curl (VERIFIED) | none | Listing contact form | No | No | Low |
| Vesteda | JSON `POST /api/units/search/facet` via curl (VERIFIED) | none | "Inschrijven" with an account at hurenbij.vesteda.com; landlord selects | Yes: email+pw | No | Medium (mid-rent) |
| Holland2Stay | In-page fetch or DOM in a human-cleared browser; legacy GraphQL CF-blocked (VERIFIED) | CF-TS (VERIFIED) | "Book directly" FCFS + weekly Tuesday 17:00 lottery | Yes | EUR 29.50 registration + EUR 200 booking fee | High (students), hard |
| NederWoon | HTML `/search?city=` via curl (VERIFIED) | CF | Account, viewing booking | Yes: email+pw, Facebook | Yes: paid account, regional price | Low-Medium |
| Interhouse | WordPress HTML `?offer=huur&sort=date-desc` (VERIFIED) | none | Viewing form, FCFS | No | No | Low-Medium |
| MVGM (ikwilhuren.nu) | SSR HTML `/aanbod/` via curl (VERIFIED) | none | React with a free account | Yes: email+pw | No (Plus EUR 36/year for instant alerts) | Medium |
| Rebo | Nuxt HTML, headed Chromium (Vercel 429 to curl, VERIFIED) | Vercel checkpoint | MyProperty account | Yes | No (alerts EUR 34.95/year) | Low (east NL) |
| Van der Linden | MODX HTML `/woning-huren/` via curl (VERIFIED) | BitNinja WAF, 200 | Free woondossier account | Yes | No | Low-Medium (Amsterdam) |
| VBO / Vastgoed Nederland | HTML `vastgoednederland.nl/huurwoningen` (VERIFIED) | none; old host has expired TLS | Agent phone/email | No | No | Low |
| Huurzone | JSON-LD `RealEstateListing` list via curl (VERIFIED) | CF | Premium | Yes: Google, Facebook, email+pw | Yes: EUR 29/month | Low (re-aggregator) |
| Jaap.nl | DEAD (DNS, VERIFIED) | - | - | - | - | None |
| Marktplaats | JSON `GET /lrp/api/search` via curl (VERIFIED) | none (CloudFront) | In-app chat | Yes: Google, email+pw (VERIFIED) | No | Medium (rooms; scam filter needed) |
| Facebook groups | Manual only | login wall | Messenger/comments | Yes | No | Manual |
| DUWO | Offers published on RoomMatch (VERIFIED link on duwo.nl) | none | Portal reaction via ROOM login | Yes: email+pw | EUR 35 one-time (ROOM) | High (TU Delft) |
| ROOM.nl | Registration/SSO only; not a listing source (VERIFIED bundle) | none | - | Yes, optional 2FA | EUR 35 one-time, valid 8 years (VERIFIED amount) | Gatekeeper |
| RoomMatch.nl | Zig JSON `getallobjects` via curl (VERIFIED, 129 objects) | none | Portal reaction, max 5 open | Yes (ROOM) | via ROOM | High |
| WoningNet (DAK) | OutSystems `DataActionHaalUitgelogdAanbod` (VERIFIED in browser) | none | Portal reaction | Yes | Not found | Medium (Utrecht/Amsterdam) |
| Woonnet Haaglanden | Zig JSON via curl (VERIFIED, 246 objects, Delft 34) | none | Portal, max 2 active | Yes | EUR 14 (iDEAL) / EUR 12.50 (direct debit) per year | Medium |
| Woonnet Rijnmond | Embrace GraphQL via curl (VERIFIED) | none | Portal; DirectKans 20:00-20:15 window then lottery | Yes | EUR 15 + EUR 10 renewal (2024) | Medium |
| SSH | JSON `GET sshxl.nl/api/v1/offer` via curl (VERIFIED) | none | Portal (hospiteren/viewing), ROOM login | Yes | EUR 35 (ROOM) | Medium (Utrecht) |
| Plaza | Zig JSON + `mosaic-plaza-aanbodapi.zig365.nl` via curl (VERIFIED) | CF | Portal, mostly `reactiedatum` FCFS | Yes | EUR 27.50/year | Medium (Delft/Utrecht studios) |
| Huren in Holland Rijnland | Zig JSON via curl (VERIFIED, 60 objects) | none | Portal | Yes | Not found | Medium (Leiden) |
| Stadswonen Rotterdam | Next.js HTML `a[href^="/aanbod/"]` (VERIFIED) | none | Portal | Yes | Not found | Medium (Rotterdam students) |
| Xior | Headed Chromium HTML (VERIFIED CF-MC) | CF-MC | Online booking | Yes | Not found | Low-Medium |
| The Social Hub | Hotel booking engine (VERIFIED "Book now") | CF | Booking | Yes | Pay per stay | Low |
| Directwonen | SSR HTML `.new-search-advert` via curl (VERIFIED) | none | Paid (2 free reactions on top ads) | Yes | Yes (price not found) | Low |
| Huurstunt | SSR HTML via curl (VERIFIED) | CF JS detection | Premium (14-day trial) | Yes | Yes | Low |
| Rentola | JSON-LD `ItemList` via curl (VERIFIED) | CF | Paid | Yes | Yes (price not found) | Low (re-aggregator) |
| Stekkies / Rentbird | Not sources (paid alert services) | - | - | - | - | Competitor benchmark |
| uitzicht.nl | Not housing (VERIFIED) | - | - | - | - | None |
| OGonline agent sites (generic) | JSON `GET /nl/realtime-listings/consumer` via curl (VERIFIED on 5 sites) | none | Agent form/email | Usually no | No | High (generic) |
| Realworks CMS agent sites (generic) | SSR HTML `/aanbod/woningaanbod/huur/` (VERIFIED markup) | none | Agent form/email | Usually no | No | Medium (generic) |

---

## 3. Anti-bot and browser strategy

| Observation | Status |
|---|---|
| Pararius, Huurwoningen.nl, Kamer.nl (after its 301 to `www.`), Holland2Stay (site and `api.holland2stay.com/graphql`), Xior: curl gets `HTTP 403`, `cf-mitigated: challenge`, title "Just a moment..." | VERIFIED |
| New-headless Playwright Chromium (`channel:'chromium'`) on Pararius: stays at "Even geduld..." after 30 s | VERIFIED |
| Headed Playwright Chromium under `xvfb-run -a -s "-screen 0 1920x1080x24"` with `--disable-blink-features=AutomationControlled`: Pararius, Huurwoningen, Kamer.nl, Xior all returned `200` on the first navigation. Rebo's Vercel checkpoint (curl `429`) also passed. | VERIFIED |
| Holland2Stay in headed Chromium: interactive Turnstile "Ik ben geen robot" checkbox, still there after 60 s | VERIFIED |
| Funda: Akamai Bot Manager cookies (`ak_bmsc`, `bm_s`, `bm_so`, `bm_mi`) plus a sensor POST to an obfuscated path (`/F8MZv/hTLH6/...`). Search and detail HTML still return `200` to plain curl. `robots.txt` returned an Akamai interstitial page ("Je bent bijna op de pagina die je zoekt"). | VERIFIED |
| Pararius sitemaps listed in robots.txt (`/sitemap/recent-listings-for-rent.xml`) return `403` with an empty body, even in a real browser. They are reserved for search engines. | VERIFIED |
| Kamernet API host is Google Frontend / IIS. No bot wall on `findlistings`. reCAPTCHA Enterprise key `6LdnoRAjAAAAAAfIE6rIVEuEdMnoGfTJpUXY46Lw` is loaded for account actions. | VERIFIED |

Architecture implications:

- Run one **persistent headed Chromium under Xvfb** (`launchPersistentContext` with a user-data dir) for the CF-protected HTML sites. Keep the profile so `cf_clearance` and `__cf_bm` cookies are reused, poll at human-ish intervals (60 to 180 s with jitter), and reuse a single tab per site.
- For Holland2Stay, expose a "solve challenge" button that opens the headed profile on the user's real display (`DISPLAY=:0`) so the human clicks once. Then reuse the cookie for API calls from the same browser context (`page.evaluate(fetch(...))`), because `cf_clearance` is bound to UA and IP.
- Everything else can use plain `fetch` from Node 22 (undici) with a desktop UA.
- The current FreeKamerBot Pararius scraper uses `axios` (`server/services/scrapers/pararius.js`). It will get the CF `403` today (VERIFIED from curl). The Kamernet scraper selects `a[href*="/for-rent/"]`, which only matches the `/en/` site. The Dutch site uses `/huren/` (VERIFIED).

---

## 4. Per-platform details

### 4.1 Pararius (pararius.nl / pararius.com)

- **Search URL** (VERIFIED): `https://www.pararius.nl/huurwoningen/{city}`. Filters are path segments: `/appartement`, `/kamer`, `/studio`, `/huis`, `/wijk-{name}`, `/sinds-1` (published in the last day; VERIFIED 21 results for Delft), and a price range as `/{min}-{max}`. English mirror: `https://www.pararius.com/apartments/{city}`.
- **Machine-readable**: none public. The JSON-LD is only `WebSite`/`SearchAction`. There is no RSS, and sitemaps return 403 (VERIFIED). Use HTML. Selectors verified on the rendered page:
  - card: `section.listing-search-item` (25 per page)
  - link/title: `a.listing-search-item__link--title` (href like `/appartement-te-huur/delft/fd826b6c/kruisstraat`; the 8-hex segment is the id prefix)
  - subtitle (postcode, city, district): `.listing-search-item__sub-title`
  - price: `.listing-search-item__price` (e.g. "EUR 2.450 per maand")
  - features: `.listing-search-item__features` (m2, rooms, interior)
  - label: `.listing-search-item__label .listing-label--new` ("Nieuw"), or text "Onder optie"
  - photo `original_uri` reveals the agent backend (images.realworks.nl, pararius-office, venumfilestore, ogonline, ikwilhuren.nu)
- **Anti-bot**: CF-MC. Headed Chromium required (VERIFIED).
- **Alerts**: "Bewaar zoekopdracht" button present (VERIFIED). Free alerts are sent once a day; instant alerts need Pararius+ at EUR 29.95/month (REPORTED).
- **Contact**: `https://www.pararius.nl/contact/{listing-uuid}` redirects to `/inloggen` when anonymous (VERIFIED). The login page offers "Ga verder met Google", "Ga verder met Facebook", and email + password (VERIFIED form fields `_token,email,password`). Some listings open a dialog: "Deze woning is gevonden buiten ons eigen netwerk. Via de knop hieronder ga je direct naar de website van de aanbieder." (VERIFIED). Those are clickouts to the agent site. The `clickout_contact_form` only has `_token` and `listing_id`.
- **Priority**: High (largest free-sector rental portal).

### 4.2 Funda (huur)

- **Search URL** (VERIFIED): `https://www.funda.nl/zoeken/huur?selected_area=["delft"]&sort="date_down"`. The server redirects to `?selected_area=delft&sort=publish_date_sort_order_desc`. `publication_date="1"` filters to the last day.
- **Machine-readable** (VERIFIED):
  - SSR JSON-LD `@type: ["ItemList","WebPage"]` with 15 `itemListElement[].url` (`https://www.funda.nl/detail/huur/{city}/{type}-{street}/{tinyId}/`).
  - Card HTML: address anchor `[data-testid="listingDetailsAddress"]`; price text "EUR 2.995 p.m."; badge "Nieuw"; broker name.
  - Detail JSON: `GET https://listing-detail-summary.funda.io/api/v1/listing/nl/{globalId}` returns `identifiers{globalId,tinyId}`, `price.rentalPrice`, `address{title,subTitle,city,postCode}`, `fastView{livingArea,numberOfBedrooms,energyLabel}`, `brokers[]`, `publicationDate`, `labels[]`, `isSoldOrRented`. Works with plain curl.
  - Contact block: `GET https://contacts-flows-bff.funda.io/api/v1/contacts-flows/listings/{globalId}/contact-block` returns broker `displayName`, `phoneNumber`, `isContactingEnabled` (plain curl).
  - The detail page JSON-LD (`Huis`/`Product` with `offers.price`) is also present.
  - The NUXT config exposes `openSearch.baseUrl=https://listing-search-wonen.funda.nl`, `listingsIndex=listings-wonen-searcher-alias-prod`, `queryVersion=20260227`, and `saveSearch.baseUrl=https://saved-search-api.funda.io`. **But** `POST .../_msearch/template` returns Akamai 403 on `.nl` and `401 no token provided` on `.funda.io` (VERIFIED). Do not build on it.
- **Anti-bot**: AK. The HTML is fetchable with curl today. Expect this to tighten, so keep a Playwright fallback.
- **Alerts**: saved search exists (config `saveSearch`, VERIFIED). A free account allows up to 5 saved searches, with daily email or push (REPORTED).
- **Contact** (VERIFIED, not submitted): `https://www.funda.nl/makelaar-contact/?listingId={globalId}`, plus `&viewingRequest=true` for a viewing request. It is a guest form with fields `questionInput` (message), `emailAddress`, `firstName`, `lastName`, `phoneNumber` and the button "Verstuur". No login needed. The login is optional (login.funda.nl OIDC: Google, Apple, Facebook, email+password; VERIFIED).
- **Priority**: High. Speed matters and the contact form is free with no login.

### 4.3 Kamernet

- **Search URL**: `https://kamernet.nl/huren/kamers-{city}` (rooms), `/huren/huurwoningen-{city}` (all). English: `/en/for-rent/rooms-{city}`.
- **Machine-readable** (VERIFIED, plain curl, no auth): `POST https://kamernet.nl/services/api/listing/findlistings` with `Content-Type: application/json`. Server-side the same API lives at `https://services.kamernet.nl/api`. Body keys come from the web bundle:

```json
{"location":{"name":"Delft","cityName":"Delft","citySlug":"delft"},"citySlug":"delft","radiusId":5,
 "listingTypeIds":[],"maxRentalPriceId":0,"surfaceMinimumId":0,"listingSortOptionId":1,
 "pageNo":1,"rowsPerPage":20,"searchview":1}
```

  - Response: `{listings:[...], total, OpResponse}`. Each listing has `listingId`, `street`, `streetSlug`, `city`, `citySlug`, `totalRentalPrice`, `utilitiesIncluded`, `surfaceArea`, `listingType` (1 Room, 2 Apartment, 4 Studio, 8 Antisquat, 16 StudentHousing; from the JS enum), `furnishingId`, `availabilityStartDate`, `availabilityEndDate`, `isNewAdvert`, `isReactForFree`, `isTopAdvert`, `studentHouseId`, and image URLs.
  - `listingSortOptionId:1` is NewestFirst. `radiusId:5` returned Delft + Den Haag + Rotterdam results.
  - Detail URL: `https://kamernet.nl/huren/{typeNl}-{citySlug}/{streetSlug}/{typeNl}-{listingId}`, e.g. `/huren/kamer-delft/van-der-heimstraat/kamer-2407683`.
  - `__NEXT_DATA__` on search pages carries the same `findListingsResponse`.
  - Other endpoints in the bundle: `/listing/details`, `/listing/findmapdata`, `/conversation/listing-reaction` (POST, `createListingReactionRequest`), `/conversation/send-message`, `/conversation/my-conversations`, `/conversation/auto-reply`.
- **Anti-bot**: none on reads. reCAPTCHA Enterprise is loaded (VERIFIED key in runtimeConfig).
- **Alerts**: "Alert aanmaken" / "Zoekopdracht opslaan" (VERIFIED UI strings). Saved search emails each new match, with adjustable frequency (REPORTED).
- **Contact**: the detail page button is "Contacteer verhuurder" (VERIFIED). It needs login plus Premium unless `isReactForFree=true`. In the sample, 0 of 18 were free (VERIFIED). Premium costs 2 weeks EUR 29, 4 weeks EUR 39, 12 weeks EUR 79, auto-renewing (REPORTED, support.kamernet.nl). Login: email+password, Facebook (REPORTED), and Google Sign-In (client id `622819151153-...`, VERIFIED in config). OSS reply flow (REPORTED, kamernet-mcp): open `/en/start-conversation/{listingId}`, fill `#Message`, then click "Send message". Kamernet is owned by HousingAnywhere (Sentry org "housinganywhere", VERIFIED in config).
- **Priority**: High for rooms, but reacting costs money.

### 4.4 HousingAnywhere

- **Search URL**: `https://housinganywhere.com/s/Delft--Netherlands`
- **Machine-readable** (VERIFIED):
  - SSR `window.__staticRouterHydrationData = JSON.parse("...")` at `loaderData["0-22"].listings[]` (23 per page) and `pageInfo{total,pages}`.
  - Better: the public Algolia search key embedded in the page:

```
POST https://y8l112mibf-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=170cf5d8f85035f219107d6fb900e3dd&x-algolia-application-id=Y8L112MIBF
{"requests":[{"indexName":"production_listings_rank_withOrpheus","query":"","distinct":true,"hitsPerPage":50,"page":0,
  "aroundLatLng":"52.0116,4.3571","aroundRadius":8000,"filters":"isSearchable:true AND exclusivityPartnerIDs:0"}]}
```

  - This returned 81 hits around Delft via curl. Hit fields: `objectID`, `internalID`, `creationDate`, `creationDateTS`, `price`, `priceEUR`, `city`, `street`, `propertyType`, `unitTypePath` (detail path), `dateFrom`, `dateTo`, `facility_*`, `advertiserId`. Poll with `creationDateTS > lastSeen`.
- **Anti-bot**: none seen. `robots.txt` has `Disallow: /api/*` (VERIFIED). The Algolia host is separate.
- **Alerts**: "Get alerts" (VERIFIED UI string).
- **Contact**: "Apply to rent" and "How do I contact the landlord?" buttons (VERIFIED). Login via `id.housinganywhere.com`: email+password, Google, Apple (VERIFIED). For NL listings, messaging landlords needs a subscription (2 weeks EUR 26, 1 month EUR 34, 3 months EUR 68; article dated 2024-05). Booking then costs the first month's rent. Outside NL, a tenant fee of 25-40% of the first month applies (REPORTED).
- **Priority**: Medium (international students, mostly furnished short/mid stays).

### 4.5 Huurwoningen.nl

- **Search URL**: `https://www.huurwoningen.nl/in/{city}/`
- **Machine-readable**: none. The HTML uses exactly the Pararius card markup (`section.listing-search-item`, `a.listing-search-item__link--title`, `.listing-search-item__price`, `data-listing-search-item-id` UUID, `data-listing-search-item-agent-id`) (VERIFIED, 30 per page). One adapter covers both sites. Many listings come from ikwilhuren.nu (MVGM), OGonline, vbt and Plaza (photo origins, VERIFIED).
- **Anti-bot**: CF-MC. Headed OK (VERIFIED).
- **Contact/login/paid**: Treehouse Groep, a sister site of Pararius. The free Basic account cannot react; Premium costs EUR 29.95/month. Login: Google, Facebook, email+password. Free mail alerts (all REPORTED).
- **Priority**: Medium. Mostly duplicates, so deduplicate on address + price.

### 4.6 Kamer.nl

- **Search URL**: `https://www.kamer.nl/huren/kamer-{city}/` (VERIFIED after redirect from `/huren/{city}/`)
- **Machine-readable** (VERIFIED, headed): JSON-LD `ItemList` of `["ListItem","House"]` with `url` (`/huren/kamer-delft/julianalaan/675658/`), `price`, `priceCurrency`, `startTime`, `image`. There is also an `AggregateOffer` with `offerCount`. Sitemap: `https://www.kamer.nl/sitemap.xml`.
- **Anti-bot**: CF-MC.
- **Alerts**: "Bewaar zoekopdracht", and "Nieuw aanbod direct in je e-mail" is listed on the pricing page (VERIFIED).
- **Contact** (VERIFIED, not submitted): `.../{id}/reageren/` shows a prefilled message plus account-creation fields: E-mailadres, Voornaam, Achternaam, Kies een wachtwoord, Herhaal wachtwoord, Mobiel telefoonnummer, then a next step. Pricing page: Premium "EUR 29,95 /maand, direct opzegbaar". Reacting requires Premium (REPORTED from the page layout).
- **Priority**: Low-Medium.

### 4.7 123Wonen

- **Search URL**: `https://www.123wonen.nl/huurwoningen/in/{city}`
- **Machine-readable** (VERIFIED, curl): server-rendered cards in `.pandlist-container`. The link pattern is `https://www.123wonen.nl/huur/{city}/{type}/{street}-{id}-{branch}`. Text includes price "EUR 524,- p/mnd", status ("Verhuurd"), and "Aangeboden sinds 04-09-2026". The filter widget JSON `GET /assets/json/immozo/objects/filter?urlparams=/huurwoningen/in/delft&jsonparams=...` only returns filter HTML (immozo backend).
- **Anti-bot**: none (nginx/Plesk).
- **Contact**: "Meer informatie aanvragen" form on the listing (no login) or email bezichtiging@123wonen.nl. Registration is free. Free "woningmail" daily or weekly (REPORTED).
- **Priority**: Low-Medium.

### 4.8 Rotsvast

- **Search URL**: `https://www.rotsvast.nl/huren/` (VERIFIED; the old `/woningaanbod/` is 404)
- **Machine-readable**: WordPress HTML cards `.card.card--house` with `.card-house__title`, `.card-house__label`, `.card-house__list`. Links look like `https://www.rotsvast.nl/huren/{street}-{city}-h{id}/` (VERIFIED, 11 cards). Media paths `/app/uploads/sure/media/...` come from a Realworks import.
- **Contact**: "Neem contact met ons op" form on the listing. No login, no fee (REPORTED).
- **Priority**: Low.

### 4.9 Vesteda

- **Search URL**: `https://www.vesteda.com/nl/woning-zoeken?placeType=1&sortType=0&radius=20&s=Delft&sc=woning&latitude=52.0115&longitude=4.3571`
- **Machine-readable** (VERIFIED, plain curl):

```
POST https://www.vesteda.com/api/units/search/facet
{"filters":[],"latitude":52.0115,"longitude":4.3571,"place":"Delft","placeObject":{"placeType":"1","name":"Delft","latitude":"52.0115","longitude":"4.3571"},"placeType":1,"radius":20,"sorting":0,"priceFrom":500,"priceTo":9999,"language":"nl"}
```

  - Response `results{objects[123], complexes[21], newComplexes[1], *Count}`. Object fields: `id`, `street`, `houseNumber`, `city`, `priceUnformatted`, `size`, `numberOfBedRooms`, `status`, `url`, `onlyMiddleRent`, `onlySixtyFivePlus`, `ageFrom`, `prioritizeKeyProfessions`, `entitysubtypelabel`.
- **Contact**: click "inschrijven" on a listing with a free account at `https://hurenbij.vesteda.com/login/` (email+password). Vesteda selects the most suitable candidate, and income must be 3.5x rent (single) or 4x (two people). "Mijn Vesteda" is only for existing tenants (REPORTED).
- **Priority**: Medium (mid-rent apartments, young professionals).

### 4.10 Holland2Stay

- **Search URL**: `https://www.holland2stay.com/residences?page=1&city[filter]=Delft,6186`
- **Machine-readable**:
  - Legacy Magento GraphQL `POST https://api.holland2stay.com/graphql/` returns CF `403` from here (VERIFIED).
  - Per 751K/holland2stay-monitor (REPORTED), the site moved to `POST https://www.holland2stay.com/api/__enc__` (header `x-enc: 1`, AES-GCM envelope with an RSA-OAEP-wrapped key; the key is read from `_next/static/chunks/common-*.js`). It uses a GraphQL operation whitelist (`operationName: "GetCategories"`) and a site clearance cookie `h2s_clr`, obtained via `/api/remote` and then `POST /api/clearance` with a Turnstile token.
  - Status ids: 179 bookable, 336 lottery, 6253 coming soon.
  - The practical approach is to let the real page load, then call `fetch` from inside it with `page.evaluate`, or read the rendered DOM.
  - In headed Chromium the page shows the interactive Turnstile checkbox (VERIFIED).
- **Contact**: an account with a one-time EUR 29.50 registration fee plus a EUR 200 booking fee (advance on the deposit). Two routes: "Book directly" (FCFS, speed is everything) and the weekly lottery (new residences posted Tuesday 17:00, sign up until Sunday 20:00, random draw; at least 90% of lottery units). The ToS forbid "automatic tools ... or external scripts, to make a Booking" (REPORTED). Recommend notify plus a pre-opened booking page, not automatic booking.
- **Priority**: High value for TU Delft students (Delft/Den Haag/Rotterdam residences), but it needs a human-assisted challenge solve.

### 4.11 NederWoon

- **Search URL**: `https://www.nederwoon.nl/search?search_type=1&city={City}` (VERIFIED. Delft: "Geen resultaten". Rotterdam: 1 result)
- **Machine-readable**: HTML. Detail links look like `/huurwoning/{city}/{id}/{slug}` (e.g. `/huurwoning/rotterdam/38641/appartement-statenplein`) and the card text includes address, m2, rooms, and "Beschikbaar per ...". It is served via Cloudflare with no challenge.
- **Contact**: a paid account (regional price, not public, refunded if you rent) is needed for alerts and viewings. Login: email+password, Facebook (REPORTED).
- **Priority**: Low-Medium.

### 4.12 Interhouse

- **Search URL**: `https://interhouse.nl/aanbod/?offer=huur&sort=date-desc` (VERIFIED redirect target)
- **Machine-readable**: WordPress HTML `.c-result-item.building-result`, `.c-result-item__title-address`, `.c-result-item__title-type` (VERIFIED, 18 per page).
- **Contact**: viewing request form only, with no login and no fee. Allocation: "wie het eerst komt, die het eerst maalt" (REPORTED). Speed matters.
- **Priority**: Low-Medium (expat furnished).

### 4.13 MVGM (ikwilhuren.nu)

- **Search URL**: `https://ikwilhuren.nu/aanbod/` (and `/aanbod/{city}`)
- **Machine-readable**: SSR HTML via curl (VERIFIED). Cards are `.card.card-woning`, title `.card-title`, and the link is `/object/{city}-{postcode}-{nr}-{street}-{hash}/`. Pagination `/aanbod/?page=N`. There are 2 JSON-LD blocks.
- **Contact**: a free "Standaard" account can search and react. "Plus" (EUR 36/year) gives instant email alerts. Ranking is by match, with a random draw on ties (REPORTED). OSS repos use the `?sort=aanbodDESC` newest-first sort (REPORTED).
- **Priority**: Medium. It is the biggest single source on Huurwoningen.nl (13 of 30 cards in the Delft sample, VERIFIED).

### 4.14 Rebo Groep

- `https://www.rebogroep.nl/nl/aanbod`: Vercel Security Checkpoint `429` to curl, headed Chromium OK (VERIFIED). It is a Nuxt page backed by a Statamic CMS (`cms.rebogroep.nl/api/...`). Tenant rentals go through `https://rebowonenhuur.nl/login`, which has a self-signed TLS certificate from here (VERIFIED). Reacting creates a MyProperty account. Email alerts are paid (EUR 34.95/year) (REPORTED). Low priority (east NL).

### 4.15 Van der Linden

- `https://www.vanderlinden.nl/woning-huren/`: MODX, BitNinja WAF, `200` to curl (VERIFIED). Links look like `/huurwoning/{Street-Nr-City}/{id}/`. Mostly Amsterdam region. React with a free IDD/woondossier account, free email alerts (REPORTED). Low-Medium.

### 4.16 VBO (now Vastgoed Nederland)

- `https://www.vbo.nl` redirects (301) to `https://aanbod-old.vastgoednederland.nl/`, whose TLS certificate expired 2026-09-15 (VERIFIED with openssl). The current site is `https://www.vastgoednederland.nl/huurwoningen?q={city}` (200, VERIFIED). Low priority.

### 4.17 Huurzone

- `https://www.huurzone.nl/huurwoningen/{city}`: 200 via curl (VERIFIED). JSON-LD `@graph` includes a `CollectionPage` and `ItemList` of `RealEstateListing` with `url` like `/huurwoningen/zuid-holland/delft/{id}`. The HTML is huge (5 MB rendered). Paid aggregator: Premium EUR 29/month is needed to contact; it claims to scan "elk uur meer dan 4500 websites" (REPORTED). Low.

### 4.18 Jaap.nl

- `jaap.nl` and `www.jaap.nl`: `Could not resolve host` (VERIFIED). The Wayback Machine shows the site went offline in January/February 2024 (REPORTED). Treat as shut down.

### 4.19 Marktplaats (Huizen en Kamers)

- **Search URL**: `https://www.marktplaats.nl/l/huizen-en-kamers/kamers-te-huur/#postcode:2628CD|distanceMeters:15000`
- **Machine-readable** (VERIFIED, plain curl; captured from the browser, then replayed):

```
GET https://www.marktplaats.nl/lrp/api/search?l1CategoryId=1032&l2CategoryIds[]=2771&l2CategoryIds[]=2143&postcode=2628CD&distanceMeters=15000&limit=30&offset=0&sortBy=SORT_INDEX&sortOrder=DECREASING&viewOptions=list-view
```

  - Categories: 1032 Huizen en Kamers; 2771 kamers-te-huur; 2143 huizen-te-huur; 2147 expat-rentals; 2144 anti-kraak; 2145/2146 are "op zoek naar" (wanted ads, exclude).
  - Note: the singular `l2CategoryId=` is silently ignored. Use the `l2CategoryIds[]` array.
  - Listing fields: `itemId`, `title`, `description`, `priceInfo{priceCents,priceType}`, `location{cityName,distanceMeters,lat,lng}`, `date` ("Vandaag"), `sellerInformation{sellerId,sellerName,isVerified}`, `categoryId`, `attributes[]`, `vipUrl`.
  - `__NEXT_DATA__` on `/l/...` pages carries the same data.
  - `robots.txt` has `Disallow: /lrp/api/search*` (VERIFIED).
- **Contact**: in-app chat. Login: Google or email+password (VERIFIED login page).
- **Priority**: Medium for rooms. Scam filtering is essential ("Beige bank" and furniture ads leak into kamers-te-huur, VERIFIED).

### 4.20 Facebook groups

- Note only. Groups need a logged-in account and Meta's terms forbid automated data collection. Recommend manual use, or at most an opt-in notification relay. Not probed.

### 4.21 DUWO, ROOM.nl, RoomMatch (TU Delft core)

- The duwo.nl homepage links its offer to `https://www.room.nl/aanbod/studentenwoningen...` (VERIFIED). The ROOM Delft city page (`GET https://www.room.nl/api/drupal/getPage?slug=steden/delft&lang=nl`, VERIFIED JSON) says:
  - "In Delft verhuurt ROOM-aanbieder DUWO..."
  - step 1: "Inschrijven... Dit kost eenmalig EUR 35."
  - step 3: "Huuraanbod DUWO in Delft" pointing to `https://www.roommatch.nl/aanbod/studentenwoningen#?gesorteerd-op=prijs%2B&locatie=Delft-Delft-Regio%2BHaaglanden%252F%2BLeiden`
- ROOM.nl itself is a Hoppinger SPA with `/api/v1/product-search`, `/api/v1/Checkout/*` and `/api/v1/sso/*`. It handles paid registration, not listings (VERIFIED from the bundle).
- **RoomMatch** is a Zig portal. See the Zig adapter in section 6 (VERIFIED 129 objects: Delft 37, Wageningen 30, Amsterdam 20, Groningen 12, Den Haag 8, Leiden 7). Models: `inschrijfduur` 121, `hospitereninschrijfduur` 5, `hospiteren` 2, `reactiedatum` 1. All have `inschrijvingVereistVoorReageren: true`.
- DUWO's own login settings: `GET https://www.duwo.nl/portal/rest/frontend/json/account/frontend/loginSettings` returns `enableMagicLink:false`, `enablePortalAuth:true` (VERIFIED). So login is portal username/password.
- ROOM (REPORTED): EUR 35 one-time, valid 8 years. One login (email+password, optional 2FA) covers RoomMatch and SSHxl. RoomMatch allows max 5 open reactions. Models: inschrijfduur, vote-in (hospiteren), lottery, "Direct offer" (first responder gets the viewing). The RoomMatch terms forbid reuse of site information without written consent.
- **Priority**: High for TU Delft. It is mostly waiting-time based, so automate reacting to every matching offer before `closingDate` within the 5-reaction budget. Watch `reactiedatum` items for speed.

### 4.22 WoningNet (DAK platform)

- `woningnet.nl` points to "DAK" at `mijndak.nl` (VERIFIED). Regions: `amsterdam`, `utrecht`, `almere`, `middenholland`, `gooienvecht`, `eemvallei`, `studentenwoning` (the former StudentenWoningWeb), `groningenhuurt`, `bovengroningen`, `huiswaarts`, `woongaard`, `woonkeus`, `mijnwoonservice` (all `https://{region}.mijndak.nl`, VERIFIED).
- It is an OutSystems app. Anonymous listing call (VERIFIED in the browser):

```
POST https://{region}.mijndak.nl/screenservices/DAKWP/Overzicht/Woningaanbod/DataActionHaalUitgelogdAanbod
{"versionInfo":{"moduleVersion":"<from /moduleservices/moduleversioninfo>","apiVersion":"<per-action token>"},"viewName":"Overzicht.Woningaanbod","screenData":{...}}
```

  - Response `data.PublicatieLijst.List[]` has `Id`, `EinddatumTijd`, `PublicatieModel`, `PublicatieDatum`, `Adres{Straatnaam,Huisnummer,Postcode,Woonplaats}`, `Cluster{...}`, and more.
  - The `apiVersion` tokens change on every deploy. Best approach: load `/Woningaanbod` in Playwright and read the response of that action, or scrape the DOM.
- **Priority**: Medium (Amsterdam/Utrecht social housing; long waiting lists).

### 4.23 Woonnet Haaglanden (Den Haag, Delft, Zoetermeer)

- Zig portal (VERIFIED): `POST https://www.woonnet-haaglanden.nl/portal/object/frontend/getallobjects/format/json` with `X-Requested-With: XMLHttpRequest`. It returned 246 objects: Den Haag 78, Zoetermeer 45, Delft 34. Models: `woningruil` 190, `inschrijfduur` 53, `random` (lottery) 3.
- Detail page: `https://www.woonnet-haaglanden.nl/aanbod/nu-te-huur/te-huur/details/{urlKey}` (200, VERIFIED).
- Filter out `woningruil` (home swaps).
- Registration costs EUR 14.00 (iDEAL/Wero) or EUR 12.50 (direct debit) per year. Max 2 active reactions. The allocation rule is stated per ad: Inschrijfduur, Eerste reageerder (FCFS), Loting, Doelgroep, Bemiddeling (REPORTED).

### 4.24 Woonnet Rijnmond (Rotterdam)

- Embrace Cloud "Portal" (VERIFIED). The anonymous GraphQL was replayed with curl:

```
POST https://portal.mesh-router.embracecloud.nl/graphql
headers: content-type: application/json
         x-ec-tenant-id: woonnetrijnmond
         x-ec-portal-id: UG9ydGFsUHJvdmlkZXJQb3J0YWw6NDg0MDExNWQtZTk4NC00MzQwLTgxYTktZjNjODZiYjM0MDk2
body: operationName "widgetListGetPublications", query housingPublications(orderBy, first, after, filter, locale){ nodes(first){ edges{ node{ id startTime allocationProcess{name} unit{ slug{value} basicRent{exact} grossRent{exact} thumbnails ... }}}}}
```

  - The full query text was captured and saved during probing. Variables: `{"orderBy":"STARTDATE_ASC","first":12,"locale":"nl-NL","filter":{...}}` plus about 60 boolean `@include` flags.
  - `allocationProcess.name` values include "Inschrijfduur". Tenant config: `https://www.woonnetrijnmond.nl/base/config.json`.
  - The same Embrace gateway likely serves other corporations' portals, keyed by tenant and portal id (inference).
- Models: DirectKans (react between 20:00 and 20:15, then a lottery sets the order) and WoningLoting, where registration time does not count, plus inschrijfduur. Fee: EUR 15 registration + EUR 10 renewal (2024 figure; current not found) (REPORTED).

### 4.25 SSH (Utrecht and other cities)

- `GET https://www.sshxl.nl/api/v1/offer` (VERIFIED, plain curl): 51 offers. Fields: `WocasId`, `FlowId`, `Kind` (Hospiteren 35, Bezichtiging 16), `ContractType` (Campuscontract, Jongerencontract), `UnitType` (Kamer, Woning), `BruttoHuur`, `NettoHuur`, `PublishedOn`, `ExpireBy`, `ApplicantCount`, `ViewingDate`, `ContractStartDate`, `Image`.
- Details: `GET /api/v1/offer/getOffersDetails?wocasIds=...` (address, city). There is also `GET /api/v1/external-units`.

### 4.26 Plaza (plaza.newnewnew.space)

- Zig portal "Woonruimte voor studenten, starters en expats" (VERIFIED). `getallobjects` returned 52 objects: Utrecht 30, Geldrop 11, Delft 3, Rijswijk 2. Model `reactiedatum` (icon `br_dth`, first-come) on 23, and 47 of them are studios. It feeds Pararius/Huurwoningen (Jan de Oudeweg, Delft). **Speed matters here.** There is also a JSON feed at `https://mosaic-plaza-aanbodapi.zig365.nl/api/v1/actueel-aanbod?limit=1000` (VERIFIED 200). Registration is EUR 27.50/year (REPORTED, 751K docs/PLAZA.md).

### 4.27 Huren in Holland Rijnland (Leiden region)

- Zig portal `https://www.hureninhollandrijnland.nl/portal/object/frontend/getallobjects/format/json` (VERIFIED, 60 objects: Leiden 18, Alphen 6, Katwijk 6, Voorschoten 6).

### 4.28 Stadswonen Rotterdam

- `https://www.stadswonenrotterdam.nl/nl/aanbod` is a Next.js app router page (VERIFIED). Links look like `/aanbod/{24-hex-id}-{street}-{nr}` and there is an `/api/auth/me` session endpoint. Use HTML `a[href^="/aanbod/"]`.

### 4.29 Xior

- `https://www.xior.nl/` redirects (301) to `https://www.xiorstudenthousing.eu/nl`, which is CF-MC `403` to curl and passes headed (VERIFIED). City page: `/nl/netherlands/delft/`. Booking is done online (REPORTED). Low-Medium.

### 4.30 The Social Hub

- `https://www.thesocialhub.co/delft/` is a hotel/student-stay booking site (VERIFIED "Book now"). It uses the APIs `https://www.thesocialhub.co/api/hoteldata/?hotelCode=DFT01` and `https://www-api.thesocialhub.co/`. Low (priced per stay, not a rental listing feed).

### 4.31 Directwonen

- `https://directwonen.nl/huurwoningen-huren/{city}`: SSR, 7 cards via curl (VERIFIED). Cards `.new-search-advert` with `.advert-location-title` and `.advert-location-price`. Every card links to `/premiumaccountpayment?...&entityId={id}` (paid, VERIFIED). Detail pattern: `/huurwoningen-huren/{city}/{street}/{type}-{id}`. Free "E-mail alert" / "woningalert" (VERIFIED UI strings). Homepage: "reageer twee keer gratis op topadvertenties", and a "Smart" account sees listings 3 days earlier; price not found (REPORTED). Low.

### 4.32 Huurstunt

- `https://www.huurstunt.nl/huren/{city}/`: 200 via curl, with a Cloudflare JS-detection script present (VERIFIED). Links look like `https://www.huurstunt.nl/{type}/huren/in/{city}/{street}/{shortId}` (20 per page). JSON-LD `Product` description: "Probeer Huurstunt Premium nu 14 dagen gratis" (VERIFIED). Paid to react. Low.

### 4.33 Rentola

- `https://rentola.nl/huren/{city}`: Next.js RSC, 200 via curl (VERIFIED, "129 te huur"). JSON-LD `SearchResultsPage` with `mainEntity.ItemList` of `/listings/{slug}-p{hex}`. Photos proxied from Pararius' media CDN (casco-media) and realworks (VERIFIED), so it is a re-aggregator. Paid (REPORTED). Low.

### 4.34 Stekkies and UitZicht

- Stekkies: "We scan 1000+ rental websites... notifications of new houses within 30 seconds", with pricing and discount codes (VERIFIED homepage). It is a paid competitor. Useful as a benchmark: 30 s alert latency.
- uitzicht.nl: "UitZicht is a cooperation of several Dutch funds for people with visual impairment" (VERIFIED). Not relevant.

---

## 5. Pricing, login and ToS notes (REPORTED unless marked)

All REPORTED from official pages on 2026-09-23, some read via Wayback snapshots because the live site blocks fetchers. Source URLs are given per row. "ToS" is a short quote or paraphrase of the clause relevant to automation.

| Platform | How to react | Login methods | Fee to react | Free alerts | ToS on automation |
|---|---|---|---|---|---|
| Pararius | "Contact the estate agent" form or phone | Google, Facebook, email+pw (no Apple) | Free (account obligatory). Pararius+ EUR 29.95/mo is optional | **Daily only when free**; instant needs Pararius+ | Art. 6.1(d) bans "software or tools ... to extract data ... for commercial purposes ('screen scraping')", plus a database-right clause against "repeatedly and systematically" requesting listings ([terms](https://www.pararius.com/info/terms-of-use), [Pararius+](https://www.pararius.com/info/about-parariusplus)) |
| Funda | Guest form `/makelaar-contact/?listingId=` (VERIFIED no login) | Google, Apple, Facebook, email+pw | None | Up to 5 saved searches, **daily** email/push | "niet toegestaan ... te 'scrapen', ... 'te dataminen'", including AI training ([gebruiksvoorwaarden](https://www.funda.nl/voorwaarden-en-beleid/gebruiksvoorwaarden/)) |
| Kamernet | In-platform message | email+pw, Facebook (Google client id VERIFIED in config) | **Premium: 2 wk EUR 29, 4 wk EUR 39, 12 wk EUR 79**, auto-renew | Saved search, email per match, adjustable frequency | Art. 8.2 bans "spiders, robots, crawlers, scrapers, or other automated means" ([AV pdf](https://resources.kamernet.nl/content/pdf/KamernetAlgemeneVoorwaarden_en.pdf), [support](https://support.kamernet.nl/en/articles/13305290-purchasing-a-premium-account)) |
| HousingAnywhere | NL: messaging requires a subscription; booking pays the first month's rent | email+pw, Google, Apple | **NL subscription: 2 wk EUR 26, 1 mo EUR 34, 3 mo EUR 68** (article dated 2024-05). Outside NL: tenant fee 25-40% of the first month, min EUR 175 | Search alerts | 5.9 bans "web spiders, crawlers ... screen scraping" ([terms](https://housinganywhere.com/terms), [pricing](https://housinganywhere.com/pricing/tenants)) |
| Huurwoningen.nl | Premium only (free Basic **cannot react**) | Google, Facebook, email+pw | **EUR 29.95/mo** | Free mail alerts in Basic | Art. 10.1(d) bans "screen scraping". Treehouse Groep, sister of Pararius ([abonnement](https://www.huurwoningen.nl/abonnement/), [over ons](https://www.huurwoningen.nl/content/over-ons/)) |
| Kamer.nl | Premium, reaction forwarded by email | email+pw, Google | **EUR 29.95/mo** (VERIFIED) | "Nieuw aanbod direct in je e-mail" | No specific clause found |
| 123Wonen | "Meer informatie aanvragen" form, no login; or email bezichtiging@123wonen.nl | n/a | Free ("inschrijven altijd gratis") | Woningmail daily or weekly | No web ToS found |
| Rotsvast | "Neem contact met ons op" form on the listing | none | Free | Sign up for updates | No clause |
| Vesteda | "Inschrijven" on a listing with a free account at `hurenbij.vesteda.com`; Vesteda selects the best candidate; income 3.5x (single) / 4x (two) | email+pw | Free | Free account alerts | Disclaimer: "niet toegestaan ... te kopiëren, te downloaden, te scrapen" ([disclaimer](https://www.vesteda.com/nl/disclaimer)) |
| Holland2Stay ("will soon become Codomo") | "Book directly" first-come-first-served for "Available to book", or the weekly lottery: new units posted **Tuesday 17:00**, sign up until Sunday 20:00, random draw; at least 90% of lottery units go this way | Account (form) | **Registration EUR 29.50 one-time + EUR 200 booking fee** (advance on deposit) | Not found | "not allowed to use any automatic tools ... or external scripts, to make a Booking"; may block IPs for bots/scraping ([terms](https://www.holland2stay.com/terms-and-conditions)) |
| NederWoon | Paid account to get alerts and book viewings | email+pw, Facebook | Paid, price per region (not public), refunded if you rent | Email "als eerste" with account | No clause |
| Interhouse | Viewing request form only; "wie het eerst komt, die het eerst maalt" | none | Free | Not found | Disclaimer: no reproduction without consent |
| MVGM ikwilhuren.nu | Free "Standaard" account can react; ranking by match, random on ties | email+pw | Free. "Plus" EUR 36/yr gives instant email alerts (refunded if you rent) | Instant only with Plus | Disclaimer: no copying/reverse engineering |
| Rebo | "Bezichtiging aanvragen" creates a MyProperty account | account | Free to react | **Paid alert service EUR 34.95/yr** | Not found |
| Van der Linden | Free IDD/woondossier account or belangstellendenlijst | account | Free | Free email | Personal non-commercial copy only |
| Vastgoed Nederland | Agent phone/email on each listing | n/a | Free | Not found | Personal copy only, no reverse engineering |
| Huurzone | Premium to contact | Google, Facebook, email+pw | **EUR 29/mo** (promos: 3 days EUR 3.99) | Free daily overview | No clause found. "scannen ... elk uur meer dan 4500 websites" |
| Jaap.nl | Offline since early 2024 (Wayback: 403 on 2024-01-20, 404 from 2024-02-04) | | | | |
| Marktplaats | "Berichten" chat | Google, email+pw (VERIFIED login page) | Free | Saved search notifications | Bans repeated and systematic extraction of database parts, and automated ad placement |
| ROOM.nl / RoomMatch / SSHxl | Portal reaction; one ROOM login covers RoomMatch and SSHxl; max 5 open reactions on RoomMatch | email+pw, optional 2FA | **EUR 35 one-time** (VERIFIED on ROOM CMS), valid 8 years | Search-profile emails | ROOM Art. 8.5 forbids "excessive data transmission"; RoomMatch terms forbid reuse without written consent |
| ROOM models | inschrijfduur, vote-in (with or without inschrijfduur), lottery, **"Direct offer" (first responder gets the viewing)** | | | | |
| WoningNet DAK | Portal reaction; regions listed in section 4.22 | account | Not found | App push | Not found |
| Woonnet Haaglanden | Portal reaction, max 2 active; models per ad: Inschrijfduur, **Eerste reageerder** (FCFS), Loting, Doelgroep, Bemiddeling | account | **EUR 14.00 (iDEAL/Wero) or EUR 12.50 (direct debit), yearly** | Not found | No clause |
| Woonnet Rijnmond | Portal; **DirectKans: react 20:00-20:15, then a lottery sets the order**; WoningLoting | account | EUR 15 + EUR 10 renewal (2024 figure; current not found) | | |
| Directwonen | "Reageer twee keer gratis op topadvertenties"; "Smart" account sees listings 3 days earlier | account | Paid, price not found | Free email alerts | Not found |
| Plaza | Portal, mostly `reactiedatum` FCFS | account | EUR 27.50/yr (REPORTED by an OSS repo) | | |
| Huurstunt, Rentola, Xior, The Social Hub | Not researched in time (Huurstunt "Premium, 14 days free" VERIFIED) | | | | |

Takeaways for design:

1. **Free and no login needed for the first contact**:
   - Funda (guest form)
   - 123Wonen, Rotsvast, Interhouse (agent forms)
   - most OGonline/Realworks agent sites (per-site form)
2. **Free with an account**: Pararius, Vesteda, MVGM Standaard, Van der Linden, Rebo, Marktplaats, and the social portals once the registration fee is paid.
3. **Paywalled**: Kamernet, Huurwoningen, Kamer.nl, HousingAnywhere (NL), Huurzone, Directwonen, NederWoon, Huurstunt.
4. **Speed-critical models**: Funda/Pararius/agent forms (landlords see the first few dozen replies), Interhouse FCFS, Holland2Stay "Book directly", Zig `reactiedatum`/"Eerste reageerder", ROOM "Direct offer".
5. **Not speed-critical**: Woonnet Rijnmond DirectKans (10-minute window, then lottery), H2S weekly lottery, inschrijfduur and loting models. For these, "react to every match before the deadline" is enough.
6. **ToS**: almost every major portal explicitly bans scraping or automated access (Pararius, Huurwoningen, Funda, Kamernet, HousingAnywhere, Vesteda, Marktplaats, Holland2Stay). Holland2Stay specifically bans automated bookings. The tool should be positioned and configured as a personal, low-rate, single-user assistant. Where a platform offers alerts, prefer them. Keep auto-react opt-in per platform with clear warnings.

---

## 6. Generic backend adapters (one adapter, many sites)

### 6.1 Zig Websoftware "portal" (VERIFIED on 7 hosts)

```
POST https://{host}/portal/object/frontend/getallobjects/format/json
Headers: X-Requested-With: XMLHttpRequest, desktop UA
Response: { result: [ {...object} ], sAngularServiceData: "..." }
```

Object fields (VERIFIED): `id`, `urlKey`, `street`, `houseNumber`, `houseNumberAddition`, `postalcode`, `city{name}`, `municipality{name}`, `dwellingType{localizedName,categorie}`, `netRent`, `totalRent`, `areaDwelling`, `sleepingRoom{amountOfRooms}`, `availableFromDate`, `publicationDate`, `closingDate`, `model{modelCategorie{code}, isHospiteren, advertentieSluitenNaEersteReactie, aantalReactiesTonen}`, `inschrijvingVereistVoorReageren`, `doelgroepen`, `pictures`, `reactieUrl`, `latitude`, `longitude`.

Model codes seen (VERIFIED with their icons):

| Code | Icon | Meaning |
|---|---|---|
| `inschrijfduur` | `br_aanbodcooptatie` | waiting time |
| `random` | `br_loting` | lottery |
| `reactiedatum` | `br_dth` | first-come-first-served; OSS repos call it "Snelle reageerder" / "Eerste reactie" (REPORTED). **Speed-critical.** |
| `hospiteren` | | residents choose |
| `hospitereninschrijfduur` | | residents choose, then waiting time |
| `woningruil` | | swap, ignore |

Newer Zig hosts also expose an "aanbodapi". `GET https://mosaic-plaza-aanbodapi.zig365.nl/api/v1/actueel-aanbod?limit=1000` returns 200 JSON `data[]` (VERIFIED).

Verified hosts:

| Host | Objects |
|---|---|
| www.woonnet-haaglanden.nl | 246 |
| www.roommatch.nl | 129 |
| plaza.newnewnew.space | 52 |
| www.hureninhollandrijnland.nl | 60 |
| www.klikvoorwonen.nl | 320 |
| www.woninghuren.nl | 78 |
| www.woonkeus-stedendriehoek.nl | 25 |

Hosts that are NOT Zig: `room.nl` (405), `woonnetrijnmond.nl` (Embrace), `duwo.nl` (Zig CMS pieces, but it publishes via RoomMatch).

Reacting requires a logged-in portal session. DUWO's login settings show no magic link (VERIFIED).

### 6.2 Embrace Cloud portal GraphQL

`portal.mesh-router.embracecloud.nl/graphql` with headers `x-ec-tenant-id` and `x-ec-portal-id`. Both values are readable from `https://{site}/base/config.json` plus the `portalInitialInfoNode` query (VERIFIED for Woonnet Rijnmond).

### 6.3 OGonline agent websites (VERIFIED on 5 sites)

```
GET https://{agent-domain}/nl/realtime-listings/consumer     -> JSON array of all listings (sales and rentals)
```

- Fields: `url`, `address`, `city`, `zipcode`, `isRentals`, `isSales`, `rentalsPrice`, `salesPrice`, `status` ("Beschikbaar", "Verhuurd", "Onder optie", "Onder bod"...), `added` (unix seconds), `changed`, `livingSurface`, `rooms`, `bedrooms`, `mainType`, `isFurnished`, `isDecorated`, `lat`, `lng`, `photo`.
- Verified sizes:

| Site | Total listings | Rentals |
|---|---|---|
| verra.nl (Den Haag/Wassenaar) | 872 | 655 |
| vandaalmakelaardij.nl (Delft) | 623 | 17 |
| vrielingmakelaars.nl | 912 | 6 |
| vanpaaschen.nl (Den Haag) | 138 | 32 |
| vangroenigen.nl | 47 | 0 |

- Filter with `isRentals && status == "Beschikbaar"` and diff on `url` / `added`.
- Detection: the HTML references `s1.ogonline.nl/shared/lib/ogonline-makelaars-basis/` and has `<%= item.url %>` templates.
- Photo URLs contain `rw-api-sha`, meaning OGonline pulls from the Realworks API.

### 6.4 Realworks-hosted CMS sites

- Detection: paths `/versie_N.N-.../pub/css-dist/`, `static.realworks.nl/cms/...`, `images.realworks.nl/servlets/...` (VERIFIED on hofvandelft.nl).
- The listing page is SSR at `/aanbod/woningaanbod/huur/` with the sort option "Nieuwste boven" (VERIFIED).
- Selectors (VERIFIED on the koop page of the same site; the huur page had "Momenteel geen huuraanbod beschikbaar"):
  - `a.aanbodEntryLink`
  - `.street-address`, `.postal-code`, `.locality`
  - `.kenmerk.{koopprijs|huurprijs} .kenmerkValue`
  - `.objectstatus`
  - a per-object `<script type="application/ld+json">`
- Detail URL: `/aanbod/woningaanbod/{city}/huur/{type}-{id}-{street}-{nr}/`.
- The Realworks API (`api.realworks.nl`) needs an agent-issued token (REPORTED), so it is not usable by tenants.

### 6.5 Pararius-family markup

Pararius and Huurwoningen.nl share `section.listing-search-item` markup (VERIFIED). One parser serves both.

### 6.6 Other agent backends seen

- vbtverhuurmakelaars.nl: custom JSON `POST /api/properties/search` with body `{"limit":12,"page":1,"filter":{...}}` (VERIFIED in the browser).
- woonzeker.com: `GET /api/ms/listing/properties?perPage=12&page=1&sort=stage&filter[import_type]=RentResident` (VERIFIED in the browser).
- hollandhousing.nl: "goes" fingerprint (Goes&Co), but `/aanbod` is 404. Not resolved.
- Kolibri: `kolibri24.nl` reset the connection. Not resolved.
- Tiara is the NVM-to-Funda feed. It is not public (REPORTED).

---

## 7. Email alerts as a second ingestion channel

Free saved searches / alerts were seen in the UI (VERIFIED strings):

- Pararius: "Bewaar zoekopdracht"
- Kamernet: "Alert aanmaken" / "Zoekopdracht opslaan"
- HousingAnywhere: "Get alerts"
- Kamer.nl: "Bewaar zoekopdracht", "Nieuw aanbod direct in je e-mail"
- Marktplaats: "Bewaar je zoekopdracht", "Ontvang meldingen van nieuwe zoekresultaten"
- Directwonen: "E-mail alert"
- Huurstunt: "zoekservice"
- Rentola: "email alerts"
- Huurzone: "e-mail alert", "zoekprofiel"
- Funda: `saved-search-api.funda.io`
- WoningNet DAK: app push ("Je ontvangt direct een melding als er een nieuwe woning online komt")

Alerts need an account. They make a good redundancy channel via a dedicated IMAP inbox, with parsers keyed on sender domain. Expect latency of minutes to daily (see section 5 for documented cadence).

---

## 8. Existing open-source projects

Everything in this section is REPORTED: read from repo code, docs or issues by a research pass on 2026-09-23. Star counts are approximate.

### 8.1 Most useful repos

| Repo | Stars | Last push | Lang | Covers | Why it matters |
|---|---|---|---|---|---|
| [daniel2002340/huisjeszoeken](https://github.com/daniel2002340/huisjeszoeken) | 0 | 2026-08-18 | TS, undici + Playwright | 21 Delft sources incl. Funda, Pararius, RoomMatch/Woonnet (Zig), ikwilhuren, directwonen, rentola, huurstunt, marktplaats | Closest to our stack and target city. `src/scrapers/browser-fetch.ts` documents the headed persistent Chromium approach for CF. `src/scrapers/funda.ts` parses `#__NUXT_DATA__` (Nuxt 3 devalue). |
| [751K/holland2stay-monitor](https://github.com/751K/holland2stay-monitor) | 25 | 2026-09-21 | Python | H2S (auto-book), Xior, Plaza, OurDomain, Student Experience, Magis | Best reverse-engineering notes (`docs/H2S.md`, `docs/SCRAPING_RECON.md`, `docs/PLAZA.md`). |
| [0xMH/pyfunda](https://github.com/0xMH/pyfunda) | ~195 | 2026-09-03 | Python | Funda mobile API | Endpoint catalogue and headers. Search broke 2026-08-18 (App Check). Web fallback via curl_cffi. |
| [65456u/housing-monitor-ts](https://github.com/65456u/housing-monitor-ts) | 0 | 2026-07-07 | TS | Plaza (Zig) + Roofz, auto-respond | The Zig react flow in TypeScript (`packages/core/src/platforms/newnewnew.ts`, `auth/browser.ts`). |
| [jasp-nerd/kamernet-mcp](https://github.com/jasp-nerd/kamernet-mcp) | 1 | 2026-08-13 | Python | Kamernet search + reply | Login and reply selectors, reply caps. |
| [Appixo/WoningNet](https://github.com/Appixo/WoningNet) | - | 2026-09-23 | JS | DAK / mijndak.nl | OutSystems token bootstrap (`src/dak.js`). |
| [KevinHang/Letify](https://github.com/KevinHang/Letify) | 61 | 2025-11-11 | Python | Funda, Pararius, Kamernet, Vesteda, REBO, VBT, WoningNet, 123wonen | Broad but partly TODO. |
| [courtandrey/SimpleDataScraperBot](https://github.com/courtandrey/SimpleDataScraperBot) | 1 | 2026-09-21 | Java | ~40 NL sites | Kamernet `findlistings` usage, many small-agent endpoints. |
| [ashokolarov/ParariusBot](https://github.com/ashokolarov/ParariusBot) | 13 | 2026-08-18 | Python/Selenium | Pararius auto-apply | Contact flow selectors, CF tips. |
| [julienrbrt/woningfinder](https://github.com/julienrbrt/woningfinder) | 0 | 2025-01-27 | Go | Zig, old WoningNet, Itris | Zig login + react in Go. |
| [adriaandotcom/huiscrawler](https://github.com/adriaandotcom/huiscrawler) | 18 | 2025-10-31 | JS | ~30 Amsterdam agents and corporations | De Key, Stadgenoot, Rochdale (Hexia) endpoints. |
| [OmarNassar1127/huurradar](https://github.com/OmarNassar1127/huurradar) | 1 | 2026-08-04 | JS | Funda, VBT, Bouwinvest, MVGM, de Alliantie | Playwright auto-apply with a paid captcha solver (do not copy that part). |
| whchien/funda-scraper, khpeek/funda-scraper | ~159 / ~193 | 2025 / 2022 | Python | Funda HTML | Stale. |

### 8.2 Endpoints and techniques by platform (REPORTED)

**Funda**

- Mobile detail API: `GET https://listing-detail-page.funda.io/api/v4/listing/object/nl/{globalId}` (or `/tinyId/{tinyId}`). App headers: `user-agent: Dart/3.11 (dart:io)`, `x-funda-app-platform: android`, `x-funda-app-version: 7.14.11`, plus datadog/traceparent headers in a fixed order.
- Search: `POST https://listing-search-wonen.funda.io/_msearch/template` (NDJSON, template `search_result_20260227`, params `offering_type:"rent"`, `selected_area`, `sort:{field:"publish_date_utc",order:"desc"}`, `page.from`).
  - Since **2026-08-18 it requires a Firebase App Check token** (`x-firebase-appcheck`). That matches our `401 no token provided` (VERIFIED).
  - The detail API still works without a token.
- pyfunda's "new listings" trick: take the highest globalId, then probe the detail API at id+1, id+2... until 20 consecutive 404s.
- Current workarounds:
  - curl_cffi `chrome146` from a residential NL IP against `www.funda.nl/zoeken/huur/...&sort=date_down`, parsing Nuxt data.
  - huisjeszoeken: plain undici GET works, while headless browsers get the Akamai "Je bent bijna" page. That matches our VERIFIED curl success and Akamai interstitial on robots.txt.
- Other hosts used by pyfunda: `contacts-bff.funda.io/api/v4/contact/listings/{id}/contact-form`, `local-listings.funda.io`, `marketinsights.funda.io`.

**Pararius**

- pypararius: `GET https://www.pararius.com/apartments/{city}[/{min}-{max}][/page-N]` with `X-Requested-With: XMLHttpRequest` returns JSON `{components.results:"<html cards>", search_query, _meta}`. Still behind CF.
- CF status since about 2026-07: `cf_clearance` is bound to the TLS fingerprint, so it cannot be replayed from undici. Headed persistent Chromium passes; one headless run can taint the profile (huisjeszoeken).
- ParariusBot contact flow:
  1. Card `.search-list__item--listing`
  2. `.listing-reaction-button a` leads to `/contact/...`
  3. Log in if redirected
  4. Fill `textarea`, then click `.form__button--submit`

  Polling every few seconds increases challenges.

**Kamernet**

- Same `POST /services/api/listing/findlistings` as VERIFIED here (courtandrey, pepijnweijers).
- kamernet-mcp:
  - Login: `https://kamernet.nl/oauth/signin`, fill `#email` and `#password`, save `storage_state`.
  - Reply: `https://kamernet.nl/en/start-conversation/{listingId}`, fill `#Message`, plus optional "barrier" fields `#DateOfBirth`, `#ExpectedMoveInDate`, `#Languages`, `#PeopleMovingIn`, `select[name="ExpectedTenancyDurationId"]`, `#Status`.
  - Without Premium the page redirects away.
- URL query filters are index ladders, not raw values (radius km to id `{0:1,1:2,2:3,5:4,10:5,20:6}`).
- Nobody uses `/services/api/conversation/listing-reaction` directly yet.

**Holland2Stay** (751K docs)

- Endpoint history: `api.holland2stay.com/graphql` (now CF-blocked, consistent with our VERIFIED 403), then `www.holland2stay.com/api/graphql` (2026-06), then `/api/service/residences` (2026-08-11), then `POST /api/__enc__` with header `x-enc: 1` (2026-08-17).
- The `__enc__` payload is an AES-GCM envelope with an RSA-OAEP-wrapped key; the public key comes from `_next/static/chunks/common-*.js`.
- GraphQL operation whitelist (`GetCategories`).
- A second gate after CF: `/api/remote`, then `POST /api/clearance` with a Turnstile token, which sets the `h2s_clr` cookie.
- Status ids: 179 available to book, 336 lottery, 6253 coming soon. City id 29 is an example.
- Working bots run `fetch` inside the page (`page.evaluate`).
- Booking: NextAuth credentials, then `POST /api/booking {sku, contract_startDate, challengeToken, challengeProvider}`. It stops at payment.
- Bursts give 429; they space requests 0.6 s apart.

**Zig portals**

- Listings: the same `getallobjects` as VERIFIED here. Also the newer `https://mosaic-plaza-aanbodapi.zig365.nl/api/v1/actueel-aanbod?limit=1000` (GET), which I **VERIFIED** today: 200 JSON with `data[]`, e.g. Jan de Oudeweg 496, Delft. There is also `https://roommatching-aanbodapi.zig365.nl/api/v1/actueel-aanbod` (POST with Mongo-style filters; my test filter returned 0 rows, so this is unconfirmed).
- Login:
  1. `GET /portal/account/frontend/getloginconfiguration/format/json` to read `__hash__`.
  2. `POST /portal/account/frontend/loginbyservice/format/json` with `__id__=Account_Form_LoginFrontend&__hash__=..&username=..&password=..`.
  3. RoomMatch goes through ROOM SSO (`sso.room.nl`).
- React:
  1. `GET /portal/core/frontend/getformsubmitonlyconfiguration/format/json` to get a fresh `__hash__`.
  2. `POST /portal/object/frontend/react/format/json` with `__id__=Portal_Form_SubmitOnly&__hash__=..&add={assignmentID}&dwellingID={id}`.
  3. Verify via `/portal/registration/frontend/getactievereacties/format/json`.

  Without a session cookie the POST returns 200 but records nothing.
- Allocation models:
  - `reactiedatum` and `dth`: first-come-first-served ("Snelle reageerder" / "Eerste reactie"). This matches our VERIFIED icon `br_dth` on every `reactiedatum` object.
  - `inschrijfduur`, `loting` / `random`, `hospiteren`, `woningruil`: speed does not help.
- Plaza registration is EUR 27.50/year (REPORTED).

**WoningNet DAK** (Appixo/WoningNet)

1. `POST /screenservices/DAKWP/ActionOnApplicationReadyServerActions` (403, but it sets `nr2Users`; the CSRF token is its `crf=` part).
2. `GET /moduleservices/moduleversioninfo`.
3. Regex the per-action `apiVersion` out of `/scripts/DAKWP.Overzicht.Woningaanbod.mvc.js`.
4. `POST .../DataActionHaalUitgelogdAanbod` with `X-CSRFToken` and `clientVariables.SamenwerkingsverbandId`.

No browser is needed.

**Others**

- **SSH:** `POST https://www.sshxl.nl/api/v1/offering/all` (we VERIFIED `GET /api/v1/offer` instead).
- **Xior:** `POST https://www.xiorstudenthousing.eu/wp-admin/admin-ajax.php` with `action=yardi_room_availability`. IP rate limit about 15-20 requests per window.
- **Interhouse:** `wp-admin/admin-ajax.php`.
- **Corporations and agents:**
  - Roofz: `/api/ms/listing/properties`, the same `api/ms` pattern as woonzeker.com (VERIFIED), which suggests a shared vendor.
  - De Key: `vindjeplekbijdekey.nl/dekey-api/aanbod`
  - Stadgenoot: `aanbod.stadgenoot.nl/umbraco/api/Aanbod/GetAanbod`
  - Rochdale: `search.hexia.io`
  - Bouwinvest: `wonenbijbouwinvest.nl/api/search`
  - Huren in Holland Rijnland: `api.housing-portal.nl/properties` (we VERIFIED the Zig `getallobjects` works there too)
- **ikwilhuren.nu:** `/aanbod/{city}?sort=aanbodDESC`.
- **OGonline:** same `realtime-listings/consumer` endpoint as VERIFIED here. It is discoverable through the `data-url` attribute of the `.realtime-listings` element.
- **"objectcontainer" agent sites:** `/woningaanbod/huur?orderby=9&orderdescending=true&availability=1`, cards `article.objectcontainer`, new rentals flagged with `span.new_forrent`.
- **Realworks API** (`api.realworks.nl/wonen/v3/objecten`): needs an agent token.

### 8.3 What repos report about bans and ToS

- pyfunda: "Using this library may violate Funda's Terms of Service". Akamai blocks are IP-based, and datacenter IPs are blocked (Homiio).
- kamernet-mcp: "Automated replies can get an account banned", so it caps replies per session. kamernet-radar honours robots.txt with 50-70 s jitter.
- ParariusBot: headless and fast polling trigger more challenges.
- 751K: H2S 429 on bursts; Xior blocked booking after 3 rounds per IP; the H2S endpoint moved 3 times in 2 months.
- Appixo: hardcoded OutSystems tokens silently return 0 results after a deploy.
- nomomon ADVICE.md: a landlord reported 10 applications in the first 5 minutes, which is why latency matters.

### 8.4 Commercial reference points

- **Rentbird**: "scan 1,400+ rental sites every minute", alerts "within 30 seconds after publication", no auto-apply (REPORTED from rentbird.nl).
- **Stekkies**: "1000+ websites", alerts "within 30 seconds" (VERIFIED homepage).

These set the latency bar: under 60 s from publication to notification, and ideally to the reaction as well.

---

## 9. Recommended adapter tiers

### Tier 1: build first (reliable, free, high value for a TU Delft student)

| # | Adapter | Transport | Why |
|---|---|---|---|
| 1 | **Funda** (search SSR + `listing-detail-summary.funda.io`) | fetch (Playwright fallback) | Huge free-sector supply; the **guest contact form needs no login and no payment**, so it is the best auto-contact target. Poll `sort=publish_date_sort_order_desc` every 60-120 s per area. |
| 2 | **Kamernet** (`POST /services/api/listing/findlistings`) | fetch | Clean JSON, newest-first, no bot wall. Reacting needs Premium, so auto-react only if the user pays or `isReactForFree`. Otherwise notify. |
| 3 | **Zig portal generic adapter** (RoomMatch/DUWO, Woonnet Haaglanden, Plaza, Huren in Holland Rijnland, plus config list) | fetch | One adapter covers TU Delft student housing (DUWO via RoomMatch) and Haaglanden/Leiden social housing. Stable JSON with `publicationDate`/`closingDate` and model code. Auto-react needs portal login (Playwright). |
| 4 | **Pararius + Huurwoningen.nl** (shared parser) | persistent headed Chromium under Xvfb | Largest free-sector portal. Free alerts are only daily, so scraping is the only free fast channel. Reacting on Pararius is free with login (email/pw in Playwright). Huurwoningen reacting is Premium, so ingest only. Use `/sinds-1` and per-type paths. Dedupe with Funda by normalized address + price. |
| 5 | **HousingAnywhere** (public Algolia key) | fetch | Cheap, precise geo query, `creationDateTS` for new detection. NL messaging needs a paid subscription (REPORTED), so treat it as notify-first. |
| 6 | **OGonline generic adapter** (`/nl/realtime-listings/consumer`) | fetch | One GET per agent returns everything. Seed with Randstad agents (verra.nl alone lists 655 rentals). The contact route is agent-specific (detail page, then form), usually with no login, so it is fast and free. |

### Tier 2: next (valuable, some friction)

- **Marktplaats** `lrp/api/search` (rooms from private landlords; needs a strong scam filter; chat needs login)
- **Interhouse, 123Wonen, Rotsvast** HTML adapters: small but **free no-login forms**, and Interhouse is explicitly FCFS
- **Vesteda** `api/units/search/facet` (mid-rent; react via Mijn Vesteda)
- **SSH** `api/v1/offer` (Utrecht)
- **Woonnet Rijnmond** (Embrace GraphQL) and the **Embrace generic adapter**
- **MVGM ikwilhuren.nu** HTML
- **Holland2Stay**: build it, but it needs the human-assisted Turnstile solve and a logged-in browser. The first-come-first-served booking gives the highest payoff for speed. Implement "alert + prefilled booking page opened on the user's screen" rather than fully automatic booking.
- **Realworks CMS generic HTML adapter** (list of agent domains)
- **WoningNet DAK** (Playwright response interception)
- **Stadswonen Rotterdam** HTML
- **Email-alert IMAP ingestion** for Pararius, Kamernet, HA, Funda, Marktplaats (redundancy when a scraper breaks)

### Tier 3: ingest-only or manual

- **Paid or re-aggregators, ingest-only for discovery and dedupe, never auto-react**: Kamer.nl (Premium EUR 29.95/month), Directwonen, Huurstunt, Rentola, Huurzone
- **Low-volume agent sites**, HTML adapters only if the user's area needs them: NederWoon (paid account), Van der Linden, Rebo, Vastgoed Nederland
- **Booking-style student operators**, notify only: Xior, The Social Hub
- **Manual only**: Facebook groups
- **Drop**: Jaap.nl (DNS gone), uitzicht.nl (not housing), Stekkies (competitor, not a source)

### Cross-cutting recommendations

- **Poll budget**: API sources every 60 s; CF HTML sources every 2-3 min with jitter from one persistent browser profile; OGonline/Zig every 2-5 min. That is well under a few hundred requests per hour in total.
- **Dedupe key**: normalized `postcode + house number (+ addition) + rounded price`. The same unit appears on Funda, Pararius, Huurwoningen, Rentola, Huurzone and the agent site.
- **React pipeline**:
  1. Funda guest form: fill `questionInput,emailAddress,firstName,lastName,phoneNumber`.
  2. Pararius form after login.
  3. Agent-site forms from OGonline/Realworks detail pages.
  4. Kamernet `conversation/listing-reaction` only with Premium.
  5. Zig/Embrace/DAK portal reactions via Playwright with the user's own credentials.

  Keep a per-platform daily cap and human-like message variation, since ToS and anti-abuse systems watch for bulk identical messages.


---

## Appendix: probe artifacts

Raw probe outputs are in `scratchpad/probe/`:

- `kn_api2.json`: Kamernet
- `ha_algolia.json`: HousingAnywhere Algolia
- `mp4.json`: Marktplaats
- `vesteda_api.json`: Vesteda
- `ssh_offer.json`: SSH
- `zig_*.json`: Zig portals
- `wrm_query.graphql`, `wrm_req.json`: Woonnet Rijnmond query and request
- `agents/og*.json`: OGonline
- `funda_*.html`, `funda_sum.json`, `funda_cb.json`: Funda
- `pw_*.html`: rendered pages
- `h2s.png`: Holland2Stay Turnstile screenshot

Probe scripts: `scratchpad/pw*.mjs` (Playwright, headed under `xvfb-run`) and `scratchpad/probe/probe.sh` (curl).

# nl-property-finder: competitive research report

Research date: 2026-09-23. Read-only research: nothing was signed up for, logged into or paid for.

## 0. How to read this

- **VERIFIED** = seen on the product's own page, own repo, own app-store listing, own press release or the official legal text on 2026-09-23. **REPORTED** = third-party source (comparison sites, Trustpilot, Reddit, press, search summaries) or a claim we could not load ourselves. Where a table uses (R) it means REPORTED; unmarked cells in section 3 and 8 are VERIFIED.
- Self-reported marketing numbers (user counts, "within 30 seconds", ratings shown on a vendor's own site) are VERIFIED only in the sense that the vendor states them.
- Limits: the session's shared web-search quota (200 calls) ran out midway, after which work used direct page fetches, the GitHub API, Apple's catalog API and a Reddit archive. Pararius, Huurwoningen.nl, Holland2Stay and several US/EU portals sit behind Cloudflare or similar and could not be read directly; their claims are REPORTED.
- Companion file with the full international detail (150+ entries, 47 copyable features, sources): `(research scratch, not committed) competitors-international.md`.

## 1. Executive summary

1. **The Dutch market has moved from alerts to auto-apply.** Uprent (free tier, EUR 29/month Premium with "AI applies 24/7" and "AI-email on autopilot", a Chrome extension that applies through a hidden tab, contract review, neighbourhood and property data) is the direct competitor to our plan. Findify (EUR 56.99 per 2 months, median 3 s listing-to-application) and RentHunter (EUR 34.90 one-click apply, AI letter per listing, dossier link, availability re-checks) follow. Woonspotter now sells "wij reageren voor jou".
2. **Alerts are a commodity.** At least 20 alert services claim 1,000-4,500 sources and "within 30 seconds" (Rentbird, Stekkies, RentSlam, House Hunter, WoonBusters, HuisPing, Huisly, Renthaven, Huurmatcher/Homerun, WhatsApp-only services and a cluster of look-alike brands registered at one Almere address). Prices range from EUR 3.99 to EUR 39 per month. Users now say speed is necessary but not enough.
3. **Nobody, in NL or abroad, ships the full loop we plan.** Reply triage, auto-answering routine replies, auto-booking viewings, IMAP alert-mail ingestion, best-free-channel routing (paywall router), MCP/REST/CLI and local-first operation are absent from every Dutch product. Abroad, the closest are Lettie (UK, Rightmove only: auto-enquiry, classifies replies, books viewings), Traumwohnung.ai (DE: auto-apply plus reply inbox with one-click confirmations), HomeScout (IE: Smart Inbox, auto-apply capped at 3/day) and open-source Fredy (DACH: 26 portals, MCP server with OAuth, weighted scam detection, transit times, no contacting).
4. **Our biggest gaps versus competitors:** availability re-verification, WWS legal-rent check with official property data, a reusable tenant dossier, household/search-buddy support, commute scoring, multiple profiles and drawn areas, an application pipeline board, contract review, a mobile surface and WhatsApp/email channels, listing translation, agency directory, competition signals and published latency.
5. **What users hate:** stale listings (14 of 19 Trustpilot profiles), subscription traps and incasso escalation, double paywalls, landlords who never reply, fake listings, duplicate applications, and document requests before viewings. A free, local, open tool removes the billing complaints outright; the rest map to features in section 9.
6. **Technical reality:** Funda (Akamai, TLS fingerprinting, App Check on the mobile API since Aug 2026), Pararius (Cloudflare on .nl and .com), Kamernet (premium paywall and ToS ban on automated replies) and Holland2Stay (Turnstile, encrypted API) all fight bots, and several block datacenter IPs. Email-first for Funda/Pararius, JSON for social-housing portals, and running from the user's residential IP are structural advantages of our design.
7. **Compliance:** EU AI Act Art. 50 transparency duties apply from 2026-08-02 and the open-source exemption does not cover them (REPORTED from legal text by the international stream, not legal advice). Default an AI-assistance disclosure line on automated messages.

## 2. Landscape map

| Category | NL examples | Abroad examples | Threat to us |
|---|---|---|---|
| A. AI auto-apply agents | Uprent, Findify, RentHunter, Woonspotter PREMIUM | Lettie (UK), Traumwohnung.ai, Wohnly, SnapFlat (DE), HomeScout (IE), Prems, Sherlok (FR), IS24 Bewerbungsassistent | Highest |
| B. Alert subscriptions | Rentbird, Stekkies, RentSlam, House Hunter, WoonBusters, HuisPing, Huisly, Renthaven, Huurmatcher/Homerun, Huur Alerts, HuurDirect, Rentumo, Huurwoning.AI/RentUrgent, Vastiva, Luntero | Flatscout (UK), WohnAlert, Mietbot (DE), Jinka (FR) | Medium (we must match speed and UX) |
| C. Paywalled aggregators ("pay to contact") | Huurstunt, Rentola/Huurportaal, Huurwoningen.nl, Directwonen, Huurzone, Huurflits, HuurExpert, RentSaver | Rentola (DK/FR), BoligPortal (DK) | Low (anti-pattern; route around them) |
| D. Primary portals with paid tiers | Pararius+ (EUR 29.95/mo), Kamernet Premium, Funda, HousingAnywhere | ImmoScout24 Suchen+, WG-Gesucht Plus, SpareRoom Early Bird, TenantPlus (CH) | Medium (they can block us; they add AI inside their own inventory) |
| E. Human agent services | Rentbird Plus (EUR 1,495 + 299), Uprent Full support (EUR 749), RentHunter Coached (R) | SuperRent AI (NYC), Get The Flat (DE) | Low |
| F. Social housing | WoningNet/DAK (slaagkans), Zig/Hexia portals, Woonnet Rijnmond | Bostadsförmedlingen (SE) | None commercially; only small OSS |
| G. Free and open-source bots | Hestia, Letify, FlatRadar, kamernet-mcp, huurradar, housing-monitor-ts, huizenzoeken | Fredy, flathunter, Wohnungsbot, Nestor, nyc-housing-ai, immoscout-helper | Medium (free, community goodwill) |
| H. Data and legal tools | WoonBusters Huurcheck and market report, Huurcommissie Huurprijscheck, Huurprijscheck.app, Altum AI WWS API | DossierFacile (FR), Canopy (UK), RentHop HopScore (US) | Low; sources of features and data |

## 3. Dutch market: paid alert, auto-apply and aggregator services

Legend: VERIFIED = read on the product's own page on 2026-09-23. REPORTED = third-party source (comparison site, review site, app store, news) or a page we could not load ourselves (Cloudflare block).

### 3.1 Tier A: services that already apply or message for you (closest competitors)

#### Uprent (uprent.nl, TurboRent BV, Goes, KvK 92105947)
The most complete Dutch competitor and the one closest to our plan.
- Pricing (VERIFIED): Free forever; Premium EUR 29/month (7-day trial for EUR 1); Full support EUR 749 (EUR 49 upfront + EUR 700 success fee).
- Free tier (VERIFIED): listings from "240+ sites" (homepage elsewhere says "116 sources", inconsistent), send applications manually, "all applications and emails in one CRM", contract review before signing, utility setup.
- Premium (VERIFIED): "New home alerts within seconds", "AI applies 24/7", "AI-email: on autopilot", "Price-check on any home", "Share Premium with anyone".
- Auto-apply (VERIFIED): "Uprent AI sends a viewing request message to each matching home. The message is built from your profile ... You control exactly where it applies with detailed filters, and you can pause or stop it at any time."
- Inbox and tracking (VERIFIED): all landlord communication flows into one inbox; applications tracked on a visual board (Kanban).
- Chrome extension "Uprent - AI Rental Agent" (VERIFIED on Chrome Web Store, v71, updated 2025-09-15, 5.0 from 23 ratings): English summaries of Pararius/Funda/Kamernet listings; travel time by bike, transit, foot or car to multiple addresses; one-click apply that "will open a hidden tab, complete all viewing request steps for you, and auto-fill all required fields"; viewing-request message generator inserted on Funda, Pararius, Kamernet; BETA "Rental Agent" that submits applications automatically from the dashboard; save-to-board and field autofill on "7,000 rental platforms and agent websites".
- Free tools (VERIFIED): Ghettometer (crime, population, age, video reviews per neighbourhood); Home Checker (BAG living area, year built, energy label, WOZ value and change, estimated taxes, from BAG/WOZ/Kadaster); AI rental contract check (upload, AI explains termination, rent increase, pets clauses); directory of 3,286 rental agencies; comparison of 299 rental platforms with fees and scam notes.
- Languages (VERIFIED): English, Dutch, Russian. 30% of users are internationals searching from abroad. Two-sided: landlords list directly, so Uprent has exclusive listings.
- Claims (VERIFIED, self-reported): 15,000+ searchers, 4.8/5 Trustpilot. The Trustpilot profile itself showed 4.2 from 46 reviews, with a complaint about several applications sent to the same ad (VERIFIED on Trustpilot by the review stream).
- Operator: TurboRent BV, a three-person team per the extension listing (VERIFIED); also runs a Telegram channel t.me/NLrent (VERIFIED link).
- Gaps vs our plan: cloud service holding your credentials and profile; no reply triage/auto-answer described beyond "AI-email on autopilot"; no scam detection claim; no viewing auto-booking; no MCP/API; no social housing.

#### Findify (findify.nl, KvK 91978394)
- Pricing (VERIFIED): Basic EUR 29.99 per 2 months (one-tap apply); Pro EUR 56.99 per 2 months (auto-apply); 3-day free trial. A Findify blog comparison lists EUR 19.99/34.99 per month (REPORTED, inconsistent with pricing block).
- Speed (VERIFIED): "Pro applies in 3 seconds" (median listing-to-submission, 7,000+ applications); ~15 s from publication to confirmation; sources checked "in a continuous loop".
- Auto-apply (VERIFIED): saved profile (intro message, income details, documents) "is matched to the platform's application form and submitted". Supported platform list is only shown in the app.
- Replies (VERIFIED): viewing invites, questions and updates land in the app.
- Notifications (VERIFIED): push, Telegram, email.
- Sharing (VERIFIED): search together with up to 2 people, free.
- Rent legality (VERIFIED): demo listing card shows "Within limits; Max up to EUR 836.74" (WWS max-rent estimate per listing).
- Claims (VERIFIED): 18,800+ renters, 17K+ applications, 690+ cities.

#### RentHunter (renthunter.nl)
- Pricing (VERIFIED): free tier, no card; paid EUR 34.90/month (one-click apply). Coached EUR 84.90 and Auto-Apply EUR 124.90/month advertised; Auto-Apply "could not be purchased" on 2026-08-13 (REPORTED, Findify review).
- Coverage and speed (VERIFIED): 1,100+ sites, alerts "within 30 seconds"; re-checks that the home is still available.
- Apply (VERIFIED): one click sends dossier plus an AI message "written for that specific listing" to Funda, Pararius or Kamernet without leaving RentHunter; AI "does not invent or round" applicant data; user can edit.
- Other (VERIFIED): "below market" price badge on listings; application dashboard with reply status and viewing history; contract review against Dutch rental law; scam filtering ("fraud removed before you see it"); shareable rental dossier link with user-controlled disclosure; shared search for two people with one dossier; settling-in guidance (energy, internet, insurance, banking); 6 languages with Dutch listings translated; applications in English or Dutch; iOS and Android.
- Claims (VERIFIED, self-reported): 12,000+ internationals housed, 70% of viewings go to the first applicants, 60+ applications per listing, Trustpilot 4.5 (339). Trustpilot itself showed 4.3 from 357 reviews; top complaint "listings gone when checked" (VERIFIED by the review stream).

#### Woonspotter PREMIUM (woonspotter.com, Woonspotter B.V., Almere, KvK 92331351)
- VERIFIED: PLUS ("zelf reageren") and new PREMIUM ("wij reageren voor jou", we respond for you); 1,300+ agent and corporation sites 24/7; email, push (iOS/Android) and SMS alerts; 14-day money-back; 8.4 from 105 reviews (own widget). Prices did not render.
- Note (VERIFIED): same registered address (Randstad 22-46, Almere) as Huurwoning.AI and RentUrgent (KvK 92332633). One operator appears to run several near-identical alert brands.

#### Rentbird Plus and RentSlam (partial automation)
- Rentbird Plus (VERIFIED): EUR 1,495 + EUR 299 start fee, "no key, no fee" if no home within 3 months; human agents respond to matches, build your requirements package, verify legal documents, review contract, negotiate, offer optional viewing assistance, pre-check landlord credibility, and access "off-market homes that agents only share among themselves".
- RentSlam (VERIFIED via fetch): "automatic personalised application messages" (appears to be a drafted message, not submission).

### 3.2 Tier B: alert-only services (speed plus aggregation)

| Service | Price (VERIFIED unless noted) | Sources / speed claim | Channels | Notable features |
|---|---|---|---|---|
| Rentbird (rentbird.nl) | EUR 29 /1 mo, 19.50/mo on 2 mo, 16.33/mo on 3 mo; 14-day refund | 1,400+ sites every minute; matches within 30 s | iOS/Android app push; WhatsApp alerts historically (reviews 2024) | 5 searches, 1 search buddy, AI-generated response letter ("reply in two clicks"), off-market via Plus, 4.7 on 1,998 reviews (own claim) |
| Stekkies (stekkies.com) | EUR 29.95 /1 mo, 19.95/mo on 2 mo, 16.65/mo on 3 mo; 14-day refund, renewal reminder, one-click stop | 1,000+ sites plus social media every minute; ~12 s find-to-app | App, email, WhatsApp (REPORTED) | Travel-time search (walk/cycle/drive/transit 15-60 min), draw on map, radius, neighbourhoods; 4 profiles; free search buddy; applied/visited tracking; letter template; "free listings only" by default with opt-in to paywalled sites; pets filter; sharing (woningdelen) flag; expected matches/week before signup; "Check rental listing" tool (is this address recently listed, and where); also Germany and UK |
| RentSlam (rentslam.com) | EUR 29.95 /1 mo, 22.48/mo on 2 mo, 16.65/mo on 3 mo; 14-day refund | 1,500+ sources, within 30 s | Email, iOS/Android app | 4 profiles; search by travel distance; includes social housing and huurtoeslag-eligible homes; "700 per day" new listings |
| House Hunter by Moments AI (househunter.online) | EUR 17/mo; 14-day refund | 1,500+ sources every minute | Email, WhatsApp | Multiple profiles; public live feed (32,412 active); no-BSN and scam guides |
| WoonBusters (woonbusters.nl) | EUR 3.99 (rent up to 750) / 5.99; alerts page says "per 2 weken", comparison pages say per month; 7 days free; free daily digest 09:00 | 1,000+ sources, mostly agent sites scraped directly; measured median 24 s detection-to-mail (2,637 alerts, Aug 2026) plus ~2 min scan cycle | Email, push app | WWS max-rent indication per listing; continuous re-verification removes rented homes; directory of 1,227 agents with registration fee (free/paid/none) and selection method; Kansen-checker (matches/week, median days online, pressure score); public market report (48% of tested listings above legal max, 65% break at least one of three laws, median 14 days on market); public API; huurverlagingsdossier; income-requirement, huurtoeslag, service-cost, energy-label checks |
| HuisPing (huisping.nl) | Free (1 profile, daily digest ~19:00); Plus EUR 9.95/mo; Pro EUR 24.95/mo (3 profiles, low-quality exclusions); 7-day trial without card, falls back to free | 100 sources (platforms, corporations, agents); publishes measured median 5 min | Email only | Shows how many responses a listing already had at detection; fields the source lacks are shown as "unknown" rather than guessed; source breakdown published |
| Huisly (huisly.nl) | Free; Premium EUR 9.99/mo (3 alerts, 10 locations, high-priority push) | 1,400+ websites (unverified per WoonBusters) | Push app | Rent and buy together; map viewport search; listing history; original source links |
| Renthaven (renthaven.nl) | EUR 15 /1 mo, 20 /2 mo, 24 /3 mo | 30 s scan at peak; alert within 2 min | Push, email | Map-drawn areas, shareable search profiles, saved response data |
| Huurmatcher, now Homerun (huurmatcher.nl) | Week pass to monthly (prices not rendered) | 1,200+ sites every 30 s | WhatsApp, email | Up to 10 searches; rebrand to Homerun (REPORTED, May 2026) |
| Huur Alerts (huuralerts.nl) | n/a | n/a | WhatsApp | Map and feed; app |
| HuurDirect (huurdirect.app) | REPORTED | REPORTED "within 30 seconds" | WhatsApp | Page did not render |
| Rentumo (rentumo.nl) | Freemium, contact details gated (REPORTED) | 272 websites per minute, "within 30 seconds" | Email, push app | Tenant profile; landlord side; stale/duplicate listing complaints (REPORTED) |
| Huurwoning.AI / RentUrgent (Almere, KvK 92332633) | EUR 39/mo after 14 days free; 29/mo on 3 mo; 9/mo on 12 mo | 1,000+ websites | Email | Dashboard with 7-day history; explicitly no mediation |
| Vastiva (vastiva.nl) | n/a | Agents, social media, marketplaces | Email, WhatsApp | Claims 10,862 listings |
| Luntero (luntero.com) | Free search; Pro price not shown | 20,000+ listings from 100+ platforms; "alerts within minutes" | Email | Pro: Kanban board, AI-generated landlord messages in Dutch/English that you send yourself; per-platform comparison pages |

### 3.3 Tier C: paywalled aggregators (pay to contact)

- Huurstunt (VERIFIED): free account; Premium EUR 29.95/month after 14 days free, needed for "reageer onbeperkt", full descriptions and advanced filters; 300+ sites; alerts immediate/daily/weekly by email; "300,000+ users, 25,000+ premium". Trustpilot 4.2 on 1,500+ reviews (REPORTED by WoonBusters).
- Rentola / Huurportaal (VERIFIED): same template sites; AI natural-language search ("3 bedroom apartment under EUR 1500 in Amsterdam"); "AI notification" with up to 7 free alerts per day; ~12,930 homes. EUR 1 trial converting to EUR 39 auto-renewal, cancellation problems and debt-collector escalation (REPORTED, Trustpilot 1.6-1.8).
- Huurwoningen.nl (REPORTED, site behind Cloudflare): Premium EUR 29.95/month, 14-day free trial converts automatically; needed to respond.
- Directwonen (REPORTED): premium ~EUR 15/month to respond; "Smart" EUR 9.95 per 2 weeks or 14.95/month lets you respond 3 days earlier than free users and upload documents; complaints about renewal without consent and fake offers.
- Huurzone (VERIFIED): scans "4,500+ rental websites every hour"; email alerts; Premium needed to message; auto-removes rented listings; NL/EN/PL.
- Huurflits (REPORTED): premium tier.

### 3.4 Tier D: primary portals and their paid tiers

- Pararius / Pararius+ (REPORTED, pararius.com returns a Cloudflare challenge): free alerts are a daily email; Pararius+ EUR 29.95/month (trial 7 days for EUR 1 or 14 days, sources differ) adds instant email and push alerts, one-click respond with a "Rental Profile" (income, living situation), and the number of responses per listing.
- Funda (REPORTED): saved search with daily email or push; contact form per listing; primary publication channel.
- Kamernet (VERIFIED): Premium required to reply or start contact: 2 weeks EUR 29, 4 weeks EUR 39, 12 weeks EUR 79, all auto-renewing; "all homes actively screened". "Early Bird" members see new listings earlier (REPORTED by WoonBusters, 2026-08-22). Trustpilot 3.5 on 3,082 reviews (REPORTED).
- HousingAnywhere (REPORTED): Tenant Protection holds first month's rent until 48 h after move-in; AI scam detection and Stripe identity checks; refunds and up to 14 hotel nights if landlord cancels; fee not charged in the Netherlands.

### 3.5 Social housing helpers

- WoningNet / DAK (VERIFIED): search and react for all WoningNet regions via the DAK platform and app. Personal "slaagkans" (chance of success) per listing based on waiting time, allocation rules and popularity of comparable homes (REPORTED, NUL20 2011 and WoningNet pages).
- Amsterdam region points system (VERIFIED, socialehuurwoningzoeken.nl): wachtpunten (1 per year), zoekpunten (max 30, earned by reacting 4 or more times per month, 1 point per month), situatiepunten, startpunten; points are lost if you do not react for a month or miss a viewing appointment. This makes "react at least 4 times a month on plausible homes" a mechanical task nobody automates for the user today.
- No commercial alert service covers social housing reactions. Stekkies explicitly excludes it (VERIFIED); RentSlam includes social listings in alerts only (VERIFIED); WoonBusters' Kansen-checker explicitly excludes it (VERIFIED).

### 3.6 Market data points worth reusing (VERIFIED on WoonBusters market report, May-July 2026)
- 53,722 listings from 1,187 agents and platforms in 331 municipalities; ~11,495 new listings per month; 78 active searching households per new listing.
- 48% of WWS-testable listings asked more than the legal maximum (lower bound 30%); EUR 4.5M per month overcharge.
- 65% of testable listings violate at least one of three laws; 51-86% of temporary contracts lack a visible legal ground.
- Median 14 days on market.
- WWS 2026 thresholds (REPORTED, volkshuisvestingnederland.nl and others): up to 143 points social; 144-186 points regulated middle rent (rent EUR 932.93 to EUR 1,228.07 from 2026-01-01); 187+ points free sector.

## 4. International competitors (condensed)

Full detail with per-product entries for DACH, UK, IE, FR, ES/PT/IT, Nordics, Benelux, CEE, US, CA and AU/NZ is in `competitors-international.md` (same folder). Labels there are [V] = VERIFIED and [R] = REPORTED.

### 4.1 Closest analogues: tenant-side agents that contact landlords or handle replies

| Product | Country | Sources | Auto-contact | Reply handling | Viewing booking | Price |
|---|---|---|---|---|---|---|
| Lettie (lettie.uk) | UK, London | Rightmove only, every 45 s (VERIFIED) | Yes (Pro), from a dedicated per-user email with varied wording (VERIFIED) | "Auto-read & classify replies" (VERIFIED) | Auto-books (VERIFIED) | Free; GBP 5; Pro GBP 20/mo (VERIFIED) |
| Traumwohnung.ai | DE | IS24, Immowelt, Immonet (VERIFIED) | Yes; demo 25 s listing-to-application (VERIFIED) | One inbox, notifies only on important messages, AI-drafted confirmation sent in one click (VERIFIED) | Drafts confirmation (VERIFIED) | EUR 24.99 / 49.99/mo (VERIFIED) |
| HomeScout (homescout.io) | IE | Daft, Rent.ie, MyHome, agent sites; daily crawl (VERIFIED) | Opt-in, max 3/day, pausable (VERIFIED) | Smart Inbox detects viewing intent (VERIFIED) | Calendar export (VERIFIED) | EUR 12.99/mo (VERIFIED) |
| Prems | FR | 350+ agency sites (VERIFIED) | Fills agency forms with dossier link and motivation, under 60 s (VERIFIED) | Shows only viewing confirmations (VERIFIED) | Via confirmations | EUR 29-149 per week (VERIFIED) |
| Sherlok | FR | 15+ sites (VERIFIED) | "Candidature automatique en 60 secondes", AI emails to owners (VERIFIED) | Tracks applications | n/a | EUR 34 / 48/mo (VERIFIED) |
| Wohnly | DE | Auto on IS24/Immowelt/Immonet; 12 more as alert + pre-written letter (VERIFIED) | Yes, measured median 10 min over 13,283 listings (VERIFIED) | None | No | EUR 19.99 / 39.99/mo (VERIFIED) |
| ImmoScout24 Suchen+ Unlimitiert | DE | Own portal | Beta "Bewerbungsassistent" sends applications 24/7 (VERIFIED), while AGB 8.2 bans third-party bots (VERIFIED) | Own inbox | n/a | ~EUR 13-40/mo (REPORTED) |
| Fredy (OSS, 1,528 stars) | DE/AT/CH/ES/IT/PT | 26 portals (VERIFIED) | No | No | No | Free; Apache-2.0 + Commons Clause (VERIFIED) |
| nyc-housing-ai, immoscout-helper, Nestor (OSS) | US / DE / US | StreetEasy etc. / IS24 / any URL | Yes | Parse replies; accept, decline, counter; Nestor offers approve or autopilot | Yes (calendar) | Free |

### 4.2 Patterns worth noting
- **Portals are becoming agents inside their own inventory** (VERIFIED on press pages): Zillow AI mode can apply and book tours (beta, 2026-03); Apartments.com's ChatGPT app messages managers and books tours (REPORTED); RentCafe "Ren" contacts, tours and applies from chat; ImmoScout24 DE, Rightmove, idealista, Fotocasa, Imovirtual and a dozen US portals ship ChatGPT apps. None works across platforms, and no Dutch portal has one.
- **Speed is the paywall abroad too**: SpareRoom Early Bird, TenantPlus (CH, 7-day head start), Flatfox Priority, IS24 Wartelisten. Competition insight is a paid feature (IS24 Chancen-Check, WG-Gesucht Angebots-Insights, Qasa).
- **Measured latency is published by the better services**: Flatscout (UK) median 8.6 min over 22,582 alerts; Wohnly 10 min median time-to-apply; WohnAutopilot found 24.1% of Berlin listings gone within 4 h and 50.1% within 24 h; WohnAlert publishes listing lifetime per landlord (all VERIFIED).
- **Reusable, verified tenant dossiers are mature**: DossierFacile (French government, free, open source, watermarks, one expiring link per recipient with access log, OAuth API, 116,000 dossiers), Canopy RentPassport (UK), SingleKey (CA), Leboncoin Pass Locataire+, IS24 Bewerbermappe, Snug (AU, group applications) (VERIFIED unless noted).
- **Landlords increasingly use AI**: EliseAI, Entrata ELI+ ("renters often mistake ELI for a real person"), RealPage Lumina, AppFolio, Leasey.AI (replies in 14-18 s), Rently "Ria", UK Street, Reapit, Hybr, Latch (VERIFIED on vendor pages). Showing platforms ask pre-screen questions, then require ID, selfie or card holds. Our agent must parse tour links, give one consistent fact block, guard against loops, and stop at identity or payment steps.
- **Scam scoring is the biggest unmet renter need abroad as well**: Fredy (weighted signals: advance payment, keys by post, money transfer = 3; landlord abroad, no viewing, price 40%+ below local median = 2; flag at 3+, user override, never hides), FlagMyListing (UK, 40+ patterns), RentHop HopScore, Jinka's fake-listing filter. Landlord-side fraud tools (Snappt, Homeppl) inspect PDF metadata, so tenant documents should never be re-saved.

### 4.3 International open source worth studying
- **Fredy** (orangecoding/fredy, 1,528 stars, pushed 2026-09-23): MCP server over stdio and streamable HTTP with OAuth 2.1, dynamic client registration and PKCE; interview-based search creation; notification secrets never pass through the LLM; Transitous/MOTIS transit times (free, no key); cross-portal dedup; ads stored after removal. Commons Clause forbids selling it, so study, do not copy.
- **flathunter** (1,062 stars, AGPL): mature multi-site architecture, Capmonster for IS24, 10% loop jitter; README concedes bots "make things worse".
- **Pattern sources**: kubilay-yavuz/rightmove-mcp (dry-run default, consent flag before send/book, PRICE_REDUCED and BACK_ON_MARKET events); open-properties (`property-listing.v1` schema, "treat listing text as untrusted"); toronto-ap-finder (hard/soft/notify rules, rejection log, circuit breaker per source, quiet hours, 464 tests); FlatBot, gesucht, claudiokoller/wohnungs-bot (email-alert ingestion like our IMAP path); Aliosha-dev/immoscout-auto-apply (one-page PDF per listing); chrischall zillow/redfin MCPs (requests through the user's own browser tab).

## 5. Open-source projects (GitHub, GitLab, Codeberg)

About 95 GitHub searches, 17 topic pages and 45 READMEs were reviewed. Stars and last-push dates are from the GitHub API on 2026-09-23 (VERIFIED). GitLab and Codeberg have essentially nothing (one 2021 Scrapy scraper with 0 stars).

### 5.1 Headline findings
- No open-source project covers the full loop (multi-platform polling + IMAP alert ingestion + cross-site dedup + LLM fit scoring + auto-message + reply triage + viewing booking). Reply triage and viewing booking exist nowhere (VERIFIED absence within the surveyed set).
- The closest partial overlaps: huurradar (6 sites, Gemini reads income rules, LLM letter, auto-apply on one site), FlatRadar (7 student platforms, 7 notification channels, Holland2Stay auto-book up to payment), kamernet-mcp (MCP server that can reply to landlords), housing-monitor-ts (IMAP-driven form filling), huizenzoeken (IMAP bridge for Funda/Pararius/Rentslam alert mails).
- Two free hosted bots compete directly for users: Hestia (@hestia_homes_bot, hestia.bot, iOS app; ~36 sources; free, donation-funded) and Letify (@letify_bot; "over 1000 users" self-reported; 11 sources).
- LLM use is recent (2026) and small; nobody uses Claude for triage or booking.

### 5.2 Comparison table (top 30 by relevance, all VERIFIED)

| # | Repo | Stars | Last push | Lic | Platforms | Data access | Notify | Auto-apply | AI | Deploy |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | wtfloris/hestia | 256 | 2026-09-15 | none | ~36: 24 Zig/Hexia portals, WoningNet DAK, Woonnet Rijnmond, Funda, Vesteda, VBT, Alliantie, Rebo, NMG, VBO, 123Wonen, Entree, Roofz, ikwilhuren, NederWoon; Pararius via private module | JSON endpoints + HTML; Funda via curl_cffi; IPv6 rotation for ikwilhuren | Telegram, web, iOS push | No | No | Docker per agency + cron + Postgres; hosted, multi-user |
| 2 | 0xMH/pyfunda | 195 | 2026-09-03 | AGPL-3.0 | Funda | Reverse-engineered mobile API; web fallback | library | No | No | PyPI |
| 3 | whchien/funda-scraper | 159 | 2025-05-06 | GPL-3.0 | Funda | HTML; blocked by CAPTCHA | none | No | No | PyPI |
| 4 | khpeek/funda-scraper | 193 | 2022-06-25 | none | Funda | Scrapy | none | No | No | unmaintained |
| 5 | KevinHang/Letify | 61 | 2025-11-11 | MIT | Funda, Pararius, Kamernet, Huurwoningen, Vesteda, VBT, Rebo, Bouwinvest, 123Wonen, WoningNet Amsterdam, Huren in Holland Rijnland | aiohttp with header profiles, referer rotation, proxy list | Telegram | No | No | Postgres; hosted, multi-user |
| 6 | 751K/holland2stay-monitor (FlatRadar) | 25 | 2026-09-21 | PolyForm NC | Holland2Stay, OurDomain, OurCampus, Xior, Magis, Student Experience, Plaza | CloakBrowser (patched Chromium) for Cloudflare, curl_cffi elsewhere | Web, Telegram, email, WhatsApp, iMessage, iOS/Android push | H2S auto-book up to payment | No | Docker + SQLite; hosted flatradar.app + apps |
| 7 | isso/pararius-apartment-hunting-dashboard | 49 | 2023 (archived) | MIT | Pararius | HTML | dashboard | No | No | local |
| 8 | JafarAkhondali/Holland2StayNotifier | 30 | 2024-07-03 | GPL-3.0 | Holland2Stay | GraphQL (now 403) | Telegram groups | No | No | cron |
| 9 | amirzenoozi/Holland2StayNotifier | 0 | 2026-09-17 | GPL-3.0 | H2S, Funda, Pararius, Huurwoningen, ikwilhuren | Sitemap + Firecrawl (paid) | Telegram | No | No | Docker |
| 10 | nstapelbroek/estate-crawler | 26 | 2025-03-01 | BSD-3 | agencies by region | Scrapy | JSON lines | No | No | Docker |
| 11 | 0xMH/pypararius | 15 | 2026-05-01 | none | Pararius | XHR JSON + JSON-LD | library | No | No | PyPI; blocked again |
| 12 | ashokolarov/ParariusBot | 13 | 2026-08-18 | none | Pararius | Selenium in real Chrome profile | Telegram | Yes (message form) | No | local |
| 13 | SalimOfShadow/Kamernet-Bot | 11 | 2025-05-29 | GPL-3.0 | Kamernet | Puppeteer + rebrowser-patches | log | Yes (templated) | No | Docker |
| 14 | nomomon/Kamernet-Puppeteer | 9 | 2026-02-15 | MIT | Kamernet | Puppeteer on saved-search alerts | none | Yes | No | local |
| 15 | jasp-nerd/kamernet-radar | 1 | 2026-07-16 | MIT | Kamernet | `__NEXT_DATA__`, robots-compliant, 50-70 s jitter | Discord, Telegram, Apprise (ntfy, email, WhatsApp, 100+) | No | LLM score 0-100 via OpenRouter with YAML rubrics | Docker + Postgres |
| 16 | jasp-nerd/kamernet-mcp | 1 | 2026-08-13 | MIT | Kamernet | `__NEXT_DATA__`; Playwright for login and reply | via agent | reply_to_listing, capped at 50 per session | MCP server for Claude/Cursor/Codex | uvx |
| 17 | OmarNassar1127/huurradar | 1 | 2026-08-04 | MIT | Funda, VBT, Bouwinvest, MVGM, de Alliantie, Brockhoff | per-site adapters | SMTP | Brockhoff only (Playwright + 2captcha) | Gemini reads income rules, writes letter ("invent nothing") | npx, Express, SQLite |
| 18 | julienrbrt/woningfinder | 0 | 2025-01-27 (archived) | none | Social housing: Itris, Zig, WoningNet, ikwilhuren, woonburo | corporation APIs with user's credentials | email | Auto-react on social housing | No | was hosted woningfinder.nl |
| 19 | bilalscom-ctrl/huizenzoeken | 0 | 2026-09-20 | none | local agents + alert emails from Woonbot, Pararius, Funda, Rentslam, Huurwoningen | IMAP UNSEEN poll every 20 s (BODY.PEEK), tracking-link unwrapping | Telegram, ntfy | No, by design | No | Railway/systemd |
| 20 | 65456u/housing-monitor-ts | 0 | 2026-07-07 | MIT | Plaza, roofz.eu | plugins | console, desktop, email | Auto-respond (off by default, dryRun, baseline, maxPerPoll) + IMAP-driven form fill | No | Next.js; systemd/Docker |
| 21 | littledivy/keyturn | 0 | 2026-07-26 | MIT | Pararius | curl_cffi reads, Selenium for forms | SMTP | Yes | rule-based score | Docker; multi-user invites |
| 22 | nisarmada/easyHouse | 0 | 2026-09-20 | none | Pararius, Kamernet, Funda, Huurwoningen, HousingAnywhere | JSON-LD, `__NEXT_DATA__`, loaderData; page-1 polls 45-90 s | email | No | No | FastAPI; cross-site dedup; radius filter |
| 23 | tommasozf/rentbuster | 1 | 2026-09-15 | MIT | Pararius, rent-buster.nl | Playwright + stealth; PDOK + LV-WOZ | Telegram, Discord, Apprise | No | Gemini reads ads; WWS points model | Docker + Postgres |
| 24 | casaolandese/housing-bot | 0 | 2026-09-23 | none | Kamernet, DirectWonen | `__NEXT_DATA__` | email | No | No | GitHub Actions |
| 25 | Tessavana/vierkeerdehuur | 0 | 2026-08-23 | none | Eindhoven: 10 sources | requests + Playwright fallback | Telegram with /applied, /viewing, /rejected | No | rule tags | Actions + Pages |
| 26 | JX0821/XIOR-Monitor | 21 | 2026-06-22 | none | Xior | undetected-chromedriver (headed) | Telegram | No | No | Windows PC |
| 27 | brenocq/groningen-hunter | 6 | 2025-05-29 | MIT | Pararius, Kamernet, 123Wonen, Gruno | per-site | Telegram | No | No | Docker |
| 28 | Appixo/WoningNet | 0 | 2026-09-23 | none | WoningNet DAK Utrecht, nieuwbouw.nl | OutSystems JSON (anonymous) | Discord | No | No | Actions |
| 29 | simionov-andrei/kamernet-bot | 0 | 2026-08-29 | none | Kamernet, Pararius | cloudscraper | Telegram with ready-to-paste reply | No, by design | No | local |
| 30 | jieson-ai/housing-ops-nl | 0 | 2026-09-02 | none | Funda, Pararius, Kamernet | Playwright + JSON-LD | files | drafts letters | Claude Code skill: WWS cap, income and registration checks | local |

Also noted (VERIFIED): social-housing auto-reactors SBalcioglu/WoonnetBot and Stefan142/WoonNetRijnmondreact (DirectKans 20:00-20:15 window; "Woonnet Rijnmond actively employs bot detection"), r4q0/Woningnet-Auto (reacts to keep WoningNet zoekpunten), koveseb/auto-woningnet; stekkies-apply (parses Stekkies match emails over IMAP, fills forms with Browserbase + Stagehand); flathunters/flathunter (1,062 stars, AGPL, Germany/Italy/Spain only, 2captcha/Capmonster integration) as the international reference architecture.

### 5.3 Data-access catalogue (VERIFIED from cited code and docs)
- Funda: web search is POST `listing-search-wonen.funda.nl/_msearch/template` (NDJSON, template `search_result_20260227`); base URL from `window.__NUXT__.config.public.openSearch.baseUrl`. Akamai needs a primed `bm_s` cookie and a current TLS fingerprint (curl_cffi `safari2601` 12/12 vs `requests` 0/12 from one IP; "a bot score that worsens with volume"). Mobile API got Firebase App Check around 2026-08-19; the detail endpoint `listing-detail-page.funda.io/api/v4/listing/object/nl/{id}` still works. IPv4 only.
- Pararius: Cloudflare on .nl since ~2026-03 and on .com now; workarounds patched quickly (Hestia's author suspects Pararius watches the repo). Search with `X-Requested-With: XMLHttpRequest` returns JSON with HTML cards; detail pages carry JSON-LD. robots.txt disallows `/contact/*`.
- Kamernet: `__NEXT_DATA__` on `kamernet.nl/huren/...` (CSS classes change every deploy); messaging at `/en/start-conversation/{id}` after `/oauth/signin`, premium required, automated replies breach ToS.
- Holland2Stay: encrypted envelope at `/api/__enc__` after a Turnstile clearance token; operation whitelist; `addNewBooking` removed from the public API; datacenter IPs blocked.
- Zig/Hexia social portals (Woonnet Haaglanden, Klik voor Wonen, Roomspot, Wooniezie, Plaza, Thuis in Limburg, Frieslandhuurt and ~17 more): `/portal/object/frontend/getallobjects/format/json`, `getobject`, `react`, `getreageerconfiguration`. Stable JSON.
- WoningNet DAK (`{regio}.mijndak.nl`): OutSystems; anonymous session, `moduleVersion`, per-action `apiVersion` from generated JS, region bind, then `DataActionHaalUitgelogdAanbod`. Versions rotate every deploy. Most supply allocated by inschrijfduur, so speed only matters for loting and free-sector units.
- Vesteda: POST `vesteda.com/api/units/search/facet` with `{}` returns all units with coordinates. SSH XL: anonymous `POST /api/v1/offering/all`. ROOM/DUWO: login plus paid membership. HousingAnywhere: `__staticRouterHydrationData`, `/api/*` disallowed. Xior/OurDomain/OurCampus: RENTCafe.

### 5.4 Design lessons worth copying
- Email-first for Funda and Pararius (their free alert mails), direct fetch only as optional fallback from the user's residential IP. Running local-first is a structural advantage: datacenter IPs are blocked by Funda, Holland2Stay and several agents.
- Safety rails: dry-run default, baseline-on-enable, per-poll caps (housing-monitor-ts); hard reply caps (kamernet-mcp); "reject only on positive evidence" and never retry a 403 (casaolandese); shadow mode for new scrapers and absence-based status inference (FlatRadar); zero-results and error digests per source (Hestia).
- Dedup lesson: Letify disabled Huurwoningen because of duplicate spam; Hestia dedups on normalized address + city over 180 days. Use BAG address IDs.
- Licensing: Hestia has no license (do not copy code), pyfunda is AGPL, FlatRadar is non-commercial. Letify, kamernet-mcp, kamernet-radar, huurradar, keyturn, housing-monitor-ts, rentbuster are MIT.

## 6. Legal, terms-of-service and platform constraints

- **Platform terms.** Kamernet: automated replies breach its terms and risk an account ban (VERIFIED, kamernet-mcp README); messaging needs Premium. Pararius robots.txt disallows `/contact/*` (VERIFIED, FlatRadar recon). ImmoScout24 (DE) bans bots in AGB 8.2 while selling its own auto-apply (VERIFIED). A user automating their own account is a contracting party, so the practical risk is an account ban rather than a lawsuit; German BGH I ZR 224/12 held screen scraping generally lawful unless it circumvents technical protection (REPORTED). Design implication: per-source risk labels, conservative defaults on Kamernet and portals with explicit bans, notify-only or approve-first where a ban would hurt.
- **EU AI Act Art. 50** (REPORTED from the legal text by the international stream; not legal advice): from 2026-08-02, systems that interact with people must disclose that they are AI at the first interaction; the open-source exemption (Art. 2(12)) does not cover Art. 50; a private individual using the system personally is exempt as deployer (Art. 2(10)), but the provider design duty remains. Our fit scoring ranks listings, not people, so the Annex III credit-scoring category likely does not apply.
- **GDPR.** Keeping tenant documents on the user's machine is our strongest privacy story. GDPR Art. 22 and the CJEU SCHUFA ruling (C-634/21) let rejected tenants ask for human review of automated scoring (REPORTED).
- **Dutch rental law hooks the agent should know** (background knowledge, not re-verified today except where marked): Wet betaalbare huur (1 July 2024) regulates middle rent at 144-186 points (2026 bounds EUR 932.93-1,228.07, REPORTED); Wet vaste huurcontracten (1 July 2024) limits temporary contracts to specific groups; Wet goed verhuurderschap (1 July 2023) caps deposits at two months' base rent and requires transparent, non-discriminatory selection; agency fees cannot be charged to tenants when the agent works for the landlord (VERIFIED on !WOON); the Huurcommissie can test the initial rent, with retroactive effect when requested within 6 months (VERIFIED on WoonBusters).
- **Open-source licences of prior art** (VERIFIED): Hestia has no licence (do not copy), pyfunda is AGPL, FlatRadar is PolyForm Noncommercial, Fredy has a Commons Clause; Letify, kamernet-mcp, kamernet-radar, huurradar, keyturn, housing-monitor-ts and rentbuster are MIT.

## 7. What users say: reviews, Reddit, press, regulators

Trustpilot figures VERIFIED on 2026-09-23 (read through a summarizing fetch; quotes paraphrased). What an individual reviewer alleges is still an allegation. Reddit threads were read via an archive API (VERIFIED that the posts exist). Press items VERIFIED on the publisher's page unless marked.

### 7.1 Trustpilot scores

| Service | Score | Reviews | Dominant complaint | Dominant praise |
|---|---|---|---|---|
| Rentbird | 4.7 | 1,999 | Auto-renewal, hard cancellation, delayed 14-day refund (only visible when filtering to 1-2 stars) | Fast alerts, home in 1-3 weeks |
| Stekkies | 4.5 | 2,779 | Redirected to other paid sites; already-rented listings; 2-month minimum; charged after cancelling | Alerts hours before agents' mailing lists |
| RentSlam | 4.7 | 329 | Must cancel on both website and Google Play | Alerts before source sites |
| RentHunter | 4.3 | 357 | Listings gone when checked | Instant alerts, application tracking |
| Uprent | 4.2 | 46 | Sometimes sends several applications to the same ad (Aug 2025) | Auto-apply found a home in 5 days |
| Findify | 4.0 | 12 | Too few reviews | One-click apply |
| Huurstunt | 3.5 | 1,556 | Trial converts to paid, charges after cancel, incasso threats, copied listings | A minority say "worth it" |
| Rentola | 2.0 | 694 | EUR 1 trial becomes EUR 39-40/month, refunds denied, Intrum collection | Rare charge reversals |
| Huurportaal | 1.9 | 527 | Cancel link disappears; users made to waive withdrawal right; Intrum | One refund |
| Rentumo (.nl) | 4.1 | 1,270 | EUR 4 for 4 days then EUR 40/month; charges after cancel | Named support staff |
| Huurzone | 4.3 | 8,290 | "3-day trial" is really a continuous subscription | Easy, many listings |
| Kamernet | 3.3 | 3,101 | Paid premium but landlords do not reply (e.g. 40 messages, 0 replies); fake landlords with AI photos; 24 h pre-renewal cancel rule | Direct contact, large supply |
| Huurwoningen | 4.2 | 3,366 | Auto-renewal, EUR 50-80 incasso fees, copied listings | Fast alerts, one-click apply |
| Pararius | 4.7 | 815 | Stale listings, a booking.com scam attempt, re-listing at different prices | UI, email alerts |
| Direct Wonen | 3.4 | 308 | Auto-renewal EUR 10.95 per two weeks; 1 reply to 30+ requests | Almost none |
| HousingAnywhere | 3.3 | 5,988 | Hidden tenant-protection fee, deposits not returned, scam listings | Easy booking, secure payment |
| Funda | 1.7 | 105 (unclaimed) | Makelaars never reply; always "rented" | Few |
| Holland2Stay | withheld (guideline breach, fake reviews removed) | 2,421 | Lottery wins or bookings cancelled over documents; slow deposit refunds | Good-location studios |
| WoningNet | 1.6 | 24 (unclaimed) | Opaque allocation; 4-15 year waits | None |

Observation (VERIFIED): the high scores of alert services come from active review solicitation; their subscription complaints only appear when filtering to 1-2 stars.

### 7.2 Ranked pain points
"Services" = number of the Trustpilot profiles above showing the theme.

| Rank | Pain point | Services | Other evidence |
|---|---|---|---|
| 1 | Listings already rented, stale or recycled | 14 | Radar (Jun 2025) confirmed on Rentola, Huurportaal, Rentumo; BD/ED (Jan 2025) found listings rented for years; Reddit alerts "fully booked" minutes after posting |
| 2 | Subscription traps: trial auto-converts, hard cancellation, charged after cancelling | 13 | Consumentenbond 2020: "one-time fee" framing hid recurring subscriptions |
| 3 | Double paywall: aggregator sends you to another site that also charges | 10 | Reddit r/PaleisTeHuur (Feb 2026): "30 euros to Stekkies, Rentbird or Rentslam only to land on another site that wants 30 euros again" |
| 4 | Landlords or agents never reply, even to fast applicants | 8 | Reddit r/TheHague: "2 replies out of 60 sent" |
| 5 | Refunds denied, even within the 14-day withdrawal period | 9 | |
| 6 | Debt collectors (incasso, Intrum) with EUR 10-70 penalties | 7 | Reddit r/Netherlands (Jan 2026) Huurstunt warning |
| 7 | Fake listings or fake landlords on legitimate platforms | ~6 | Opgelicht?! (Apr 2025) fake ads on huurwoningen.nl; TikTok fake student ads 175 reports in H1 2026 vs 21 before (DutchNews/NOS, Aug 2026) |
| 8 | Speed arms race: alerts are a commodity, everybody replies in the same minute | Reddit | A landlord got 8 perfect replies within 1 minute on Kamernet and suspected bots (r/NetherlandsHousing) |
| 9 | Irrelevant alerts, broken filters, duplicates, duplicate applications | 6 | Letify author saw duplicates mainly between Huurwoningen and Pararius |
| 10 | Eligibility: 3-4x gross income, household type, students-only | Reddit + TP | "4 times the rent (7k2/month)", "30% ruling doesn't matter" |
| 11 | Documents demanded before any viewing, and privacy fear | Reddit, press | Same pattern as scammers (Opgelicht?!) |
| 12 | Misleading success marketing | Reddit | "98% find a place in 3 months" claims |
| 13 | Support unreachable | 5 | |
| 14 | Discrimination against internationals, couples, students | TP + Reddit | Utrecht student: ~1 year, ~EUR 500 on subscriptions, dozens of viewings |
| 15 | Rent above the legal WWS maximum, nobody flags it | Press | Argos (Aug 2026): 60% of 2,637 Kamernet room ads above legal max, Amsterdam 97%; WoonBusters: 48% of testable listings |
| 16 | Astroturfing in Reddit advice spaces | Reddit | r/NetherlandsHousing AutoModerator pushes Stekkies tracking links (REPORTED allegation about ownership) |

### 7.3 Tactics that work (Reddit, VERIFIED threads)
- Call instead of email ("beller is sneller"): calling 30 s after an alert got the first viewing slot (r/TheHague, 74 upvotes).
- Full document pack ready; submit interest on the day of each viewing; send friends to viewings you cannot attend.
- Use aggregators to learn which corporations and agents hold suitable stock, then register with them directly; keep a curated agent list; agents' private networks see listings before they are public.
- Motivation letter in Dutch; redact unrelated data on documents; track applications in a spreadsheet (the pain is re-entering the same data everywhere).
- From abroad: arrive first; "if you can't physically see the apartment you will 99% be scammed".

### 7.4 Regulators and press (VERIFIED unless marked)
- Consumentenbond (18 Jun 2020): 12 of 17 sites charged EUR 9.95-49.95 to contact landlords as "one-time" but recurring; complaint to ACM, no enforcement outcome found.
- ACM sanctioned Direct Wonen in 2014 (REPORTED). ACM fined "Huurbegeleiding" and "Financial Media" in 2016 for misleading house seekers (REPORTED, ACM decision PDF title seen in search).
- BD/ED investigation via Vastgoed Actueel (6 Jan 2025): 15 aggregators, up to EUR 39.99/month, listings rented for years; ACM said it cannot tackle all cases.
- Radar/Emerce (9-10 Jun 2025): Rentola, Huurportaal, Rentumo showed unavailable homes only visible after paying; ACM issued warnings only.
- Tweede Kamer answers (4 Dec 2025): ~300 rental-fraud reports to Fraudehelpdesk in 2025, about half with financial loss; national rental registry proposal expected Q1 2026 (status not verified).
- DutchNews 2026: private rental supply shrinking since the Wet betaalbare huur (EUR 2,000+ rentals now 41% of supply; private rentals in university cities down 19% over 3 years; student-room shortage 20,200+).
- !WOON: tenants may not be charged mediation or contract fees when the agent also works for the landlord; reclaimable for up to 20 years.

### 7.5 Scam-signal checklist for the detector (sources: Fraudehelpdesk, Kamernet, !WOON, DutchReview Jul 2026, Opgelicht?! Apr 2025, Trustpilot; all VERIFIED)
Listing level: price far below comparables; photos found elsewhere (reverse image) or non-Dutch fixtures; address missing from BAG or mismatching Street View; same listing in several cities or re-listed at different prices; anonymous advertiser with no KvK; brand-new advertiser domain; home exists only on a scraper site and never on a primary source; over-detailed story text or "moved abroad" narrative; new landlord profile with AI-generated photos; source is TikTok, Facebook groups or Marktplaats; rent above WWS max (illegal, not a scam).
Conversation level: landlord abroad and no viewing; keys by DHL or post; early push to WhatsApp or personal email; refuses video call or viewing; urgency pressure; ID/payslips/bank statements before any viewing (weak alone, legit agents do this through portals); "you cannot register at the address"; named landlord is not the Kadaster owner; viewing in a short-stay unit.
Payment level (hard red flags): any payment before viewing or signed contract; foreign IBAN; Western Union, MoneyGram, gift cards, cash; fake Booking.com/Airbnb escrow or lookalike domains; mediation or "administration" fees charged to the tenant.

## 8. Master feature matrix

Columns: Upr = Uprent, Fdy = Findify, RHn = RentHunter, RBd = Rentbird (incl. Plus), Stk = Stekkies, RSl = RentSlam, WBu = WoonBusters, HPg = HuisPing, Par+ = Pararius+, Kmn = Kamernet Premium, HSt = Huurstunt (stands in for the Rentola/Huurportaal/Huurwoningen paywall model), Hes = Hestia (best open-source hosted bot), NPF = nl-property-finder as planned.

Marks: Y = has it (VERIFIED on own page unless the cell says R for REPORTED), P = partial, $ = only in an expensive or human-service tier, N = not offered or not stated, ? = unclear. In the NPF column, **GAP** means at least one competitor has it and our plan does not; **NEW** means nobody has it and the plan does.

### 8.1 Business model and trust

| Feature | Upr | Fdy | RHn | RBd | Stk | RSl | WBu | HPg | Par+ | Kmn | HSt | Hes | NPF |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Cost for full feature set | EUR 29/mo | EUR 56.99/2 mo | EUR 34.90/mo | EUR 16-29/mo | EUR 16.65-29.95/mo | EUR 16.65-29.95/mo | EUR 3.99-5.99 | EUR 9.95-24.95/mo | EUR 29.95/mo (R) | EUR 29/2 wk | EUR 29.95/mo | Free | Free |
| Useful free tier | Y | N (3-day trial) | Y | N | N | N | Y (09:00 digest) | Y (19:00 digest) | Y (daily email) | P (no messaging) | P (no messaging) | Y | Y |
| No subscription or renewal risk | N | N | N | N | N | N | N | Y (no card trial) | N | N | N | Y | Y |
| Open source, self-hostable | N | N | N | N | N | N | N | N | N | N | N | P (source visible, no license) | Y **NEW** |
| Documents and credentials stay on user's machine | N | N | N | N | N | N | N | N | N | N | N | N | Y **NEW** |
| Runs from residential IP (fewer blocks) | N | N | N | N | N | N | N | N | n/a | n/a | N | N | Y **NEW** |
| Human agent service | $ (EUR 749) | N | $ (Coached, R) | $ (EUR 1,794) | N | N | N | N | N | N | N | N | N (by design) |

### 8.2 Coverage and speed

| Feature | Upr | Fdy | RHn | RBd | Stk | RSl | WBu | HPg | Par+ | Kmn | HSt | Hes | NPF |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Claimed sources | 240+ (116 elsewhere) | in app only | 1,100+ | 1,400+ | 1,000+ plus social media | 1,500+ | 1,000+ | 100 | own | own | 300+ | ~36 | all NL platforms |
| Free-sector portals (Funda, Pararius, Kamernet) | Y | Y | Y | Y | Y | Y | P (agent sites focus) | Y | own | own | Y | Y | Y |
| Agent (makelaar) sites directly | Y | ? | Y | Y | Y | Y | Y | P (42 listings) | N | N | Y | Y | Y |
| Social housing listings | ? | ? | ? | ? | N | Y | N | Y | N | N | ? | Y | P (unclear) **GAP** |
| Social housing auto-react and points keeping | N | N | N | N | N | N | N | N | N | N | N | N | N **GAP** (only OSS woningfinder, WoonnetBot) |
| Student housing booking (Holland2Stay, SSH, Xior) | ? | ? | ? | ? | P (rooms) | P | N | N | N | P (rooms) | N | N | P (polling only) **GAP** (OSS FlatRadar books up to payment) |
| Social-media groups | N | N | N | N | Y | N | N | N | N | N | N | N | N |
| Alert-email ingestion (IMAP) | N | N | N | N | N | N | N | N | N | N | N | N | Y **NEW** |
| Off-market or exclusive listings | Y (landlords list on Uprent) | N | N | $ (Plus) | N | N | N | N | N | N | N | N | P (agent newsletters via IMAP) |
| Claimed detect-to-alert time | "within seconds" | ~10 s detect, 3 s median apply | 30 s | 30 s | 30 s (~12 s pipeline) | 30 s | median 24 s + ~2 min scan | median 5 min | instant (R) | Early Bird (R) | immediate option | few minutes | 90 s poll or IMAP IDLE **GAP** (slower than 30 s claims on hot sources) |
| Publishes measured latency | N | Y | N | N | P | N | Y | Y | N | N | N | N | N **GAP** |

### 8.3 Matching, data and safety

| Feature | Upr | Fdy | RHn | RBd | Stk | RSl | WBu | HPg | Par+ | Kmn | HSt | Hes | NPF |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Multiple search profiles | ? | ? | ? | Y (5) | Y (4) | Y (4) | ? | Y (1-3) | Y | Y | Y | P | ? **GAP** (make explicit) |
| Travel-time or commute filter | Y (extension) | N | N | N | Y (walk/bike/car/transit) | Y | N | N | N | N | N | N | N **GAP** |
| Map-drawn area or radius | N | N | N | N | Y | P (neighbourhood) | N | N | ? | Y (radius) | N | N | ? **GAP** |
| LLM fit scoring | P | N | N | N | N | N | N | N | N | N | P ("AI") | N | Y |
| Eligibility pre-check (income multiple, students-only, household) | N | N | N | N | P (sharing flag) | N | P (income calculator) | N | N | N | N | N | P **GAP** (make explicit; OSS huurradar does it) |
| Cross-site dedup | ? | ? | ? | ? | ? | ? | ? | ? | n/a | n/a | N (copies) | Y | Y |
| Re-verifies listing is still available | ? | ? | Y | N | N | N | Y | N | n/a | n/a | N | N | N **GAP** |
| Competition signal (responses already received) | N | N | N | P ("chance" per review) | N | N | N | Y | Y (R) | N | N | N | N **GAP** |
| WWS legal max rent per listing | P (price-check) | Y | P ("below market") | N | N | N | Y | N | N | N | N | N | N **GAP** |
| Price history, time on market, relisting | N | N | N | N | N | N | Y (market report) | N | N | N | N | N | N **GAP** |
| Official property facts (BAG m2, energy label, WOZ) | Y (Home Checker) | N | N | N | N | N | Y | N | N | N | N | N | N **GAP** |
| Neighbourhood data (crime, population) | Y (Ghettometer) | N | N | N | N | N | N | N | N | N | N | N | N **GAP** |
| Scam detection | N | N | Y | $ (Plus pre-check) | P (trusted sources + checker) | N | P (links to source) | N | ? | P (screened) | N | N | Y |
| "Is this listing real and where else is it" lookup | N | N | N | N | Y | N | N | N | N | N | N | N | P |
| Paywall avoidance | P | ? | P | N | Y (free-only default) | N | Y (never paywalls) | Y | n/a | N | N | Y | Y (paywall router) |
| Agency directory with registration rules | Y (3,286) | N | N | N | N | N | Y (1,227) | N | N | N | N | N | N **GAP** |
| Chance estimate (matches per week, pressure) | N | N | N | P | Y (expected matches/week) | N | Y (Kansen-checker) | N | N | N | N | N | N **GAP** |

### 8.4 Applying and after

| Feature | Upr | Fdy | RHn | RBd | Stk | RSl | WBu | HPg | Par+ | Kmn | HSt | Hes | NPF |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI-written message per listing | Y | P (saved intro) | Y | Y (AI letter) | P (template) | P | N | N | N | N | N | N | Y |
| One-click apply | Y | Y | Y | N | N | N | N | N | Y (Rental Profile, R) | N | P | N | Y |
| Fully automatic apply | Y (Premium) | Y (Pro) | advertised, not sold (R) | $ (Plus, human) | N | N | N | N | N | N | N | N | Y |
| Best-free-channel routing across form, platform, email | N | N | N | N | N | N | N | N | N | N | N | N | Y **NEW** |
| Auto-apply safety rails (caps, dry run, pause, no duplicates) | P (filters, pause; duplicates reported) | ? | Y (user edits, "invents nothing") | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | P **GAP** (make explicit) |
| "Call now" prompt with agent phone | N | N | N | N | N | N | N | N | N | N | N | N | N (add) |
| Tenant dossier and document vault | P (profile) | Y (saved docs) | Y (shareable link) | $ (Plus) | N | N | N | N | Y (Rental Profile, R) | N | N | N | P (document-request triage only) **GAP** |
| Search buddy, household or group | Y (share Premium) | Y (invite up to 2) | Y (2, one dossier) | Y (1 buddy) | Y (free buddy) | N | N | N | N | N | N | N | N **GAP** |
| Unified inbox for landlord replies | Y | Y | P (reply status) | N | N | N | N | N | N | Y (own) | N | N | Y |
| Reply triage (invite, docs, rejection, offer, payment, scam) | N | N | N | N | N | N | N | N | N | N | N | N | Y **NEW** |
| Auto-answer routine replies | P ("AI-email on autopilot") | N | N | N | N | N | N | N | N | N | N | N | Y |
| Viewing auto-booking in user availability | N | N | N | $ (Plus, human) | N | N | N | N | N | N | N | N | Y **NEW** |
| Viewing route planning and calendar sync | N | N | N | N | N | N | N | N | N | N | N | N | N (add) |
| Application pipeline board | Y (Kanban) | P | Y | N | Y (applied/visited) | N | N | N | N | N | N | N | P (Action inbox) **GAP** |
| Contract review | Y (free AI) | N | Y | $ (Plus) | N | N | N | N | N | N | N | N | N **GAP** |
| Post-signing rent reduction (Huurcommissie) | N | N | N | N | N | N | Y (dossier starter) | N | N | N | N | N | N **GAP** |
| Settling-in help (utilities, registration) | Y | N | Y | N | P (guides) | N | N | N | N | N | N | N | N **GAP** |

### 8.5 Channels and interfaces

| Feature | Upr | Fdy | RHn | RBd | Stk | RSl | WBu | HPg | Par+ | Kmn | HSt | Hes | NPF |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Native mobile app | web | Y | Y | Y | Y | Y | Y | N | Y | Y | ? | Y (iOS) | N (ntfy app, PWA) **GAP** |
| Push | Y | Y | Y | Y | Y | Y | Y | N | Y (R) | Y | ? | Y | Y (ntfy) |
| Email alerts | Y | Y | ? | ? | Y | Y | Y | Y | Y | Y | Y | N | ? **GAP** |
| WhatsApp | N | N | N | Y (R) | Y (R) | N | N | N | N | N | N | N | N **GAP** |
| Telegram | Y (channel) | Y | N | N | N | N | N | N | N | N | N | Y | Y |
| SMS | N | N | N | N | N | N | N | N | N | N | N | N | N (Woonspotter has it) |
| Desktop notifications | N | N | N | N | N | N | N | N | N | N | N | N | Y |
| Listing translation and multi-language UI | Y (EN/NL/RU, English summaries) | ? | Y (6 languages, translations) | EN/NL | EN/NL (+DE, UK markets) | EN/NL | NL | NL/EN | NL/EN | NL/EN | NL | NL/EN | ? **GAP** |
| Browser extension (autofill on thousands of agent sites) | Y (7,000 sites) | N | N | N | N | N | N | N | N | N | N | N | N **GAP** |
| Public API | N | N | N | N | N | N | Y (data) | N | N | N | N | N | Y (REST) |
| MCP server and CLI for agents | N | N | N | N | N | N | N | N | N | N | N | N | Y **NEW** (OSS kamernet-mcp is single-site) |

### 8.6 International benchmark columns (compact)

Let = Lettie (UK), Trw = Traumwohnung.ai (DE), HSc = HomeScout (IE), IS+ = ImmoScout24 Suchen+ (DE), Fre = Fredy (OSS). All VERIFIED per the international stream unless marked.

| Feature | Let | Trw | HSc | IS+ | Fre | NPF |
|---|---|---|---|---|---|---|
| Auto-contact | Y (Pro) | Y | Y (max 3/day) | Y (beta) | N | Y |
| Reply classification / inbox | Y | Y (important-only alerts) | Y (Smart Inbox) | own inbox | N | Y |
| One-click or auto viewing confirmation | Y (auto-book) | P (one-click draft) | P (calendar export) | N | N | Y |
| Explained match score | P (swipe calibration) | P | Y ("strongest reasons") | P (Chancen-Check) | N | P **GAP** (add reasons) |
| Contract review | N | N | Y | N | N | N **GAP** |
| Dossier completeness score | N | Y (92/100) | N | Y (Bewerbermappe) | N | N **GAP** |
| Weighted scam score with override | N | N | N | P (filters) | Y | P **GAP** (make explicit) |
| Transit travel time | N | Y (commute criterion) | Y | N | Y (MOTIS) | N **GAP** |
| MCP server with OAuth for hosted assistants | N | N | N | ChatGPT app | Y | P (MCP planned; add OAuth) |
| Multi-platform | N (Rightmove only) | P (3 portals) | Y | N | Y (26) | Y |
| Free and local | N | N | N | N | Y (self-host) | Y |

## 9. Features to add to the plan (prioritized)

Effort: S = days, M = 1-3 weeks, L = more than 3 weeks for one developer. "Who has it" names the best existing example; "nobody" means we found no product or repo doing it in NL or abroad.

### P0: close every gap where a competitor is ahead today, plus safety we cannot ship without

| # | Feature | Why | Who has it | Effort |
|---|---|---|---|---|
| 1 | **Availability re-verification and freshness score.** Re-check the source before alerting and before any auto-send; mark "taken" only after 2 absent cycles; show "last seen live at source N min ago"; never act on listings that exist only on scraper or paywall sites. | Stale or already-rented listings are the number 1 complaint (14 of 19 Trustpilot profiles). Wasted applications also cost reply rate. | RentHunter, WoonBusters, Huurzone; HomeScout (IE, 2-crawl rule) | M |
| 2 | **WWS / Wet betaalbare huur check per listing, with official property facts.** Points estimate from BAG (PDOK) floor area and build year, EP-Online energy label, LV-WOZ value; output legal max rent, sector (up to 143 points social, 144-186 regulated middle rent, 187+ free), overcharge in EUR, "signal, not proof" wording, Huurcommissie note. Flag advertised m2 far above BAG m2 and addresses with no residential use. | 48% of testable listings ask more than the legal max (WoonBusters, summer 2026); 60% of Kamernet rooms (Argos, Aug 2026). Two small NL players show it; no portal does. | Findify (per card), WoonBusters, Uprent Home Checker; OSS rentbuster, housing-ops-nl | M |
| 3 | **Eligibility and disqualifier extraction, with explainable scores.** Claude fills missing listing fields and extracts income multiple (3x-4x gross), household rules (no sharing, couples only), students-only, "geen internationals", guarantor, pets, registration allowed; compare with the household profile; reject only on positive evidence. Every score shows top reasons and concerns; hard, soft and notify rules; a rejection log; offline re-scoring when the user changes weights. | Users pay and apply to homes they can never get (Rentbird, Stekkies complaints). Explanations build trust in auto-apply. | OSS huurradar, housing-ops-nl; abroad Traumwohnung.ai (LLM fills fields), HomeScout ("strongest reasons"), toronto-ap-finder (rejection log) | S |
| 4 | **Tenant dossier and local document vault.** Encrypted local store; NL document set (ID, werkgeversverklaring, loonstroken, IB60 or UWV verzekeringsbericht, verhuurderverklaring); completeness score; per-listing one-page PDF; one link per recipient with expiry, access log and revoke (served from the local instance or a one-off export); ID copies watermarked KopieID-style; other originals kept byte-identical because landlord fraud tools check PDF metadata; progressive disclosure (contact first, income after viewing when the agent allows). | Document requests before viewing are a privacy fear and a scam vector; a ready pack is a top Reddit tactic. Abroad this is mature (DossierFacile, Canopy, SingleKey). | RentHunter (shareable link), Pararius+ Rental Profile, Findify saved docs; DossierFacile (FR, gov) | M |
| 5 | **Auto-apply safety rails.** Modes per source: notify only, approve-first, auto; dry-run default; silent first run (baseline the backlog); per-hour, per-day and per-agency caps with jitter; one application per physical home across all sources (BAG-ID dedup); pause on session expiry, captcha or 403 (never retry a 403 blindly); kill switch; audit log with model name and reasoning for each sent message. | Uprent users report duplicate applications to the same ad; landlords notice bot floods; a Kamernet ban or a burned agency relationship is costly. | OSS housing-monitor-ts, kamernet-mcp, Homelander, rightmove-mcp (dry run + consent flag); HomeScout (3/day cap) | S |
| 6 | **Prompt-injection and counterpart-bot guards.** Treat listing and reply text as untrusted data; detect landlord-side AI agents (persona names, latency, templated signatures); cap automated turns per thread; never commit money, sign, negotiate price or pass ID, selfie, card or liveness steps; hand those to the human. | Our agent will often talk to AI leasing agents (EliseAI, Entrata ELI+, Hybr, Latch reply in seconds). A malicious listing can try to steer an auto-replying agent. | nobody end to end; open-properties ("treat listing text as untrusted") | S |
| 7 | **AI disclosure line on automated messages (default on).** Short, polite footer in Dutch/English that the message was prepared with an assistant on behalf of the named tenant. | EU AI Act Art. 50(1) applies from 2026-08-02; the open-source exemption does not cover Art. 50 (international report, legal text; not legal advice). Honesty also helps with landlords who suspect bots. | nobody | S |
| 8 | **Commute scoring.** Door-to-door time to several destinations by bike, transit and car; filter plus score input. Free and local: Transitous/MOTIS or OpenTripPlanner with NL GTFS for transit, OSRM or Valhalla for bike and car. | Stekkies, RentSlam and Uprent sell it; abroad it is standard (Zoopla, Bien'ici, Fredy). | Stekkies, RentSlam, Uprent extension; Fredy (OSS) | M |
| 9 | **Multiple search profiles, polygon areas, import of a portal search URL.** | Table stakes: paid services offer 3-5 profiles; Stekkies and Renthaven offer drawn areas; importing an existing Funda or Pararius search URL makes onboarding instant. | Rentbird (5), Stekkies (4), RentSlam (4), HuisPing (3); LeaseAlert and Homelander (URL import) | S |
| 10 | **Household and group search.** Co-applicants with combined income, one shared dossier, shared pipeline with votes and comments; group coordinator so the same home is not applied to twice; flag listings that forbid sharing or need a woningdeling permit. | Every major paid service has a search buddy; nobody handles friend groups properly. | Stekkies, Rentbird, Findify (invite up to 2), RentHunter (2, one dossier), Uprent; Roost (UK, shared tracker with votes), Snug (AU, group applications) | M |
| 11 | **Application pipeline board with one-tap wrap-up.** States: found, applied, replied, viewing booked, viewed, interest submitted, offer, contract, rejected, ghosted; follow-up timers; stale-lead detection; after signing, withdraw all open applications and cancel all viewings politely in one action. | Users track in spreadsheets; Uprent, Luntero and RentHunter sell boards; TenantApp (AU) has the one-tap cancel. | Uprent, Luntero Pro, RentHunter, Stekkies; TenantApp | S |
| 12 | **Notification breadth and control.** Apprise integration (email, WhatsApp bridge, Signal, Pushover, Matrix, Discord, SMS gateways) next to ntfy, Telegram and desktop; quiet hours; digest vs instant by score; actionable buttons (approve and send, edit, call, skip, book slot); outbound webhooks for new match, reply and viewing booked. | Rentbird, House Hunter and Huurmatcher sell WhatsApp; Woonspotter SMS; "too many emails" is a complaint; MoteurImmo sells a webhook API. | OSS kamernet-radar and Fredy (Apprise); MoteurImmo (webhooks) | S |
| 13 | **Mobile control surface.** Installable PWA of the local dashboard reachable over Tailscale or a tunnel, with the Action inbox, pipeline and dossier sharing. | Every paid competitor has an app; the Action inbox must work away from the laptop. | Findify, Rentbird, Stekkies apps; Hestia iOS | M |
| 14 | **"Call now" escalation.** For high-score listings from agencies that answer phones, push the phone number, the listing reference (objectcode) and a 3-line Dutch script together with the auto-sent message. | "Beller is sneller": calling 30 s after an alert won the first viewing slot (r/TheHague, 74 upvotes). | nobody | S |
| 15 | **Contract review and reply legal guardrails.** Local check of the huurcontract and of replies: temporary contract only for allowed groups (Wet vaste huurcontracten 2024), deposit at most 2 months' base rent and transparent selection (Wet goed verhuurderschap 2023), no mediation or "administration" fees to the tenant, indexation limits, service-cost breakdown, WWS max; draft a polite pushback. | Uprent gives contract review away; RentHunter includes it; Rentbird charges EUR 1,794 for a human. Illegal fees and temporary contracts are common (WoonBusters: 51-86% of temporary contracts lack a visible ground). | Uprent, RentHunter, Rentbird Plus; HomeScout, Nestor (abroad) | M |
| 16 | **Dutch-first messaging with a pre-qualification block, plus translation.** English summary of every listing; messages in Dutch by default (matching listing language), under ~100 words, citing the street and a listing detail, only facts from the profile, with a fixed fact block (employment, household size, gross income multiple, pets, move-in date, viewing availability); translate replies in the inbox. | Reddit advice is to write in Dutch; copy-paste enquiries get 12-20% replies (HomeScout founder); landlord AIs screen on exactly these facts. | RentHunter (6 languages), Uprent (English summaries); MietRadar, london-property-hunt (message style) | S |
| 17 | **Measured latency per source and adaptive polling.** Record publish, detect, alert and send times; show median and p95 per source; poll hot sources and hours at 15-30 s (jittered, within tolerance), cold ones less, rely on IMAP IDLE for Funda and Pararius; per-source listing lifetime. | Our 90 s poll is slower than the 30 s claims; HuisPing, WoonBusters, Findify, Flatscout and Wohnly publish measured medians. | HuisPing, WoonBusters, Findify; Flatscout (UK), Wohnly (DE), WohnAutopilot (DE) | S |

### P1: exceed everyone (nobody, or only one niche player, has these)

| # | Feature | Why | Who has it | Effort |
|---|---|---|---|---|
| 18 | **Own price history and change events.** Every listing keyed by BAG ID: price changes, days online, relists at different prices, BACK_ON_MARKET and PRICE_REDUCED events that trigger re-scoring. | Negotiation leverage, scam signal, chance estimates. WoonBusters publishes aggregates only. | Huisly (history view); rightmove-mcp, Zoopla, Jinka (events) | S |
| 19 | **Competition and chance signals.** Responses already on the listing where the source shows it, minutes since publish, estimated queue position; per profile: matches per week, median days online, pressure score, and which filter relaxation adds the most matches (preview while editing a search). | Tells the user where speed still matters and where to widen the search. | HuisPing, Pararius+ (R), WoonBusters Kansen-checker, Stekkies; IS24 Chancen-Check, WG-Gesucht Angebots-Insights, Qasa | M |
| 20 | **Agency knowledge base with reputation memory and analytics.** Per agent: registration fee (free/paid/none), selection method (first come, lottery, score), income multiple, documents asked, portal login, phone habits; from our own outcomes: reply rate, median reply time, viewing rate, ghosting, illegal fees asked. Shareable as an optional community dataset. | Users keep curated agent lists by hand; response-rate analytics per agency exist nowhere. | Uprent (3,286 agencies), WoonBusters (1,227 agencies); analytics: nobody | M |
| 21 | **Agency registration autopilot and early-access sources.** Register once (with the user's approval) at each relevant agency's own inschrijving or zoekopdracht form so their exclusive mailings land in the IMAP mailbox; connect the user's own paid accounts (Kamernet Premium, Pararius+) so the paywall router can use them; follow specific buildings or addresses. | Agents' private lists see homes before portals (Reddit); abroad, early access is the main paid feature (IS24 Wartelisten, OnTheMarket "Only With Us"). | nobody in NL; IS24 Pro, Domain off-market, RentReboot (follow a building) | M |
| 22 | **Message A/B testing and learning.** Variants by language, length, tone and structure; track reply and viewing rates per variant and agency type; promote winners automatically. | "Landlords never reply" is pain point 4. | nobody | M |
| 23 | **Scam detector as a weighted, explained, overridable score.** Signals from section 7.5: payment before viewing, keys by post, money-transfer services (weight 3); landlord abroad, no viewing, price 40%+ below our local EUR/m2 median (weight 2); perceptual-hash photo reuse across all ingested listings; BAG existence and usage; KvK lookup; domain age; foreign IBAN; WhatsApp-only; scraper-only listings. Show matched rules, never hide silently, let the user override. | Fake landlords with AI photos on Kamernet; TikTok fake ads up 8x in H1 2026. | Fredy (OSS, weighted), FlagMyListing (UK), HousingAnywhere, RentHunter, Stekkies check tool | M |
| 24 | **Viewing route planner, calendar and tour-link handling.** Parse booking links and slot pickers, pre-fill the pre-screen, book within availability, then order same-day viewings by travel time; CalDAV/ICS or Google Calendar events with contact and listing snapshot; reconfirmations and day-before reminders; "leave now" pings; cancel cleanly. | Auto-booking creates tight schedules; UK and US agent tools require reconfirmation. | nobody in NL; TenantApp and Domain (AU route planning), Flatfox (reminders) | M |
| 25 | **Viewing companion and same-day follow-up.** Per-listing checklist and questions (service costs, energy label, registration allowed, contract type), photo notes and rating, and a same-day "I am interested" message with the dossier. | Converts viewings into offers; Reddit tactic; human-only in NL today. | Rentbird Plus (human); Domain, Jinka (notes and ratings) | S |
| 26 | **Social housing module.** Registration tracker per region (WoningNet, Woonnet Rijnmond, Zig/Hexia portals) with renewal-fee reminders; auto-react with the user's own credentials; in Amsterdam, keep zoekpunten by reacting at least 4 times a month on plausible homes (points are lost after a month without reacting); slaagkans from published allocation results. | No commercial service touches social housing reactions; only archived or tiny OSS tools do. | OSS woningfinder (archived), WoonnetBot, r4q0/Woningnet-Auto | L |
| 27 | **Student housing helpers.** Holland2Stay, SSH, Xior, OurDomain, ROOM: availability timers and form pre-fill up to the payment page (never pay automatically). | First-come or lottery allocation; OSS FlatRadar shows demand. | OSS FlatRadar | L |
| 28 | **Neighbourhood panel.** CBS Kerncijfers wijken en buurten, police open data, Leefbaarometer, noise and flood maps, OSM shops and schools, sun and shade. | Uprent sells this as Ghettometer; it is free open data locally. | Uprent; Fredy, SnagFlat, willhaben Shadowmap (abroad) | M |
| 29 | **Total monthly cost and huurtoeslag.** Rent + service costs + energy estimate from label and m2 + municipal taxes; huurtoeslag eligibility. | Makes cheap-looking but expensive homes visible. | WoonBusters checks, Uprent tax estimate; Apartments.com cost calculator | S |
| 30 | **Registration and permit check.** Can you register (inschrijven) at the address (BAG woonfunctie); does the municipality require a permit for room rental or sharing; "you cannot register" in a reply raises the scam score. | !WOON lists refusal to allow registration as a red flag; expats need BRP registration for a BSN. | nobody | M |
| 31 | **Post-signing assistant.** Huurcommissie initial-rent test within 6 months when WWS shows overcharge (pre-filled); deposit return tracker; move-in inspection report with photos and meter readings; settling-in checklist (BRP, utilities, insurance). | Keeps value after the search; WoonBusters offers a dossier starter only. | WoonBusters (partial), Uprent and RentHunter (utilities); BoligPortal Flyttesyn (DK) | S |
| 32 | **Universal form filler.** Browser extension or userscript that fills agency contact forms from the local profile on sites without native support and reports submissions to the pipeline; also a bridge that runs requests through the user's logged-in browser for walled portals. | Uprent covers 7,000 sites this way; it is the long-tail channel for the paywall router. | Uprent extension; AptSweep, chrischall MCPs (browser bridge) | M |
| 33 | **Source health dashboard.** Last success, zero-results and 403 streaks, typed block reasons (captcha, login, denied), cooldown after an IP burn, shadow mode for new scrapers, daily error digest. | Scrapers break silently; Hestia, FlatRadar and Fredy learned this. | OSS Hestia, FlatRadar, cn-housing-mcp | S |
| 34 | **MCP for Claude.ai and ChatGPT.** Streamable HTTP with OAuth 2.1 and dynamic client registration so hosted assistants can reach the local instance; interview-style search creation; write tools annotated as destructive; secrets never pass through the LLM; server card and llms.txt. | Every big portal abroad now ships a ChatGPT app; no Dutch portal does; Fredy already does this for DACH. | Fredy (OSS), RentReboot | M |

### P2: nice to have

| # | Feature | Why | Who has it | Effort |
|---|---|---|---|---|
| 35 | Honest onboarding: income vs rent reality check (3-4x rule), expected matches per week, suggested cities. | Avoids months of futile searching. | WoonBusters, Stekkies; FlattyBot | S |
| 36 | Fair-treatment guard: keep protected characteristics out of generated messages unless the user opts in; log listings with exclusionary criteria and generate a report for the municipal meldpunt. | Pain point 14; Wet goed verhuurderschap requires transparent, non-discriminatory selection. | Zillow AI mode, Homes AI (fair-housing classifiers) | S |
| 37 | Negotiation drafts (rent, start date, furniture) using WWS and price history, max 2 asks chosen by the user; never offer above asking. | Human-only today. | Rentbird Plus, Uprent Full support; Nestor | S |
| 38 | Local-model option (Ollama) for scoring and triage, Claude for drafting; monthly API budget cap; cheap text pass before vision. | Privacy and cost for a free tool. | zurich-housing-tool, MietRadar, Manceff/leboncoin-bot | M |
| 39 | Photo vision: condition, light and layout tags; detection of AI-generated or doctored photos. | "AI Slop City" complaints abroad; no NL product does it. | Zoopla smart tags, Roost; nobody for AI-photo detection | M |
| 40 | Reverse outreach: publish a seeker profile where portals allow (Kamernet tenant profiles, Rentumo) and periodically email local agents the user's criteria. | Abroad (LocService, Qasa) landlords come to the tenant. | LocService, Qasa, Badi | S |
| 41 | Social-media and Marktplaats ingestion, with a higher default scam weight. | Stekkies advertises social media coverage. | Stekkies, Vastiva | M |
| 42 | GDPR helper letters: data-access request to agencies and a request for human review after an automated rejection (GDPR Art. 22, CJEU SCHUFA ruling). | Screening platforms increasingly decide automatically. | nobody | S |

## 10. User pain points we should explicitly solve

| Pain point (rank from section 7.2) | How nl-property-finder answers it | Feature # |
|---|---|---|
| 1. Stale or already-rented listings | Re-verify at source before alerting or sending; "last seen live" timestamp; ignore scraper-only listings | 1, 18 |
| 2. Subscription traps, refunds, incasso (ranks 2, 5, 6) | Free, no account, no billing. Say so on the first screen of the README and dashboard | n/a |
| 3. Double paywall | Paywall router finds the free route; label "free route found / paid route only"; use the user's own paid accounts only if connected | plan + 21 |
| 4. Landlords never reply | Better first message (Dutch, fact block, listing-specific), A/B testing, call-now prompt, follow-up timers, agency reply-rate memory to spend effort where replies happen | 14, 16, 20, 22 |
| 7. Fake listings and fake landlords | Weighted, explained scam score; reply-level checks for payment requests, keys by post, WhatsApp push; Kadaster/KvK prompts | 23, 30 |
| 8. Speed arms race and bot suspicion | Speed where it matters (adaptive polling, IMAP IDLE) plus quality that does not read as a bot; honest AI disclosure; no floods thanks to caps | 5, 7, 16, 17 |
| 9. Irrelevant alerts, duplicates, duplicate applications | Claude fit scoring with reasons, BAG-ID dedup across sources, one application per home, digest vs instant | 3, 5, 12 |
| 10. Eligibility (income multiple, household, students-only) | Extract requirements from listing text and check against the household before applying | 3 |
| 11. Documents before viewing, privacy fear | Local vault, recipient-specific expiring links, ID watermark, progressive disclosure, legitimacy check on document requests | 4, 23 |
| 12. Misleading success marketing | Publish our own measured latency and outcomes locally; no promises | 17 |
| 13. Support unreachable | Open source: logs, `doctor` command, source health dashboard, GitHub issues | 33 |
| 14. Discrimination | Dutch-first letters, fair-treatment guard, log of exclusionary criteria for a meldpunt report | 16, 36 |
| 15. Rent above the legal maximum | WWS check on every listing and a post-signing Huurcommissie helper | 2, 31 |
| Duplicate applications (Uprent reviews) | One application per physical home across all sources | 5 |
| "Too many emails" (Rentbird) | Quiet hours, score thresholds, digests | 12 |
| Lottery or registration-time allocation makes speed useless (social housing) | Social-housing module that keeps points and reacts on plausible homes | 26 |

## 11. Key sources

Own pages read on 2026-09-23 (VERIFIED): uprent.nl/en-nl (home, pricing, home-checker, ghettometer, contract-review, rental-agencies, rental-platforms) and the Chrome Web Store listing "Uprent - AI Rental Agent"; findify.nl; renthunter.nl/how-it-works; rentbird.nl/en (home, pricing, how-it-works, faq); stekkies.com/en (home, pricing, how-it-works, check-rental-listing, guarantee-and-promise); rentslam.com/en; househunter.online (home, pricing); woonbusters.nl (alerts, huurcheck, kansen-checker, makelaars, marktrapport, kenniscentrum comparisons); huisping.nl; huisly.nl; renthaven.nl/en; huurmatcher.nl/en/huurwoning-alerts; huuralerts.nl; rentumo.nl/en; huurwoning.ai (home, pricing); renturgent.com/nl; woonspotter.com (home, pricing); vastiva.nl; luntero.com (home, pro); huurstunt.nl; rentola.nl/en; huurportaal.nl/en; huurzone.nl; kamernet.nl/en and support.kamernet.nl (Purchasing a Premium Account); woningnet.nl; socialehuurwoningzoeken.nl; nul20.nl (WoningNet slaagkans, 2011).

Third-party (REPORTED): findify.nl comparison articles (RentHunter tiers, Pararius details); nlcompass.com; huisping.nl comparison; search summaries for Pararius+, Huurwoningen.nl, Directwonen, HousingAnywhere, Kamernet Early Bird (via WoonBusters); WWS 2026 bounds (volkshuisvestingnederland.nl and others).

Trustpilot, Reddit, press and regulator sources are listed in section 7 (full URLs in the pain-point stream: trustpilot.com/review/<domain>; Consumentenbond 2020; Vastgoed Actueel 6 Jan 2025; Opgelicht?! 9 Apr 2025; Radar 9-10 Jun 2025; Tweede Kamer 2025Z19432; DutchNews Jun-Sep 2026; wooninfo.nl).

Open-source sources are the GitHub repos named in section 5 (VERIFIED via `gh api`). International sources are listed in the companion file.

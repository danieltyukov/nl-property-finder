# International competitors for nl-property-finder (research date 2026-09-23)

This was read-only research. I did not sign up, log in, request demos or pay for anything, and I changed no repo files. The work ran as six parallel streams:
- US, Canada, Australia and New Zealand (consumer products)
- Germany, Austria, Switzerland (DACH)
- UK and Ireland
- France, Spain, Portugal, Italy, Belgium, Luxembourg, the Nordics, Poland and Czechia
- The landlord side: AI leasing, screening, fraud, scam data and EU law
- Open-source bots, MCP servers, AI startups, and HN/Reddit build reports

## 0. How to read this

**Labels**
- **[V] VERIFIED:** read today on the product's own website, its own GitHub README or repo metadata (`gh api`), its own App Store listing (publisher text pulled from Apple's public catalog API), its own newsroom or press release, or the official legal text.
- **[R] REPORTED:** comes from a third party (press, Trustpilot, Reddit via the Pullpush archive, Hacker News, review blogs, search snippets). The URL is given inline where it matters, and full URLs are in the raw reports.

**Limits**
- The session's shared WebSearch quota (200 calls) ran out early. After that the work relied on direct page fetches, Apple's catalog and review APIs, the GitHub API, the HN Algolia API and the Pullpush Reddit archive.
- These sites blocked fetching (403, 429, Cloudflare or TLS errors), so what is said about them is [R] or taken from their App Store listings:
  - zillow.com (most pages), apartments.com, streeteasy.com, renthop.com, apartmentlist.com, homes.com, yardi.com, rentberry.com
  - realestate.com.au, domain.com.au, flatmates.com.au, trademe.co.nz
  - immowelt.de, homegate.ch, comparis.ch
  - immobiliare.it, casa.it, subito.it
  - pap.fr, visale.fr, Leboncoin's service pages
  - boligportal.dk, hemnet.se, zimmo.be, realo.be, bostad.blocket.se
  - the Zoopla, OpenRent and Daft help centres, Alto, rent.ie, reddit.com, uprent.nl
- A small model summarises WebFetch output, so a few exact figures may be slightly off.

**Raw stream reports** (more detail and full source lists):
- US, CA, AU and NZ consumer: /home/danieltyukov/.claude/projects/-home-danieltyukov-workspace-personal-free-kamerbot/28c051b3-f8a3-42c8-a8b0-09908780245b/tool-results/toolu_01N1s7ixyTBnKQaCusqLWQ68.txt
- FR, ES, PT, IT, BE, LU, Nordics, PL and CZ: /home/danieltyukov/.claude/projects/-home-danieltyukov-workspace-personal-free-kamerbot/28c051b3-f8a3-42c8-a8b0-09908780245b/tool-results/toolu_01HN4un4xFK4irXdvsvUjnpN.txt
- Landlord side, verification, scam data and EU law: /home/danieltyukov/.claude/projects/-home-danieltyukov-workspace-personal-free-kamerbot/28c051b3-f8a3-42c8-a8b0-09908780245b/tool-results/toolu_01WfWtVZLCKXjPJiEhoQwRyC.txt
- Open-source bots, MCP servers and startups: /home/danieltyukov/.claude/projects/-home-danieltyukov-workspace-personal-free-kamerbot/28c051b3-f8a3-42c8-a8b0-09908780245b/tool-results/toolu_01KanoQ3oifzm6n9n5Akb66F.txt
- The DACH and UK/IE reports came back inline, and their content is merged into this report.

---

## 1. Key findings

1. **No product found does the whole loop.** By the whole loop I mean: multi-platform polling, alert-email ingestion, LLM fit scoring, scam scoring, auto-contact, auto-answers to routine replies, auto-booked viewings, and MCP/API access, all free and local-first. The closest products each cover only part of it:
   - **Lettie** (UK): Rightmove only. Auto-sends enquiries, classifies replies and books viewings.
   - **Traumwohnung.ai** (DE): auto-apply plus a reply inbox with one-click drafted viewing confirmations.
   - **HomeScout** (IE): Smart Inbox, and auto-apply capped at 3 a day.
   - **Prems** and **Sherlok** (FR): AI auto-apply, with dossier and guarantor automation.
   - Open-source: **nyc-housing-ai** (US), **immoscout-helper** (DE extension) and **Nestor** (US hackathon).
2. **Fredy (orangecoding/fredy, 1,528 stars) is the open-source feature benchmark.**
   - It has: 26 portals in DE/AT/CH/ES/IT/PT, ntfy and Telegram, an MCP server with OAuth 2.1 for Claude.ai and ChatGPT, weighted scam detection, public-transport travel times and cross-portal dedupe.
   - It lacks: auto-contact, LLM scoring, reply handling and viewing booking.
   - Licence: Apache-2.0 plus Commons Clause, so source-available rather than OSI open source [V]. Do not copy its code.
3. **Portals are becoming agents inside their own inventory.**
   - Apps inside ChatGPT: Zillow, Zumper, Realtor.com, RentCafe, Apartments.com, Redfin, Rightmove, ImmoScout24 DE, idealista, Fotocasa and Imovirtual all shipped one in 2025 and 2026.
   - Some can already act: Zillow AI mode can apply and book tours; the Apartments.com app in ChatGPT can message managers and book tours.
   - None of them works across platforms.
4. **ImmoScout24 now sells its own auto-apply.** Suchen+ Unlimitiert includes the beta "Bewerbungsassistent", while AGB 8.2 still bans third-party bots [V]. Expect enforcement.
5. **Landlords increasingly use AI.** EliseAI, Entrata ELI+, RealPage Lumina, AppFolio, Zuma, Tenant Turner, Leasey.AI, and in the UK Street, Reapit, Alto Lead Flow, Hybr and Latch all reply in seconds. Entrata says renters "mistake ELI for a real person" [V]. Our agent will often be talking to a bot. It will need:
   - loop guards;
   - one structured pre-qualification fact block;
   - tour-link parsing;
   - a hard stop at ID, selfie and card steps.
6. **Scam risk scoring for each listing is the biggest unmet renter need.** Scams and AI-doctored photos dominate recent reviews of Zillow, StreetEasy, Apartment List, Zumper and Rent. No major portal shows renters a risk score. The closest are RentHop HopScore, Fredy, FlagMyListing, Letty and Jinka's fake-listing filter.
7. **Speed is the paywall almost everywhere, and the top complaint.** Examples: SpareRoom Early Bird, Flatmates.com.au early-bird messaging, Sreality paid instant alerts, IS24 Suchen+, IS24.ch TenantPlus, and the silent-renewal models of Rentola, BoligPortal and Lejebolig. A free agent is a clear counter-position.
8. **Verified, reusable tenant dossiers are mature abroad:**
   - DossierFacile (French government, OAuth API, watermarks, links per recipient that expire)
   - Canopy RentPassport, SingleKey, Leboncoin Pass Locataire+
   - Qasa and Hybel (BankID), the idealista solvency certificate, the Flatfox certified debt extract
   - IS24 Bewerbermappe, Snug
9. **Compliance.** From 2 August 2026, EU AI Act Art. 50(1) likely requires AI disclosure at first contact for systems that interact with people. The open-source exemption does not cover Art. 50 [V, legal text]. Default a disclosure footer on auto-sent messages. This is not legal advice.
10. **Dutch items found along the way, for the NL slice:**
    - **Uprent (uprent.nl)** surfaced as an "AI agent for rental home search that ... instantly submits viewing requests on your behalf" and reads landlord emails [R, Product Hunt and Trustpilot snippets; the site returned 403]. It could be a direct NL competitor.
    - HousingAnywhere (Rotterdam) owns Kamernet [R, Wikipedia].
    - OSS: ashokolarov/ParariusBot (13 stars, auto-applies on Pararius) and VinceDome/housing-bot [V, gh].
    - AptSweep lists Funda as "coming" [V].

---

## 2. Closest analogues (tenant-side agents that contact landlords or handle replies)

| Product | Country | Sources | Auto-contact | Reply handling | Viewing booking | Price |
|---|---|---|---|---|---|---|
| Lettie (lettie.uk) | UK, London | Rightmove only, checked every 45 s [V] | Yes (Pro), from a dedicated per-user email address with "varied wording" [V] | "Auto-read & classify replies" [V] | Auto-books viewings [V] | Free; £5; Pro £20/mo [V] |
| Traumwohnung.ai | DE | IS24, Immowelt, Immonet [V] | Yes; demo shows 25 s from listing to application [V] | One inbox, notifies only on important messages, AI-drafted confirmation sent "mit einem Klick" [V] | Drafts the confirmation only [V] | EUR 24.99 or 49.99/mo [V] |
| HomeScout (homescout.io) | IE | Daft, Rent.ie, MyHome, agent sites; daily crawl [V] | Opt-in Auto Apply, max 3 a day, can be paused [V] | Smart Inbox detects viewing intent [V] | Calendar export [V] | EUR 12.99/mo [V] |
| Prems (prems.getmira.run) | FR | 350+ agency sites [V] | Fills agency forms, attaches a dossier link, writes a motivation, under 60 s [V] | Shows the user only viewing confirmations [V] | Via confirmations [V] | EUR 29, 99 or 149 per week [V] |
| Sherlok (sherlok.so) | FR | 15+ French sites [V] | "Candidature automatique en 60 secondes", "IA emails propriétaires" [V] | Tracks multiple applications [V] | Not stated | EUR 34 or 48/mo [V] |
| CherchePourMoi | FR | Leboncoin only [V] | Yes, from a Chrome extension using the user's own session [V] | Dashboard of replies [V] | Tracks scheduled visits [V] | Free; Pro EUR 9.99 [V] |
| Wohnly | DE | Auto on IS24, Immowelt and Immonet; 12 more sources as alert plus pre-written letter [V] | Yes, median 10 min [V] | None; replies go to the IS24 inbox and email [V] | No | EUR 19.99 or 39.99/mo [V] |
| Get The Flat | DE | Unnamed platforms [V] | "Our team" messages within minutes, max 10 a day [V] | Reply notifications [V] | No | About EUR 78 to 82/mo [V] |
| SnapFlat / WohnAutopilot | Berlin | Municipal landlords plus portals [V] | Yes, under 30 s or under 5 min [V] | No | No | EUR 49 per 4 weeks / EUR 24.99/mo [V] |
| SuperRent AI | NYC | Brokerage listings [V] | AI plus licensed brokers [V] | Yes, handled by humans | Premium [V] | Fee of $599 to $1,599 or cashback [V] |
| nyc-housing-ai (OSS) | NYC | StreetEasy, Compass, RentHop, broker email webhooks [V] | Within seconds, with an auto-built "Tenant Resume" [V] | Parses broker replies [V] | Pulls slots and books them in the calendar [V] | Free, 0 stars |
| immoscout-helper (OSS) | DE | IS24 [V] | Yes, with hourly caps [V] | Watches the IS24 inbox, drafts replies; one-click accept, decline or counter-propose [V] | Yes, via the replies [V] | Free |
| Nestor (OSS) | US | Any URL [V] | From its own AgentMail inbox; approve each email or turn on autopilot [V] | Parses slots, offers, concessions and questions [V] | Yes, "Tour booked" pipeline column [V] | Free |
| Uprent | NL | Unknown | Reportedly submits viewing requests [R] | Reportedly reads landlord emails [R] | Unknown | Unknown |

---

## 3. Per-product entries by region

### 3.1 Germany, Austria, Switzerland

**ImmoScout24 Suchen+ (formerly MieterPlus)**, immobilienscout24.de, Germany
- **Plans and price:**
  - Tiers are Standard, Pro and Unlimitiert, on 3, 6 or 12 month terms, then cancellable monthly [V].
  - Prices are not in the page HTML. Reported figures conflict but fall roughly between EUR 13 and 40 a month [R: immobilien-ranking.de, wohnticker.de].
- **Standard:** your message sits at the top of the landlord's inbox, early contact on exclusive listings (+9,000), and 15% off the SCHUFA check [V].
- **Pro adds:**
  - "Wartelisten": landlords contact you before publication (">81,000 Einladungen").
  - "Mieter-Netzwerk": flats of tenants about to move out (+18,000).
  - "Chancen-Check": competition for each listing.
  - 25% off SCHUFA.
  - [V]
- **Unlimitiert adds:**
  - The "Bewerbungsassistent" beta: applications are "automatisch rund um die Uhr verschickt, sobald passende Wohnungen online gehen".
  - A valuation with forecast, and 40% off SCHUFA.
  - Coming soon: contact before official publication (+4,500 a month).
  - [V]
- **Claim:** "at least 54% more viewing invitations" [V].
- **Bewerbermappe:** a monthly credit report, rent-payment proofs, income proof without scanning, ID without the physical card [V].
- **AI:**
  - ImmoScout24 app in ChatGPT since 2026-01-30: natural-language and visual search, for example wooden floors [V: scout24.com press].
  - HeyImmo, an assistant inside each listing [V].
  - "Agentic OS" presented 2026-05-12 [R].
- **Scam:** AGB 5.7 describes automatic filters plus manual review [V].
- **Bots:** AGB 8.2 bans scripts, bots and crawlers; 8.3 bans building a database from the data [V].
- **Complaints:**
  - Trustpilot 3.1/5 (10,785 reviews): subscription and billing disputes, landlords not replying, account blocks [R].
  - Critics say the only verifiable benefit is early access to some private listings [R: wohnticker].
- **Copy:** waitlist registration, a demand estimate for each listing, a verified dossier, a named auto-apply assistant.

**ImmoScout24 Austria / immobilien.net**, Austria
- AI search launched 2026-06-09 [R: ots.at]:
  - natural-language queries;
  - travel-time search;
  - photo-recognition search (mountain view, wooden beams);
  - a ChatGPT app is planned.
- immobilien.net is run by Immobilien Scout Österreich [V].

**ImmoScout24.ch and Homegate (SMG)**, Switzerland
- **TenantPlus** [V: immoscout24.ch/en/tenantplus]:
  - CHF 29.90 (3-month option).
  - A 7-day head start on 1,000+ exclusive listings.
  - Priority messaging.
  - An "interest tracker" showing demand for each listing.
  - A free Betreibungsauszug (debt-collection extract).
- **At launch in 2024** [R: Blick]:
  - CHF 39.95 a month, covering private landlords only.
  - In a Zurich sample, 23 of 863 listings qualified.
- **AI** [V: swissmarketplace.group]:
  - Natural-language search, 2026-03-23.
  - "Coming soon": AI reply suggestions for property managers and floor-plan recognition.
  - Dialogue refinement of searches [R].

**Flatfox**, flatfox.ch, Switzerland (SMG)
- **Landlords:** listing is free [V].
- **Tenants:**
  - One-click apply through a digital form that supports co-applicants [V].
  - Viewings are arranged in the messenger [V].
  - A certified debt extract (eSchKG, CHF 29.90, under a day) is attached to applications automatically [V].
  - "Flatfox Priority" gives early access up to 14 days [V].
- **Landlord tools:**
  - "AI-powered candidate evaluation" [V].
  - A viewing tool with slot capacity, "Automatisch einladen" for future applicants, and a reminder the day before [V].
  - An optional bid, paid only if the tenant is chosen [R].
- **Bots:** a public JSON API is used by bots [V, READMEs].
- **Copy:** parse auto-invites and slot capacity; attach certified documents automatically.

**WG-Gesucht Plus**, Germany
- **Price:** EUR 20.90 for 1 month, 19.90/mo for 3 months, 13.90/mo for 12 months [V].
- **Features:**
  - earlier access to exclusive ads, your message on top of the list, a highlighted profile;
  - a digital Bewerbermappe, instant verification;
  - "Angebots-Insights": how many applicants an ad already has;
  - from 3 months, a validated applicant folder.
  - [V]
- **No AI** [V].
- **Complaints:** Trustpilot 4.6 (652 reviews): more overpriced commercial ads, pushing of add-ons [R].

**Immowelt / Immonet**, Germany
- immonet.de now 301-redirects to immowelt.de [V].
- Immowelt blocked fetching, so its features are unverified.

**Kleinanzeigen**, Germany
- No paid seeker tier verified.
- Many scams, and a major bot target [V, GitHub].

**willhaben**, Austria
- Tenant "Mietprofil", a KSV1870 credit-check guide, and a Shadowmap simulation of sunlight and shadow on a 3D map [V].
- No auto-apply.

**Immomio**, Germany. Landlord software with a tenant side.
- **Tenants** [V]:
  - Landlords push offers to your search profile.
  - One-click apply, and a dashboard of applications and viewings.
  - Self-booked viewing slots, online lease signing, WBS upload.
- **Privacy** [V]: a "3-stage" disclosure. Contact details go first; income is shared only after a viewing, if interested.
- **Landlords:**
  - Pre-qualification, automated viewing allocation, SCHUFA, and a pool of more than 1M applicants [V].
  - Candidates are ranked by matching score [R].
- **Bots:** the tenant AGB §6.2 bans automated queries [V].
- **Complaints:** Trustpilot 2.2 (8 reviews): no offers, pointless uploads, login bugs [R]. "95% get no reaction" [R].

**Wohnly** (wohnly.ai), Germany
- **Price:** EUR 19.99/mo for 50 auto-applications a week, or EUR 39.99 unlimited; 7-day trial [V].
- **Sources:**
  - Auto-apply on IS24, Immowelt and Immonet, using the user's IS24 password stored encrypted [V].
  - Alert plus a pre-written letter ("two clicks") on 12 more sources, including WG-Gesucht, Kleinanzeigen and the Berlin municipal landlords [V].
- **Speed:** "im Median 10 Minuten", measured on 13,283 listings [V].
- **Letters and failures:** the cover letter is AI-written or your own text verbatim. Failed applications are retried, shown with a reason, and not counted against the quota [V].
- **Replies:** no reply handling [V].
- **Channels:** Telegram, push, and a web feed [V].
- **Legal framing:** "you remain sender" [V].
- **Copy:** a published median time-to-apply, visible failure reasons, and tiered source handling.

**Traumwohnung.ai**, Germany
- **Price:** EUR 24.99 or 49.99 a month [V].
- **Sources:** IS24, Immowelt and Immonet, scanning 150k+ listings a month [V].
- **AI** [V]:
  - A new cover letter for every flat.
  - "Eine KI liest jedes Inserat mit und ergänzt fehlende Angaben, damit deine Filter auch bei halb ausgefüllten Anzeigen greifen" (an AI reads each ad and fills in missing details so filters still work on half-empty listings).
  - 25+ criteria, including commute, WBS, energy class and exclusion words.
- **Reply inbox and documents** [V]:
  - A unified reply inbox that notifies only on important messages.
  - Drafted viewing confirmation, for example "Donnerstag 17 Uhr passt. Die Unterlagen sind angehängt.", sent in one click.
  - A dossier completeness score of "92/100".
  - The demo shows "Platz im Postfach #2 von 114" and "Vom Vermieter geöffnet"; this is marketing, and whether it is real telemetry is unknown.
- **Scope:** 7 cities, German only [V].
- **Complaints:** 1 Trustpilot review: a bug stopped applications, support was silent for 2 weeks, and billing continued [R].

**Get The Flat** (gettheflat.com), Germany
- **Service** [V]:
  - About EUR 78 to 82 a month.
  - Messages crafted by "our team", within minutes.
  - At most 10 a day, and capacity capped at 216 Berlin spots a month.
  - Reply notifications. EN and DE.
- **Controversy:** Wohnungsbot issue #218 alleges it runs AGPL code without publishing the source. Unproven [R].

**SnapFlat** (snapflat.app), Berlin
- EUR 19 per 4 weeks for alerts, EUR 49 for auto-apply [V].
- 11 sources (7 municipal landlords, Vonovia, Deutsche Wohnen, Immowelt, Kleinanzeigen) [V].
- Applications sent in under 30 s, at most 25 a day, Telegram confirmations [V].

**WohnAutopilot** (wohnautopilot.de), Berlin
- EUR 24.99/mo; auto-applies at 9 housing companies in under 5 min [V].
- Checks WBS eligibility (100 to 220) for each listing [V].
- Own study: of 3,740 listings, 24.1% were gone within 4 h and 50.1% within 24 h [V].

**Mietbot** (mietbot.de)
- EUR 29/mo; alerts only, for 8 Berlin landlords, by Telegram and email [V].

**WohnAlert** (wohnalert.com), Germany and Austria
- Free alerts are delayed 2 h; a planned premium at EUR 8.99 adds instant and price-drop alerts [V].
- Publishes listing lifetime per landlord: median 77 h; the fastest landlord averages 1.9 h [V].

**Wohnungs-Alarm** (wohnungs-alarm.de), Berlin and Munich, ImmoScout24 only
- A free live dashboard; EUR 12.99 for Telegram alerts [V].
- Claims to be faster than IS24 push, and offers "Filter gegen Fake-Anzeigen" [V].

**Wohnungsbot Hamburg** (wohnungsbot-hamburg.de)
- EUR 29.90 once for lifetime access; all German portals plus Hamburg cooperatives [V].
- Alerts "within a few seconds" by app or Telegram; message template only, no auto-apply [V].
- Reddit: "not quite that fast" [R].

**36flats.de**, Berlin
- Filters: warm rent, EUR/m², landlord type, WBS; Telegram bot [V].
- 14 sources, filters stored in the URL [R: r/berlin].

**Catch a Flat** (IS24 Chrome extension)
- The author measured free Telegram bots at about 3 min delay, against 1 to 2 min for IS24 app push [R: r/germany].

**AptSweep** (aptsweep.com), free closed-source browser extension
- **Sources:** IS24, WG-Gesucht, Rightmove, Zoopla, Daft; SpareRoom, OpenRent, Domain and Funda listed as "coming" [V].
- **Behaviour:** polls every 30 to 75 s, pre-fills the contact form, and never auto-sends. The user clicks Send [V].
- Local only [V].

**Apify "ImmoScout24 Apply Bot"** (clearpath)
- Takes the user's IS24 credentials and handles email verification codes [V].
- USD 79/mo; 57 users, 80.5% success rate [V].

**keymatch.ai**
- Reported as an AI agent over 1.5M listings from 2,000+ sources, EUR 14.95 [R].
- Now focused on buyers [R].

**Wunderflats**, furnished mid-term rentals
- "No SCHUFA required", verified listings, ID and solvency checks, a tenant fee; no AI [V].

**Homelike**
- The domain now 301-redirects to spacest.com, so it appears defunct [V].

**Nestpick**
- Now an aggregator of furnished rentals, with no alerts or AI [V].

**Tauschwohnung** (apartment swap)
- Pro from EUR 11.99 gets real-time alerts; supports ring swaps [V].
- Trustpilot 4.5 [R].
- The NL analogue is woningruil.

### 3.2 United Kingdom

**Rightmove**
- **Alerts:**
  - Options are instant, daily, every 3 days or every 7 days, with up to 20 alerts [V].
  - "Instant" alerts are batched and often arrive hours late [R: Dwellio, Flatscout].
- **AI** [V: press and help centre]:
  - Conversational "Use AI" search in beta since Feb 2026, built on Gemini [R].
  - "Ask Rightmove", with a "sources" button that shows provenance.
  - "AI Keywords", and "Style with AI".
- **ChatGPT app:** "first UK property portal", covering sales and rentals. Contact happens back on Rightmove [V/R].
- **Search:** draw your own area [V].
- **Agent-side tools:** Rent Ready Passport (2018) and Rightmove Referencing with digital ID [R].
- **App and reviews:** app 4.8 [V]; Trustpilot 3.3, mainly "already let" and slow agents [R].
- **Missing:** no auto-contact or scam features.

**Zoopla** (and PrimeLocation)
- **Alerts:** new listing, price reduced, back on market [V].
- **Search:** travel time, draw an area, price history [V].
- **AI:**
  - "Smart tags" extracted by NLP and computer vision, since Dec 2024 [V].
  - OpenAI enterprise deal, April 2026 [V].
  - Natural-language search and ChatGPT listings, with "150% more leads" [R].
- Alerts are batched [R].

**OnTheMarket**
- "Only With Us": listings shown 24 h or more before Rightmove and Zoopla [V].
- Travel-time search, "Help Me Choose", a rent checker [V].

**OpenRent**
- **Core service** [V]:
  - Free for tenants.
  - Masked messaging and a "Book Viewing" button.
  - "Rent Now": the holding deposit is held by OpenRent.
  - Referencing at £30, paid by the landlord.
  - Digital contracts and a free utilities concierge.
- **Alerts:** email at most daily [R].
- **SMS:** about 200k SMS a month, and viewings are arranged by SMS [R: Twilio].
- **Community reports from 2026** [R: community.openrent.co.uk]:
  - Landlords suspect "AI generated bot enquiries". One had 80+ enquiries and thought 70+ were scams; the signals were very short messages and a phone number shared straight away.
  - Landlords run auto-responders.
  - OpenRent inserts promotional messages into threads.

**SpareRoom**
- **Early Bird** [V]:
  - Free ads under 7 days old are reserved for paying users.
  - £15 a week up to £149 for 6 months.
  - "Contact 60% of new listings 7 days before" other users.
- **Checks:** manual and automated ad checks [V]; a verified badge [R]. It does not verify ownership; FlagMyListing rates it "High Risk" [R].

**Gumtree**
- About 13.5k listings to rent and 10.8k to share [V].

**Ideal Flatmate**
- A "20 questions" compatibility match; phone numbers are a paid reveal [V].

**Badi**
- Has left the UK; Spain only [V].

**Lettie**
- See section 2.
- Also [V]: swipe calibration from "~20 swipes"; email is the only channel; London only. lettie-cli is open source but contains search only.
- No scam or document features.

**Flatscout** (flatscout.co.uk)
- **Price:** a free twice-daily tier; real-time at £9.99 a week or £29.99 a month [V].
- **Coverage:** Rightmove, Zoopla, SpareRoom plus "70,000+ UK agents" [V].
- **Speed** [V]:
  - Matches run every 60 s.
  - A published, measured median of 8.6 min from listing to alert, across 22,582 alerts; 97.3% arrive within 1 h.
- **Channels:** email, WhatsApp, Telegram [V].
- **Listing data:** floor area from the EPC certificate, price history, time on market, multimodal commute, school catchments [V].
- No auto-contact.

**Dwellio**
- £9.99/mo; 6 portals every 15 min [V].
- A fair-price check against the neighbourhood median, crime and transport shown in each alert [V].
- Snooze, and preference learning [V].

**Roost** (iOS, London)
- £2.99 a week [V].
- A match score with reasons (light, layout, ceiling height, commute) [V].
- A shared household "Tracker" with voting and comments [V].

**nHabit** (London, free)
- "Milo", a multilingual 24/7 AI guide; "N4" neighbourhood scores; AI photo decluttering [V].
- ID and Right to Rent pre-checks move renters up the viewing queue [V].

**Letty** (lettyapp.io)
- Beta since Mar 2026: conversational search, red-flag detection, fair-price check [R; partly V].

**Rentsmart AI**
- A 2024 offer at £45 or £69 for "no more agent calls", with viewings booked for the user [R].
- Now B2B [V].

**Rentr**
- Launched 2023 as the "world's first AI renting platform": a digital assistant and in-app viewing booking [V].

**Birb**
- A 3D map aggregator with a commute radius; dormant since Aug 2024 [V].

**propertyalerts.co**
- £2 a month for daily email [V].

**Nestraq**
- Deal scores for buyers [V].
- An **MCP server** for agents at £0.49 per verified address reveal [V].

**Jitty**
- AI natural-language and "vibe" search, price per sq ft, a "hide basement flats" filter, a "Personal Agent" service [V].
- A ChatGPT app [R].

### 3.3 Ireland

**Daft.ie**
- **Market share:** about 70% of rentals [R].
- **Alerts:** Daft says listings are "intercepted before they reach the website" [V blog]. Others report alerts are batched and arrive 15 to 30 min after a listing goes live [R: HomeScout].
- **Enquiries:** a plain text box, with no reusable profile [R]. A Rathmines 2-bed can get 30 enquiries in 2 h [R].
- **Other:** no AI [V]; the terms ban scraping [R]; Trustpilot 1.6 [R].

**Rent.ie and MyHome.ie**
- Rent.ie likely has the same owner as Daft [R].
- MyHome has no AI [V].

**HomeScout** (homescout.io)
- **Price and sources:** see section 2.
- **Matching and applications** [V]:
  - Match scores with the "strongest reasons" shown.
  - Drafts built from your "approved renter context", with review-and-send as the default.
  - Opt-in auto-apply with an approved template, capped at 3 a day.
- **Features** [V]:
  - Natural-language search.
  - Smart Inbox that detects viewing intent in replies.
  - Contract Review of an uploaded lease PDF.
  - Commute, value scoring, and "Market Scout" across 34 Dublin areas.
- **Founder's engineering posts** [R: dev.to]:
  - Copy-paste enquiries get a 12% to 20% response rate.
  - The GPT-4o composer is restricted to facts in the listing.
  - Dedupe uses fuzzy address plus price plus an image fingerprint.
  - A listing counts as "taken" only after two crawls without it.

**DaftHelper**
- Auto-applied to every new Daft listing; its domain no longer resolves [R].

**Findivo.ie**
- PSRA-verified agents and verified profiles [V].

**RentRadar.ie and PropertyAlert.ie**
- These do not exist; DNS fails [V].

### 3.4 France

**Jinka**
- **Coverage:** aggregates "plus de 5 000 sites" [V].
- **Speed:** instant alerts, 3M notifications a day [V].
- **Fake listings:** "Nos algorithmes analysent et repèrent les fausses annonces" [V].
- **Other features:** price-drop alerts, sharing with co-renters, visit tracking with notes, a DossierFacile link [V/V-app].
- **Price:** free according to the CGU [V]. A premium tier is reported [R] but conflicts with the CGU.
- **Complaints:** listings arrive late, and agents do not answer [R].

**SeLoger**
- Natural-language and voice search, launched 2026-09-03 [V-app].
- In Clubic's test it misread "10 km from Disneyland" as 10 m² [R].
- Instant alerts [V-app].

**Bien'ici**
- Commute search at 10, 20 or 30 min, drawing a search zone, a 3D map [V-app].

**Leboncoin, with Pass Locataire+**
- Pass Locataire+ launched 2025/2026, from EUR 14.90, paid by the tenant [R].
- MiTrust identity check; income pulled from official sources (DGFiP via FranceConnect, CAF) in under 5 min [R].
- A "locataire vérifié" badge in messages, and one-click apply [R].
- Leboncoin blocks accounts that message at high volume [V, cherchepourmoi.org].

**PAP**
- Real-time alerts [V-app].
- Blocks 40 to 50 fraudulent listings a day, about 10% of submissions [R].
- The dossier is shared by link with automatic watermarking, validated by DossierFacile [R].

**LocService** (reverse marketplace)
- The tenant creates one profile, landlords contact the tenant [V].
- EUR 29/mo; 6,000 connections a day [V].
- Trustpilot 3.9: "paid and got no contact" [R].

**Manda** (formerly Flatlooker)
- A fully online agency, with a lease in about 48 h [V].

**Garantme**
- A paid guarantor at about EUR 270 a year; dossier certified within 24 h [V].

**Visale**
- A free state guarantee; the certified visa is valid 3 months [R].

**Studapart**
- Books without a viewing, "100% of listings verified", Studapart can act as guarantor, refund or rehousing if there is fraud [V].

**Lodgis**
- Agents photograph every flat themselves [V].

**Rentola** (Copenhagen operator)
- Anti-pattern.
- "Créer une notification IA", with at most 7 free alerts a day [V].
- Trustpilot 1.8: a EUR 1 trial silently becomes EUR 39 a month, stale and scam listings [R].

**La Carte des Colocs**
- A free flatshare map [R].

**Appartager**
- Every listing is checked by hand [V].

**Gens de Confiance**
- Membership requires 3 sponsors (a trust graph) [V-app].

**Prems**
- See section 2.
- Also [V]: it reads the listing for disqualifiers ("Pas de coloc", "RDC"), learns from the user's choices, and claims detection "4h before" SeLoger.

**Sherlok**
- **Starter, EUR 34:** compatibility score over "50+ critères", "Dépôt VISALE automatique", "OCR documents" [V].
- **Priority, EUR 48:** "Dossier Facile auto", "IA emails propriétaires" [V].
- **Channels:** push, email, SMS [V].

**CherchePourMoi**
- See section 2.
- Also [V]:
  - It uses "délais naturels" (natural delays) and stops if Leboncoin blocks, warning "Le risque n'est jamais nul".
  - Match score, and geo-targeting through official geocoding APIs.
  - Auto or manual approval mode.

**MoteurImmo**
- 773 platforms [V].
- Premium from EUR 9 [V]:
  - cross-platform duplicate detection;
  - price history and DVF sales data;
  - a negotiation-probability indicator;
  - **a webhook API**.

**Kazaki**
- Conversational AI search, mostly for buyers [V].

**Orpi x Kleio**
- An agentic search platform that makes listings readable by ChatGPT, Google AI Overviews and Claude [R].

**SIANA**
- A voice AI for estate agents, watching portals in real time for buyers' searches [R].

### 3.5 Spain, Portugal, Italy, and mid-term platforms across Europe

**idealista** (ES, PT, IT)
- **Search and alerts** [V-app]:
  - Immediate alerts, price-drop alerts.
  - A tenant profile.
  - Chat to schedule visits.
  - Draw a search area, and collaborative lists.
- **ChatGPT app** launched 2026-03-13 in ES, PT and IT [V].
- **Solvency certificate:** EUR 9.99, delivered within 12 h [V].
- **Anti-bot:** DataDome, according to bot READMEs.

**Fotocasa**
- **AI chat search**, typed or spoken [V-app].
- **ChatGPT app**, 2026-04-10 [V].
- **"Fotocasa Brain"** assistant [V].
- Favourites shared by up to 5 people, commute search [V-app].

**Habitaclia, pisos.com, yaencontre**
- Instant alerts [V-app].

**Badi**
- Room matching, secure payments [V].
- Paid Gold tier reported at about EUR 19.99 [R].
- Complaint: "only thing premium is the price" [R].

**Spotahome**
- "Homecheckers" verify each home [V].
- First rent is held until move-in, with a 24 h guarantee [V].

**Uniplaces**
- "Trusted Landlord" badges [V].

**HousingAnywhere**
- Money is held until move-in [V].
- Fees of about 25% [R].

**FlatRadar** (Spain)
- 4 portals, with cross-portal dedupe [V].
- Alerts in under 5 min by Telegram or email [V].
- A "Deal Score" from 0 to 100 against the neighbourhood average [V].
- EUR 0, 9 or 19 [V].

**Piso:Alerta**
- A "Precio vs. mercado" label (good, normal, high), EUR 4.99 to 9.99 [V].

**Zazume**
- WhatsApp alerts; the tenant pays only on success, 50% of one month's rent [V].

**Sepes**
- A planned state portal for affordable rentals [R].

**Imovirtual** (Portugal)
- **ChatGPT app**, 2026-04-15 [V].
- **Anti-fraud** [R: diarioimobiliario.pt]:
  - Flagged 6,661 accounts and removed 494.
  - Published red flags: below-market price, payment before a visit, urgency, a move to WhatsApp, inconsistent images, unnatural translations, contact details that do not match.

**Explorador** (Portugal)
- An AI agent that filters out overpriced listings against local baselines [R].

**Immobiliare.it**
- Alerts on new listings and price changes [V-app].

**Casa.it**
- Commute filter, **reminders to follow up calls** [V-app].

### 3.6 Nordics, Benelux, Central Europe

**Qasa** (SE, FI, NO)
- **Trust and payments** [V]:
  - BankID verification for everyone.
  - A deposit guarantee.
  - "Flytta in först, betala sen" (move in first, pay later).
  - Digital contracts reviewed by lawyers.
- **Premium** [V]:
  - "Superansökan" (priority application).
  - "Exklusiva insikter" into competing applicants and your ranking.
  - Claims 3x the chance of signing.
- **Reviews:** Trustpilot 4.1; slow support, opaque deposit claims [R].

**Samtrygg**
- All payments go through the platform to prevent fraud [V].

**Bostadsförmedlingen Stockholm**
- A municipal queue [V].

**Hemnet**
- Sales only [V-app].

**BoligPortal** (Denmark)
- Every listing approved by staff [V-app].
- 29 DKK for 24 h, then auto-renews at 399 DKK per 28 days [R].
- Trustpilot 3.9; refusals to refund [R].
- A free "Flyttesyn" app for the move-in inspection [V-app].

**Lejebolig**
- A hidden paid trial [R].

**Findboliger**
- The same "7 free AI notifications" template as Rentola [V].

**Hybel.no**
- BankID required; ID and credit-check badges; a digital contract and deposit account [V].

**Vuokraovi, Oikotie, Etuovi** (Finland)
- Instant saved-search alerts; commute search on Etuovi [V].

**SATO** (Finland)
- Some homes can be leased straight from a webshop, with a EUR 0 deposit [V].

**Immoweb, Zimmo, Immovlan** (Belgium)
- Push alerts and map drawing; no AI found [V-app].

**atHome.lu, Immotop.lu** (Luxembourg)
- Alerts, map drawing, 3D floor plans [V-app].

**Otodom, OLX.pl** (Poland)
- Saved lists and alerts [V-app].

**Sreality.cz**
- Paid instant alerts at 199 CZK a month; natural-language search by voice [V-app].

**Bezrealitky**
- Verification in 6 registries, including enforcement records [V].

### 3.7 United States

**Zillow and Zillow Rentals**
- **Reusable application:** $35, usable at unlimited participating rentals for 30 days, soft credit pull. About a third of listings accepted it in 2024 [V].
- **Zillow AI mode** (2026-03-25, limited beta) [V-pr]:
  - Conversational search.
  - "Schedule tours or apply directly within the experience".
  - Remembers preferences.
  - A real-time Fair Housing classifier on both user questions and AI answers.
- **ChatGPT app,** 2025-10-06 [V].
- **Google Gemini** (2026-07-09) [V]:
  - Books tours: "Book a Tour" for instant-tour listings, "Request a Tour" otherwise.
  - Cannot contact owners.
- **"AI Assist" on listings,** powered by EliseAI [R].
- **Other:** Rent Zestimate, commute search, shared collections [V-app].
- **Complaints:** 75% of the last 100 reviews rate it 2 stars or lower [V-app]. Themes: scams, a $35 fee that many managers do not accept, off-market listings still shown, fees hidden in the listing.

**Trulia Rentals**
- Instant alerts, "1-Click Request", "What Locals Say" reviews, 30 map layers, search linked with a roommate [V-app].
- Complaints: forwarded landlord emails cannot be flagged as scams; bot-check screens [V-app].

**HotPads**
- A baseline alerts product. Complaints: filters ignored, duplicate alerts [V-app].

**StreetEasy**
- **Alerts and following:** instant alerts, and the ability to follow a whole building [V-app].
- **Search:**
  - "Flexible Search" separates must-have from nice-to-have [R].
  - Fee labels after the FARE Act [R].
- **Complaints** [V-app]:
  - "AI Slop City": listing photos doctored with AI.
  - 20 to 30 emails a day with no way to stop them.
  - Duplicate alerts.
  - Requests for deposits before a viewing.

**Redfin**
- **Alert speed:** "within five minutes" of a listing, for sales [V-app].
- **Conversational search with Sierra** (2025-11) [V]:
  - Asks clarifying questions.
  - Explains the trade-offs when nothing matches.
  - Users requested 47% more tours.
- **ChatGPT app** [R].
- **Rentals:** powered by Rent. [R].

**Rent. / Rent.com**
- Alerts, verified-source listings, English and Spanish [V-app].
- Complaints: ghost listings, ignored filters [R].

**Apartments.com**
- **App features** [V-app]:
  - A commute filter.
  - A calculator for one-time and monthly costs.
  - Tours and messages inside the app.
- **AI:**
  - "Apartments.com Ai" (2026-06-16): chat in about 50 languages; users request 144% more tours [R].
  - ChatGPT app (Aug 2026): message managers and book tours from the chat [R].
  - OpenAI's GPT-6 demo on 2026-09-08 used it [R].
- **Complaints:** no inbox, cannot hide seen listings, the same unit at different prices on CoStar's sites [R].

**Homes.com**
- "Homes AI" (2026-02) shows the filters it derived from the query, and has fair-housing guardrails [R].

**Realtor.com**
- Commute, noise and flood layers; linked co-renter accounts [V-app].
- ChatGPT app (2026-03-30) [V-pr].
- RealAssist AI (2026-06), which resumes conversations across sessions and devices [V-pr].

**Zumper** (US and Canada)
- **Instant Apply** with TransUnion [R/V].
- **AI:**
  - "Zoe" assistant (2025) [V].
  - ChatGPT app (2026-02-04) with a "Rental Trends" panel of local rent data [V].
  - Siri and Spotlight search [V-app].
- **Survey:** renters using AI in their search went from 4.4% to 9.8% [V].
- **Complaints:** scams, and leads that get no answer [V-app].

**PadMapper**
- An "anti-spam algorithm" [V-app].

**RentHop**
- **HopScore** ranks listings and penalises scam-like content and rent below the building's comparables [R].
- Listers are verified with ID [R].

**Apartment List**
- A matchmaker quiz sorting results into "Perfect Matches" and "Flex Matches", swipe and "Maybe", tours 24/7 [V-app].
- Complaints: "pushy obnoxious ai", a broken commute calculation, properties calling users who only viewed them [V-app].

**RentCafe** (Yardi)
- Natural-language search, 2026-03 [V].
- ChatGPT app, 2026-04 [V].
- "Ren" assistant, nationwide from 2026-08-20 [V]:
  - carries over existing search criteria;
  - contact, tour and apply from the chat;
  - suggests relaxing criteria when nothing matches.

**RentReboot** (NYC and 4 more cities)
- **Price:** free to $29 a month [V].
- **Sources:** 30+ [V].
- **Pipeline:** New, Viewed, Contacted, Toured, Applied [V].
- **Other features** [V]:
  - Follow a building.
  - Predicted upcoming availability.
  - A rent-stabilisation check against city records, worded as "signal, not proof".
  - Matching to affordable-housing lotteries.
- **MCP server** with a server card and llms.txt [V].
- No auto-contact.

**LeaseAlert**
- $5 a month; paste a StreetEasy search URL to have it monitored [V].

**SuperRent AI**
- See section 2.

**AI Real Estate Agent NYC**
- Ingests broker "email blasts" [V].

**Renty.AI**
- Voice search in English, Spanish and Korean [V].

**Iris** (SF)
- Image search, a rent-control toggle, verified listers [V/R].

**SnagFlat**
- A Chrome extension that badges StreetEasy listings with rent-stabilised status, sun hours and noise [V].

**Crentology**
- "AI agents that apply for apartments for you" (Show HN, 2025) [R]. The domain does not resolve today, so it looks defunct [V].

**REZI** (YC W2017)
- Instant leasing [R].

**Rentberry**
- Markets an "AI Real Estate Agent", mainly for landlords [R].

**Furnished Finder**
- "Fern" AI match, in beta [V].

### 3.8 Canada

**liv.rent**
- **Renter profile** [V]:
  - A reusable "Renter Resume" and one-click apply.
  - Renters who are verified are "77% more likely" to secure a rental.
- **Trust Score:** 0 to 100, from Equifax, income and court records [R/V].
- **Verification** [V]:
  - Both sides verify with a government ID plus a selfie with head movement.
  - Listings from unverified profiles are hidden within a week.
- **Thread and languages** [V]:
  - One chat thread per rental, from viewing to lease.
  - English and Chinese, with translation.

**Rentals.ca**
- Every listing personally vetted; alerts still "coming soon" [V-app].
- Spring 2026 survey: 28.5% of renters use AI, and 33.3% of them use it to write messages to landlords [R].

**Rentsync**
- AI lead response for landlords [V].

**Kijiji**
- No AI; many bots scrape it [V].

**SingleKey**
- See section 6.

### 3.9 Australia and New Zealand

**realestate.com.au**
- "One touch" rental applications, an inspection planner, intelligent suggestions [V-app].
- Owns Flatmates.com.au [V].

**Domain** (owned by CoStar since 2025)
- **Off-market alerts** [V-app].
- "Shortlist with someone" [V-app].
- An inspection planner with rating after each visit [V-app].
- No AI [V-app].

**Snug**
- A free reusable profile accepted by 73,000+ property managers [V].
- **Group applications**, reference collection, optional background check [V].

**2Apply and TenantApp**
- "Fill in the form once" [V].
- Group favourites, calendar sync with route planning [V-app].
- **"Cancel future inspections and applications with a single tap"** [V-app].
- Complaints: 96 of the last 100 reviews rate it 2 stars or lower [V-app].

**Flatmates.com.au**
- Paid early-bird messaging; free messages are delayed [R].

**Rent.com.au**
- Renter Resume plus a **Pet Resume** [V-app].
- Commute, NBN broadband status and median-rent data [V-app].

**Trade Me Property** (NZ)
- Search by travel time and transport mode [V-app].
- An AI feature added in 2026 that users call slow [R].

---

## 4. Open-source bots (star counts from `gh api` today; [V] means README read)

### Fredy in detail (orangecoding/fredy)

**Repo:** 1,528 stars, 234 forks, pushed 2026-09-23, release 29.0.0 [V].

**Licence:** Apache-2.0 plus Commons Clause plus a naming clause [V]. The OSS stream read it as plain Apache-2.0, but the DACH stream read the full licence text.

**Portals:** 26, in DE, AT, CH, ES, IT and PT.

**Scraping:** ImmoScout24 goes through a reverse-engineered mobile API. Residential proxies are documented as the fix when a VPS gets blocked.

**Notifications:** Slack, Telegram, email, ntfy, Discord, Mattermost, Pushover, Apprise.

**Dedupe:** across portals, matched on size, rooms and location.

**Scam detection (v28):**
- Weight 3: advancePayment, keysByPost, moneyTransferService.
- Weight 2: landlordAbroad, noViewing, priceFarBelowMarket (40% or more below the EUR/m² median within 5 to 15 km).
- A listing is flagged at score 3 or more.
- Deliberately not signals: deposit, agency fees, a phone number in the text.
- Works in DE, EN, IT, ES and PT.
- The user can mark scam or not-scam, and that overrides the detector.
- It shows a badge and never hides the listing.

**Travel time:** public transport, car, bike or walking via Transitous/MOTIS (free, no API key), plus the nearest OSM place of a given type and live departures.

**Other features:**
- A financing calculator.
- Stored exposés and photos that survive the ad being taken down.
- Lagecheck links (noise, air, flood).

**MCP server:**
- Transports: stdio and streamable HTTP, with OAuth 2.1, dynamic client registration and PKCE.
- Read tools: list_jobs, get_job, list_listings, get_listing, calculate_financing.
- Write tools: notes and watch/unwatch, annotated as destructive or not.
- Search creation by interview (start/update/create/discard_job_draft), with the state kept on the server "because local models forget".
- Creating notification channels is excluded on purpose, so secrets never pass through the LLM.

**Missing:** auto-contact, LLM scoring, reply handling, viewing booking.

### Other projects

| Project | Stars, last push | Region and sources | Contacts landlords? | LLM | Notable technique or feature |
|---|---|---|---|---|---|
| flathunters/flathunter | 1,062, 2026-04, AGPL | IS24, Immowelt, WG-Gesucht, Kleinanzeigen, idealista, Immobiliare, Subito, vrm-immo | No | No | Google Distance Matrix commute; Capmonster needed for IS24; 10% loop jitter; hosted Berlin instance with Telegram login; README says a bot "is really just making things worse" |
| VikParuchuri/apartment-finder | 1,058, 2019 | Craigslist SF | No | No | Where the genre started; transit-distance filter |
| AleksNeStu/ai-real-estate-assistant | 311 | Generic | No | RAG | Natural-language query, 9 UI languages |
| nickirk/immo | 201, 2026-05, GPL | WG-Gesucht | Yes | No | Runs on a Raspberry Pi; AptSweep is its sister product |
| neopostmodern/wohnungsbot | 181, 2025-07, AGPL | IS24 Berlin | Yes | No | Electron app; an art project; breaks on IS24 UI changes (issues #225, #229 to #231) |
| AnthonyBloomer/daftlistings | 194, 2026-09 | Daft.ie library | Old v1.8.1 could contact advertisers [R] | No | Base for Daft bots and MCPs |
| etienne-hd/lbc-finder | 139, 2026-08 | Leboncoin, unofficial API | No | No | Plug in any notifier through a handler hook |
| kylinfish/tw-house-ops | 113, 2026-04 | Taiwan, Claude Code | No | Yes | 5-dimension weighted score; price checked against official transactions; visit checklist and negotiation brief; status machine |
| janchaloupka/web-scraper-nabidek-pronajmu | 100, 2026-07 | Brno, 9 portals | No | No | Silent first-run seeding; separate channel for errors |
| B1Z0N/homelander | 93, 2026-09, MIT | IS24 desktop | Yes (fills forms) | No | Pauses itself on session expiry or AWS challenge; speed presets of 45 to 90 s; secrets in the OS keychain; login done by hand |
| mikepapadim/london-property-hunt-public | 87, 2026-04 | SpareRoom, OpenRent, Rightmove, Zoopla | Drafts only | Claude Code with Chrome and Gmail MCP | Reads `__NEXT_DATA__` and JSON-LD; outreach under 100 words; case study: 230 listings, deposit paid within a week |
| cheesestringer/property-seeker | 92 | AU browser extension | No | No | Shows hidden price ranges; hides unwanted listings |
| grantwilliams/wg-gesucht-crawler-cli | 75, 2022 | WG-Gesucht | Yes | No | 5 to 8 s between requests to avoid reCAPTCHA |
| sibbl/wohnung-scraper | 71, 2023 | DE | No | No | Map coloured by price per m²; hides listings that went offline |
| andreybavt/Hobo-Sapiens | 60, 2023 | Paris, 11 sources | No | No | Dedupe across sites by image hashing; Prometheus and Grafana |
| axeleroy/untoitpourcaramel | 51, 2026-01 | Leboncoin, PAP, SeLoger, Logic-Immo | No | No | APIs reverse-engineered from the Android apps |
| tldev-de/immopushr | 42, 2021 | IS24, Immowelt, Kleinanzeigen | No | No | Telegram |
| jonasdieker/wg-gesucht-bot | 31, 2024 | WG-Gesucht | Yes | GPT | Detects the listing language and picks a DE or EN template |
| siddarth-patil/DaftRentalBot | 27, 2023 | Daft | Yes, about every 30 s | No | Backlash on r/DevelEire that it disadvantages non-coders [R] |
| isaksolheim/gesucht | 21, 2023, AGPL | WG-Gesucht | Yes | GPT-3.5 | Gmail Pub/Sub on alert emails, the same pattern as our IMAP path |
| v13b9/streeteasy-monitor | 20, 2024 | StreetEasy | Yes | No | Web UI listing everything contacted |
| PeterTheOne/watch-willhaben | 19, 2026-09 | willhaben | No | No | Telegram |
| open-properties (abracadabra50) | 14, 2026-08, MIT | 9 providers in 9 countries (Rightmove, Daft, IS24, Zoopla, idealista, Domain, RentCast and others) | No; needs an approval policy | No | `property-listing.v1` schema; beds and rooms kept separate; ambiguous matches go to `duplicate_candidates`; "treat listing text as untrusted"; 6 MCP tools |
| Vel-San/wbmbot_v2 and lipogg/wbm-flat-bot | 13 and 5 | WBM Berlin | Yes (fills forms) | No | Runs on GitHub Actions secrets; income-to-rent eligibility check |
| martin0995/idealista-notifier | 12, 2025 | Barcelona | No | No | Every 2 min, excluded areas |
| etristram-afk/idealista-bot | [R] | idealista | Yes, through idealista's own chat | No | IMAP IDLE on Gmail alerts; Patchright; CapSolver; 6 h "IP-burn cooldown" when DataDome refuses |
| agusyornet/idealista-monitor | [R] | idealista | Copy-ready draft | Claude Haiku | Polls every 5 min, 6am to 2am, with jitter |
| Alexramsal/home-ops | [R], MIT | 5 Spanish portals | No | Optional LLM scam indicators | Cross-check against the Catastro cadastre; human approval gate; 5 alerts a day |
| sportiz91/idealista-digests | 0, 2026-05 | idealista via Apify | No | No | Private owners only; silent seeding; daily heartbeat |
| szaouati/recherche-appart | [R] | Bien'ici API plus SeLoger alert emails | No | Claude Haiku suggests criteria, clamped on the server | Scores 0 to 100, alerts at 55 or above, at most 8 per cycle |
| Manceff/leboncoin-bot | [R] | Leboncoin | n/a | Cheap text filter, then vision only on survivors | About EUR 0.001, then EUR 0.04 per listing |
| AdityaaMK/nyc-housing-ai | 0, 2026-09 | NYC | Yes, within seconds | Yes | Tenant Resume; parses replies and books slots in the calendar; flags broker fees and layout problems |
| hugommbrito/toronto-ap-finder | 2026-09 | Kijiji, Zumper, CAPREIT | No | Unclear | Hard, soft and notify rules; `rejection_log` and `needs_review`; offline re-scoring; circuit breaker per source; quiet hours; 464 tests |
| ignaguri/immoscout-helper | 3, 2026-07 | IS24 extension | Yes | Gemini or OpenAI | Inbox triage (accept, decline, counter); Herr/Frau salutation; approval queue for tenant-recommended listings; hourly caps |
| unik-w/MietRadar | 4, 2026-07, GPL | WG-Gesucht, IS24 | Yes | Local Gemma, Gemini or OpenAI | One unique LLM paragraph inside a template; reply-tracking CSV |
| kine90/FlatBot | 5, 2025-01 | IS24 via IMAP alert emails | Yes | No | Closest to our email path; the author found a flat with it |
| Aliosha-dev/immoscout-auto-apply | 2, 2026-03 | IS24 | Yes | Claude | **A one-pager PDF generated per listing**; dry-run mode |
| fabge/immo-hunter | 0, 2026-08 | Kleinanzeigen, IS24 mobile API and RSS | No | Claude filter | A price change triggers re-scoring; a source returning 0 listings sends an ops alert |
| lucasseckk/wohnung-scout-bot | 2026-09 | IS24 alert emails | Never auto-sends [R] | Yes | Discord watchlists and drafts |
| claudiokoller/wohnungs-bot | 2026-09, MIT | 4 Swiss portals via IMAP alert emails | Drafts only | Unclear | Dedupe by following redirect links; filters changed by Telegram commands; digest at 20:00; `/health` per portal; search shared by two people |
| joshuaswanson/zurich-housing-tool | 3, 2026-08 | wgzimmer, Flatfox API | Writes applications | Local Ollama | Excludes age- or gender-restricted listings, short sublets, bulk posters, fake addresses |
| jjpp01x/zurich-rental-finder | 1, 2026-09 | Flatfox API | No | Claude Code skill | Scores 0 to 100 against the **median of that day's batch**, with no hardcoded rents |
| hugoperier/FlattyBot | 3, 2026-06 | Geneva | No | GPT-5.4 Nano onboarding | Shows how many listings would match before the search is saved; pauses after 2 weeks of user inactivity; eval suite |
| mchlkucera/flathunter | 0, 2026-06 | Sreality plus email alerts | After approval | Claude Code skill | Google Calendar viewings; detects stale leads; `share` block |
| mrnetwork0001/Nestor | 1, 2026-08 | Any URL | Yes, through AgentMail (approve or autopilot) | OpenAI | Asks for at most 2 concessions; revocable Renter Passport page; lease check; its first real email landed in Gmail spam |
| Erez-Yahalomi/Rental_Phone_Search_AI-Agent | 1, 2025-12 | Zillow | **Outbound voice calls through Twilio** | GPT | Summary per call |
| ai-engineers-guild/apartment-hunter | 2, 2026-08 | krisha.kz | No | Vision LLM | Renovation and furniture score out of 10; MCP |
| NilayRaut/rentsentry | small | Craigslist | No | LLM | Trust score = 100 minus (0.6 x LLM score + 0.4 x price score); reverse-image links |
| louisecch/spareroom-bot-playwright | small | SpareRoom | Only with SEND_MESSAGES=1 | No | Rotates templates; runs once a day at a random time |
| hypebearsnfts-claude/property-bot | 2026-09 | Rightmove, Zoopla, OpenRent, OnTheMarket | No | No | Walk time to the tube; fair value against let-agreed comparables |
| snird/apartments_bot | 35 | Facebook groups | No | No | Attaches to the user's logged-in Chrome over CDP |
| Youghz/FlatBot | 1 | Montreal | No | No | curl_cffi TLS impersonation to get past Cloudflare |
| merturl4576/poland-rental-bot | 1 | OLX, Otodom | No | No | "Accurate mode" uses the total price including service costs |

Also noted [R, gh search]:
- AthomsG/renting-in-vienna: append-only dataset
- NoNoNo greasemonkey IS24 userscript: flags suspiciously cheap listings
- boligportal-alert, immoweb-telegram-bot, otodom-searcher, apartment-seeker, bolig-ping
- RightmoveInstantAlert: polls every 3 s

---

## 5. MCP servers and ChatGPT or Gemini apps

**Portal apps in ChatGPT**
- US and Canada: Zillow (2025-10), Zumper (2026-02), Realtor.com (2026-03), RentCafe (2026-04), Apartments.com (2026-08, can message and book tours), Redfin, Apartment List, Greystar Apartment Scout, Rentals.ca.
- Europe: Rightmove, ImmoScout24 DE (2026-01), idealista (2026-03), Fotocasa (2026-04), Imovirtual (2026-04), Spotahome, Daft.ie, Figaro Immobilier, Jitty, atHome.
- Elsewhere: realestate.com.au, QuintoAndar, Bayut, uhomes.
- Sources: [V] on each company's own press pages where fetched; the rest [R] via the rdmgator12/awesome-chatgpt-apps directory.
- All of them cover only their own portal.

**Gemini:** Zillow Rentals, 2026-07-09, with tour booking [V].

**Community MCP servers**
- **chrischall zillow-mcp, redfin-mcp, booli-mcp** [V]:
  - Rich toolsets, including rent Zestimate history and comparable rentals.
  - Every request goes through the user's own signed-in browser tab, so cookies and the TLS fingerprint match a real session.
  - Booli uses "auto" mode: direct fetch first, then the browser bridge.
- **kubilay-yavuz/rightmove-mcp**, 13 tools [V]:
  - send_inquiry and request_viewing default to **dry run** and refuse to act without `consent_to_portal_tcs=True`.
  - watch_listing and watch_query emit PRICE_REDUCED, PHOTOS_CHANGED and BACK_ON_MARKET events.
- **HasData** Zillow, Redfin and Airbnb MCPs: paid, from USD 59/mo [V].
- **Smaller ones:**
  - agentic-ops/real-estate-mcp: 50+ tools, paid sources behind feature flags, audit log [V].
  - paulieb89/property-shared: UK Land Registry, EPC, Rightmove [V].
  - galimru/idealista-mcp: official API [V].
  - dafty-mcp and daft-mcp [V].
  - Samxel/willhaben-mcp: downloads photos for a vision model [V].
  - rentcast-mcp [V].
  - cn-housing-mcp: typed warnings such as captcha, login or access denied [V].
  - openbnb mcp-server-airbnb: 541 stars, respects robots.txt by default [V].
- **Commercial MCPs:** Nestraq (£0.49 per reveal) [V], and RentReboot with a server card and llms.txt [V].
- **Landlord-side PMS with an MCP server:** Rentvine [V].

---

## 6. Tenant dossiers, passports and verification

**DossierFacile** (French government, beta.gouv, open source, free) [V]
- **Contents:** only legally allowed documents, checked by a human operator for being "clair, complet et cohérent".
- **Protection:** every document is watermarked.
- **Sharing:** "un lien par destinataire, avec une date d'expiration". The tenant sees who opened it and can revoke it.
- **API (DossierFacile Connect):**
  - OAuth2/OIDC; `/dfc/tenant/profile` returns the dossier.
  - Webhooks: VERIFIED_ACCOUNT, DENIED_ACCOUNT and others, retried until they get HTTP 200.
- **Scale:** 116,000 labelled dossiers.
- **Used by:** PAP, Jinka, Prems, Sherlok.

**Canopy RentPassport** (UK) [V]
- Income via Open Banking, a soft credit check, rental history, Right to Rent.
- "Fill it out once"; guarantors can join.
- Rent can be reported to the credit bureaus [R].

**SingleKey Verified Tenant Profile** (Canada) [V]
- CAD 29.99 once, shared with unlimited landlords.
- Covers Equifax, ID, income, background and references.
- SingleKey has absorbed Naborly.

**Leboncoin Pass Locataire+** [R]
- MiTrust identity plus income from official sources, a "locataire vérifié" badge, one-click apply.

**Nordic BankID models** [V]
- **Qasa:** ID-verified profiles.
- **Hybel:** ID and credit-check badges.

**idealista solvency certificate** [V]
- EUR 9.99 within 12 h; checks debt, sanctions and AML registers.

**Flatfox** [V]
- Certified debt extract, attached automatically to applications.

**ImmoScout24 Bewerbermappe** [V]
- Income proof without scanning, and ID without the physical card.

**WG-Gesucht validated folder** [V]

**Australia and US reusable applications**
- **Snug:** free, group applications, reference collection [V].
- **2Apply** [V].
- **Zillow:** $35 for 30 days [V].
- **Zumper Instant Apply** [R].
- **realestate.com.au:** "one touch" [V-app].
- **Rent.com.au:** Renter Resume plus Pet Resume [V-app].
- **liv.rent:** Renter Resume plus Trust Score [V].

**UK referencing** [V]
- **Goodlord** (now includes Vouch):
  - "30% returned instantly".
  - NFC chip reading of passports.
  - Payroll checks covering 80% of UK employees.
  - HMRC income checks.
- **Homeppl:** detects forged documents from fonts, metadata and version history.
- **OpenRent:** £30 per applicant.
- **Let Alliance:** same-day referencing.
- **Property Passport UK:** a tenant-built record of documents and references to share with landlords.
- **Rightmove:** Rent Ready Passport [R].

**Guarantors**
- Garantme and Visale (France) [V/R], Studapart's "Profil Garanti" [V], Flatfair's deposit alternative at 28% of one month's rent [V].

**Nova Credit Credit Passport** [V]
- Brings foreign credit histories to the US, for immigrants.

**US portable tenant screening report (PTSR) laws**
- Colorado HB25-1236, effective 2026-01-01 [V].
- Reports are typically valid for 30 days [R].
- The NAA and a PTSR vendor disagree on which states mandate acceptance [R].

**Nestor Renter Passport** (OSS) [V]
- A public, token-revocable page showing income and credit as bands, with no documents.

**Tenant demand for document protection** [R: r/wohnen]
- Tenants ask for a "privacy shield": watermark each document with "only for application at XY" and send view-only links that expire after 48 h.

---

## 7. Landlord-side automation our agent will face

### US AI leasing agents
All claims in this list are [V] from each vendor's page unless marked.

- **EliseAI:**
  - SMS, email, chat and voice; 51 written languages and 7 voice languages.
  - "Over 90%" of conversations and tours automated.
  - AI-guided self-tours need an ID check and use one-time lock codes.
  - Powers Zillow AI Assist [R].
- **Zuma "Kelsey":** has human escalation available around the clock.
- **Knock:** "Knock Now" self-scheduling widgets.
- **Funnel "Fenix"** (built with Sierra, absorbed LeaseHawk):
  - Keeps one renter record across all of an operator's properties.
  - Publishes pages written for LLMs under an `/llm/` path.
- **Entrata ELI+** (Colleen AI is now part of it):
  - 30+ languages.
  - "Renters often mistake ELI for a real person".
  - Announced 100+ embedded AI agents in March 2026.
- **RealPage Lumina:**
  - Gives personalised quotes from live pricing.
  - Resolves about 9 in 10 routine enquiries.
- **Yardi Chat IQ** [R].
- **AppFolio Realm-X Leasing Performer:**
  - Books tours during a phone call and confirms by SMS.
  - Has an ID check for showings.
- **Leasey.AI:** replies in 14 to 18 s; an AI phone agent; biometric ID.
- **Respage:** says "most prospects reach out after 5:00 pm".
- **Anyone Home:** AI plus humans.
- **Reffie:** a unified inbox for small property managers.
- **Tour24:** app-based self-tours; ID checked by CheckpointID [R].

### US showing platforms (the most relevant to bots)

**ShowMojo** [V]
- Asks screening questions "so the system doesn't book you into a place that doesn't fit".
- Optional ID, a card hold and an SSN.
- Its terms have no anti-bot clause.
- The best candidate for tour-link parsing.

**Tenant Turner** [V]
- "VOIP scanning, ID verification, and blacklisting" before showings.
- Sends the scheduling link by SMS.
- An AI Virtual Agent screens pets, income and move-in date.
- Shares MojoBox and MojoLock hardware with ShowMojo; common ownership is suspected but unconfirmed.

**Rently** [V]
- **"Ria" AI leasing agent.**
- **Self-tour verification:**
  - ID plus a selfie with liveness check.
  - A TransUnion soft pull.
  - Phone number matched to the device, and "VPN must be temporarily disabled".
- **Terms:** ban "automated scripts" and creating many accounts.
- **Scam rules:**
  - Photos are watermarked with the manager's details.
  - "Rently-verified properties do not appear on Facebook or Craigslist".

### Small-landlord suites
- TurboTenant, Avail, Hemlane, Baselane [V].
- **Rentvine** advertises an "open API and MCP server" [V].

### UK

- **Street.co.uk** [V]:
  - An AI call handler.
  - A pre-qualification questionnaire whose rules decide who can book instantly; everyone else becomes a request for staff to review.
- **Reapit Bookings** [V]:
  - Per-property pre-qualification forms, then a slot picker.
  - AI offers "travel-friendly" slots; AI agents are coming.
- **Alto Lead Flow (Bridge AI)** [R]:
  - Answers over WhatsApp and email.
  - "90% of lettings applicants are screened before a negotiator steps in".
- **Hybr** [V]:
  - Contacts enquirers "within 2 minutes via WhatsApp and email".
  - Gives applicants a 0 to 100% match score.
  - Reminders must be reconfirmed.
- **Latch** [V]:
  - Replies in under 30 s.
  - Reminders 24 h and 1 h before viewings.
  - Humans take over in 6% to 15% of conversations.
  - Says UK agents' AI adoption rose from 8% to 23%.
- **Dwelly:** raised $170M in 2026 [V/R].
- **Vinny:** unaccompanied viewings with a mobile key [R].
- **Letted, Lanten:** AI assistants for landlords and agents [V].

### Europe

- **Immomio:** score-based ranking, so profile completeness matters more than speed; progressive disclosure [V/R].
- **Flatfox:** AI candidate evaluation; viewing auto-invites [V].
- **IS24.ch:** AI reply suggestions for property managers, "coming soon" [V].

### Screening and fraud tools used on tenants

**Snappt** [V]
- Document fraud checks on "thousands of metadata elements", with a ruling in 10 min or less.
- CLEAR ID check in under 90 s.
- Its 2026 report: 1.46M submissions analysed, a 5.1% fraud rate, "template farms" the dominant method [R].

**Other tools** [V]
- Findigs, Certn, TransUnion SmartMove ($25 to $49), RentPrep, Truv, Plaid Check Income, Experian RentBureau.

**Implication:** never re-save, merge or re-render a tenant's PDFs. Metadata-based detectors can flag honest documents that have been re-saved.

---

## 8. Scam data and detection signals

### Data

- **FTC, 2025-12** [V]:
  - About 65,000 reports since 2020, about $65M lost, median loss $1,000.
  - Half start with a Facebook ad, 16% on Craigslist.
  - People aged 18 to 29 file 46% of loss reports.
  - Fake "$1 credit check" links sign victims up for subscriptions.
- **UK Action Fraud:**
  - About £9M lost across about 5,000 reports [R: LBC].
  - Another source cites 4,000+ reports and nearly £13M, peaking July to September [R: FlagMyListing].
- **Ireland (Garda):**
  - Losses: about €550k (2023), €660k (2024), €680k (2025), and €410k+ in 2026 up to early August [R].
  - Two-thirds of victims are under 33 [R].
- **Portals' own figures:**
  - Rently: 0.58% of 1.64M self-tours reported scam or key problems [V].
  - Imovirtual removed 494 of 6,661 flagged accounts [R].
  - PAP blocks about 10% of submissions [R].
- **AI-generated listings, a 2026 trend:**
  - StreetEasy reviews call the photos "AI Slop City" [V-app].
  - NYC's consumer protection department alleges brokers post AI ads for units that do not exist [V: Defector].
  - NYT, 2026-09-08: "A.I. Listings Are So Widespread Even Zillow Is Concerned" (headline only) [R].

### Signal catalogue (merged)

**Payment and pressure**
- Money asked before a viewing (FTC, Action Fraud, Garda, Fredy weight 3, Imovirtual).
- Wire, gift card, crypto or a money-transfer service (FTC, Fredy).
- Payment to several accounts (SF Standard).
- Keys sent by post (Fredy).
- Urgency, or a deadline under 48 h (FTC, denv.it).

**The landlord and the conversation**
- Landlord abroad, or cannot show the property (Garda, Fredy weight 2).
- No viewing possible (Fredy).
- Contact only on WhatsApp or Messenger, or a Google Voice number (Garda, Imovirtual, SF Standard).
- Early request for ID, BSN/SSN or payslips before a viewing (FTC).
- A link to a paid "credit check" (FTC).

**Price and cross-listing checks**
- Price 40% or more below the local EUR/m² median (Fredy), or below the 25th percentile (Rentometer approach).
- Same address at different prices, or under different owner names, across sites (FTC).
- The property is also listed for sale (FTC, FlagMyListing).
- Photos reused from other or sold listings: use perceptual hashes and reverse image search (Garda, rentsentry, Hobo-Sapiens).

**Listing content**
- Inconsistent images, unnatural or machine-translated text, contact details that do not match the listing (Imovirtual).
- A watermark naming another agency, or a professionally managed listing reposted on Facebook or Craigslist (Rently).

**Infrastructure checks**
- Agency website domain registered on the day the listing appeared (denv.it).
- IBAN country does not match the stated agency country (denv.it).
- Currency switched off-platform (denv.it).
- A fake Impressum copied from a real company registration number (denv.it).
- Unknown domains run through a reputation check such as the ScamAdviser API [V].

**Tenant-side "scams" in NL terms**
- Illegal fee requests (UK Tenant Fees Act analogue; in NL, agency fees charged to tenants).

**Presentation**
- Show the rules that matched, as FlagMyListing (40+ patterns) and Fredy do.
- Let the user override the verdict.
- Never auto-hide a listing.

**Tools that exist**
- FlagMyListing: free, 40+ patterns, covers Rightmove, Zoopla, SpareRoom, OpenRent, Daft [V].
- Fredy [V].
- RentHop HopScore [R].
- Letty [R].
- Jinka's fake-listing filter [V].
- rentsentry [V].
- home-ops LLM scam indicators [R].
- Wohnungs-Alarm fake-ad filters [V].

---

## 9. Legal and terms-of-service context

**Platform terms that ban automation**
- ImmoScout24 AGB 8.2 and 8.3 ban bots and database building [V]. IS24 also blocks automated login and uses AWS perimeter challenges [V: Homelander].
- Immomio's tenant AGB §6.2 bans scripts [V].
- Rently bans automated scripts and multiple accounts [V].
- Zillow and Redfin terms ban automated access [V, quoted in the chrischall READMEs].
- Daft reportedly bans scraping [R].
- ShowMojo's terms say nothing about bots [V].

**Case law and lawsuits**
- German BGH I ZR 224/12 (2014, the Ryanair case): screen scraping is generally allowed unless it gets around technical protection, and terms-of-service bans bind only the contracting parties [R].
- A user automating their own logged-in account is a contracting party, so the practical risk is an account ban.
- No lawsuit against any DACH rental bot was found (searches were limited).

**EU AI Act** [V, legal text; deadlines R]
- **Art. 50(1):** providers must design systems that interact with people so those people are told they are dealing with AI. This applies from 2026-08-02.
- **Art. 50(5):** the notice must come at the latest at the first interaction.
- **Art. 2(12):** the open-source exemption does not apply to Art. 50.
- **Art. 2(10):** a private individual using the system personally is exempt as a deployer.
- **Annex III 5(b):** credit scoring is high-risk, and Recital 58 names housing. Our fit scoring ranks listings, not people, so it is likely outside 5(b).
- **Digital Omnibus:** stand-alone Annex III obligations move to 2027-12-02 [R].

**GDPR and the SCHUFA ruling**
- GDPR Art. 22 plus CJEU C-634/21 (SCHUFA): a score that decides the outcome counts as an automated decision [V].
- A template letter asking for human review would help tenants rejected by scoring platforms.

**UK rules**
- Renters' Rights Act: bidding above the advertised rent is banned in England from 2026-05-01 [V/R].
- Rent in advance is capped at one month [R].
- The Tenant Fees Act 2019 bans tenant fees [R].
- Never automate offers above asking.

**Licences** [V]
- flathunter and Wohnungsbot are AGPL, and Wohnungsbot's maintainer is watching for violations.
- Fredy's Commons Clause forbids selling it or services built on it.
- nickirk/immo is GPL.

---

## 10. What users complain about

**Paying for speed, and dark patterns**
- SpareRoom Early Bird, Flatmates.com.au, IS24 Suchen+ (lock-in, surprise charges), Rentola, BoligPortal, Lejebolig, TenantApp premium tiers that never activated, Zumper PowerSearch ($24.99), Zillow's $35 fee that managers ignore, LocService.

**Slow or batched "instant" alerts**
- Rightmove and Zoopla deliver hours late; Daft 15 to 30 min; inberlinwohnen emails arrive after the listing is gone.
- In Berlin, 24% of listings are gone within 4 h [V: WohnAutopilot].

**Alert spam and ignored filters**
- Duplicate alerts, and filters that are not applied: StreetEasy, HotPads, Rent., Apartment List.

**Scams and AI-generated photos**
- On nearly every US app, and on Rentola, SpareRoom and Daft.

**Landlords who do not reply**
- Copy-paste enquiries get 12% to 20% responses [R: HomeScout].
- In Berlin, 484 applications led to 13 viewings [R: r/berlin].

**Landlords suspicious of bot enquiries**
- OpenRent community in 2026: short messages and a phone number shared immediately are read as bot or scam signals [R].

**The arms-race criticism**
- r/berlin: "Berlin will end up only with software people".
- r/DevelEire: bots disadvantage people who cannot code.
- The flathunter README; Catch a Flat commenters.

**Fragile auto-apply products**
- Wohnungsbot issues after IS24 changes; a Traumwohnung.ai bug with billing continuing and no support.
- Nestor's first email went to spam.

**Privacy of documents**
- Fear of identity theft through fake listings [R: r/wohnen].

---

## 11. Unique features worth copying (merged, with sources)

### Ingestion, speed and reliability

1. **Publish measured alert latency for each source:** median and p97 with sample size (Flatscout: 8.6 min median, 22,582 alerts), median time-to-apply (Wohnly: 10 min), and how fast listings disappear per source or landlord (WohnAutopilot, WohnAlert). Show these on the dashboard.
2. **Tiered source handling:** full auto-apply where it is safe, and "alert plus pre-written letter, two clicks" elsewhere (Wohnly). Also retry failed sends and show the reason (Wohnly).
3. **Prefer each portal's mobile-app APIs and embedded JSON to HTML** (Fredy's IS24 mobile API, `__NEXT_DATA__`, JSON-LD, UnToitPourCaramel). When a portal is walled, bridge requests through the user's own logged-in browser tab (chrischall fetchproxy, snird CDP attach, AptSweep, CherchePourMoi).
4. **Protect the scrapers:**
   - A circuit breaker per source, and "taken" only after 2 absent cycles (toronto-ap-finder, HomeScout).
   - An ops alert when a source returns 0 listings (fabge).
   - Typed block warnings: captcha, login, denied (cn-housing-mcp).
   - A cooldown after an IP or CAPTCHA burn: 6 h (idealista-bot).
   - Jittered polling windows (idealista-monitor), and pausing on session expiry or a WAF challenge (Homelander).
5. **Silent first run:** mark existing listings as seen and send only a count (idealista-digests, janchaloupka).
6. **Change events on known listings:** PRICE_REDUCED, PHOTOS_CHANGED, BACK_ON_MARKET (kubilay rightmove-mcp, Zoopla, Jinka, idealista). A content-hash change triggers re-scoring (fabge).
7. **Import a portal's own search URL as the search definition** (LeaseAlert, Homelander, renting.berlin).
8. **Follow a building or address** (StreetEasy, RentReboot). **Predict upcoming availability** from past listing timing (RentReboot).
9. **Early-access sources:** register on waitlists and "wish locations" (IS24 Pro Wartelisten, Domain off-market alerts, OnTheMarket "Only With Us"). Let users connect their own premium portal accounts (SpareRoom Early Bird, TenantPlus). In NL: waitlists at housing corporations and doorstroom lists.
10. **Scrape estate agents' own websites directly** to beat the aggregators (Prems: 350+ agency sites and a claimed 4 h lead; Hobo-Sapiens).
11. **Treat email alerts as a first-class source**, including broker email blasts (nyc-housing-ai, AI Real Estate Agent NYC, FlatBot, gesucht, claudiokoller). Follow the redirect links in alert emails to reach the canonical listing ID for dedupe (claudiokoller).

### Filtering, scoring and explanation

12. **Hard, soft and notify rules**, with a `rejection_log` of reasons, a `needs_review` bucket, and offline re-scoring of the stored listings to tune weights (toronto-ap-finder).
13. **Explain every score:** "strongest reasons" (HomeScout), up to 6 reasons and 6 concerns (Nestor), 5 weighted dimensions (tw-house-ops), must-have versus nice-to-have (StreetEasy), "Perfect" versus "Flex" matches (Apartment List).
14. **Let an LLM fill missing listing fields before the hard filters run** (Traumwohnung.ai). Scan the listing text for disqualifiers ("Pas de coloc" on Prems; in NL, "geen studenten", "alleen werkenden", "inkomenseis 4x").
15. **A cheap deterministic pre-score, then the LLM:** score against the median of the day's batch (zurich-rental-finder). Cascade from a cheap text model to vision only on survivors (Manceff).
16. **A fair-price label on every listing:** Deal Score (FlatRadar), Buen/normal/alto (Piso:Alerta), neighbourhood median (Dwellio), HopScore (RentHop). In NL, add a WWS points estimate and a flag when rent exceeds the regulated or mid-market cap.
17. **Check against the public land registry:** Catastro (home-ops), rent-stabilisation records with "signal, not proof" wording (RentReboot). In NL, use BAG and Kadaster via PDOK: flag addresses that do not exist, have no residential use, or whose floor area is far off.
18. **Check eligibility before contacting:** WBS 100 to 220 (WohnAutopilot), income-to-rent ratio (wbm-flat-bot). In NL: 3x to 4x income, social-housing income limits, age or student limits.
19. **Use the total monthly cost, not the base rent** (poland-rental-bot "accurate mode", Apartments.com cost calculator, StreetEasy fee labels). Flag hidden fees and net-effective traps (nyc-housing-ai).
20. **Commute and place context:**
    - Public-transport travel time via Transitous/MOTIS, free with no key (Fredy); multimodal door-to-desk (Flatscout); travel-time search (Trade Me, Bien'ici, Zoopla, IS24.at).
    - The nearest supermarket or school from OSM (Fredy).
    - Sun hours and noise (SnagFlat, willhaben Shadowmap).
    - Noise, air and flood data (Lagecheck).
    - Neighbourhood scores (nHabit N4).
    - Energy-label and floor-area data (Flatscout EPC; in NL, EP-online).
21. **Vision on listing photos:** attribute tags (Zoopla smart tags, IS24 visual search), renovation and condition score (apartment-hunter KZ), soft traits such as light and ceiling height (Roost), and **detection of AI-generated or doctored photos** (a demand shown in StreetEasy reviews).
22. **Competition estimate for each listing:** Chancen-Check (IS24), "Angebots-Insights" (WG-Gesucht), interest tracker (IS24.ch), competitor insight (Qasa Premium).
23. **Show the structured filters a natural-language query produced, and validate them on the server** (Homes AI, recherche-appart clamping). Geocode landmarks so "10 km" is not read as "10 m²" (the SeLoger bug). When nothing matches, explain which criteria to relax (Redfin, RentCafe Ren).
24. **Market preview while creating a search:** show how many recent listings would match (FlattyBot). Build the search by interview (Fredy MCP).

### Outreach and reply handling

25. **A reply inbox that alerts only on important messages**, with drafted answers to viewing invitations sent in one click (Traumwohnung.ai). Triage with accept, decline or counter-propose (immoscout-helper). Parse replies into slots, offers and questions (Nestor), and detect viewing intent (HomeScout). Go further than all of them by auto-answering routine replies and booking the viewing.
26. **A dedicated sending address for each user** for clean threading, with varied wording (Lettie). Otherwise send through the user's own mailbox or the platform form, which Nestor's spam problem argues for.
27. **Message quality:**
    - Match the listing's language (jonasdieker).
    - A gendered formal salutation (immoscout-helper).
    - One LLM paragraph inside a fixed template (MietRadar).
    - Under 100 words, mentioning the street (london-property-hunt).
    - Only facts from the listing (HomeScout).
    - Pre-qualification facts in the first message: employment, household size, pets, move-in date, income multiple. These are what Tenant Turner, Latch, Street and Alto ask.
28. **Safety rails on auto-send:**
    - Opt-in, an approved template, a daily cap, one-tap pause (HomeScout: 3 a day).
    - Hourly caps with randomised delays (Homelander, immoscout-helper).
    - Capacity caps (Get The Flat: 216 Berlin spots, 10 a day).
    - An approval queue for special listing types such as tenant recommendations, sublets and agency-fee listings (immoscout-helper).
    - Dry-run by default, and a consent flag before send or book tools act (kubilay rightmove-mcp).
    - Show the reasoning and the model name on every draft (Nestor).
29. **Detect bots on the other side and prevent loops:** reply latency, persona names (ELI, Kelsey, Lisa, Ria, Liza, Fenix, Zoe, Ren), templated signatures. Cap automated turns per thread, and never commit money or negotiate with a bot. Keep answers consistent across one operator's properties (Funda-style operators; Funnel remembers them).
30. **Parse tour and booking links and pre-fill the pre-screen, then stop:**
    - Sources to handle: ShowMojo and Tenant Turner links, Knock Now widgets, Reapit and Street slot pickers, Flatfox auto-invites, Immomio invites, AppFolio confirmation SMS.
    - Stop at ID, selfie, card or liveness steps and hand them to the human.
    - Use the user's real mobile number, never VoIP: Tenant Turner flags VoIP numbers.
31. **Viewing management:**
    - ICS export and calendar sync (HomeScout, TenantApp).
    - A reminder the day before (Flatfox).
    - Auto-reconfirmation (Hybr and Latch require it).
    - A route plan across viewings (TenantApp, Domain).
    - A rating and notes after each viewing (Domain, Jinka).
    - Reminders to follow up by phone (Casa.it).
    - A visit checklist and negotiation brief (tw-house-ops).
32. **Once a lease is signed, cancel all future viewings and withdraw all applications in one tap** (TenantApp).
33. **Reverse outreach:** publish the seeker's profile where portals allow it (LocService, Qasa, Badi, Flatmates room-wanted). Periodically email local agents the user's criteria (a tip from r/berlin).
34. **Negotiation asks, used carefully:** at most 2 concessions chosen by the user (Nestor). Never offer above asking (UK Renters' Rights Act; check the Dutch rules).
35. **Outbound voice calls to landlords** are an experimental idea (Rental_Phone_Search_AI-Agent). Low priority, and legally sensitive.

### Documents and trust

36. **A verified, reusable, revocable tenant dossier:**
    - One link per recipient that expires, with an access log and revoke (DossierFacile, PAP).
    - A watermark on every document naming the recipient (DossierFacile, the r/wohnen "privacy shield" request).
    - Progressive disclosure: contact first, income after the viewing (Immomio).
    - A completeness score such as 92/100 (Traumwohnung.ai).
    - OCR to build the dossier from uploaded files (Sherlok).
    - A one-pager PDF generated per listing (Aliosha-dev).
    - Issue and expiry dates on each document (US PTSR 30-day rule).
    - A revocable public passport page showing only bands (Nestor).
    - A Pet Resume (Rent.com.au).
    - Group or co-tenant applications (Snug, Flatfox co-applicants).
    - An NL document set: ID, IB60, UWV verzekeringsbericht, werkgeversverklaring, loonstroken, verhuurderverklaring.
37. **Never modify original documents.** Landlord fraud engines check metadata, fonts and version history (Snappt, Homeppl), so keep originals byte-identical.
38. **Automate the guarantor application** (Sherlok: automatic Visale). In NL: pre-fill guarantor forms and the request for a verhuurderverklaring.
39. **After the search:**
    - Lease and contract review of an uploaded PDF (HomeScout, Nestor). In NL, check service costs, the points system and temporary-contract rules.
    - A move-in inspection helper with photos, meter readings, keys and signatures (BoligPortal Flyttesyn).
    - Keep a local copy of each ad, text and photos, as evidence (Fredy).

### Scam protection
40. The signal catalogue in section 8:
    - weighted and explained;
    - price checked against a local median built from our own ingested listings;
    - perceptual-hash photo reuse across all polled platforms;
    - checks on domain age, IBAN country and a WhatsApp-only contact;
    - the user's verdict overrides the detector.
    - Sources: Fredy, FlagMyListing, FTC, Garda, Imovirtual, denv.it, Rently.

### Interfaces and distribution

41. **An MCP server with OAuth 2.1 and dynamic client registration**, so Claude.ai and ChatGPT can connect to a local instance (Fredy). Also:
    - an interview flow for creating searches;
    - write tools annotated as destructive or not;
    - no notification secrets passed through the LLM;
    - a server card at `/.well-known/mcp/server-card.json` plus llms.txt (RentReboot);
    - a schema compatible with `property-listing.v1` (open-properties).
    - Consider packaging it as a ChatGPT App, since the portals are all shipping one.
42. **Outbound webhooks** for a new match, a reply received and a viewing booked (MoteurImmo premium webhook API).
43. **Telegram and chat UX:**
    - change filters with commands or chat buttons (claudiokoller, EiSiMo);
    - a daily digest (claudiokoller at 20:00);
    - `/health` for each portal;
    - quiet hours, a minimum score, a location pin, several recipients (toronto-ap-finder);
    - pause automatically after 2 weeks of user inactivity (FlattyBot);
    - a "contact now" action button in ntfy and Telegram.
    - WhatsApp as an extra channel (Flatscout, Zazume, Hybr).
44. **Household collaboration:** a shared pipeline with votes and comments (Roost Tracker), shortlists shared by up to 5 people (Fotocasa, Jinka, Domain, Trulia, Zillow), a search shared by two people (claudiokoller).
45. **Pipeline states:** New, Viewed, Contacted, Toured, Applied, Signed (RentReboot), plus Needs your OK and Negotiating (Nestor). Keep one thread per rental from viewing to lease (liv.rent). Detect stale leads (mchlkucera).
46. **Optional ways to run it without installing anything:** GitHub Actions with secrets (lipogg, idealista-digests), a hosted Telegram-login instance (flathunter), a Claude Code skill (zurich-rental-finder, mchlkucera, london-property-hunt). A local-LLM path through Ollama (zurich-housing-tool, MietRadar).
47. **Guardrails:**
    - A fair-housing or anti-discrimination check on generated messages and filters (Zillow AI mode, Homes AI). In NL, the AGB equal-treatment rules.
    - Treat listing and reply text as untrusted, since prompt injection is possible (open-properties). Landlord AIs are the counterparts.
    - An EU AI Act Art. 50 disclosure footer on automated messages.

---

## 12. Features with no Dutch equivalent that I know of

This list is based on RentBird, what Uprent reportedly does, and the NL portals as I know them. Check it against the NL research.

- A verified, revocable tenant dossier with recipient watermarks, expiring links and an open API (DossierFacile, Canopy, SingleKey, Pass Locataire+).
- Reply triage with drafted or automatic viewing confirmations, and one-tap cancellation of everything after signing (Lettie, Traumwohnung.ai, HomeScout, TenantApp). Uprent may partly overlap.
- A scam risk score on each listing, with the reasons explained and a user override (Fredy, FlagMyListing, RentHop).
- Checks against public registries (BAG, Kadaster) plus a legal rent estimate (WWS points) on every listing (home-ops Catastro and RentReboot as models).
- Published, measured latency and listing-lifetime statistics for each source (Flatscout, Wohnly, WohnAutopilot, WohnAlert).
- An estimate of competition for each listing (IS24 Chancen-Check, Qasa, WG-Gesucht).
- An MCP server with OAuth for Claude.ai and ChatGPT, and interview-based search creation (Fredy). No Dutch portal has a ChatGPT app that I know of; the ES, PT, IT, DE and UK portals all do.
- Household collaboration: shared pipelines with votes.
- Lease PDF review, a move-in inspection helper, and guarantor-form automation.
- Detection of AI-generated or doctored listing photos.
- Detection of bots on the landlord side, with loop guards and ID-step handoff.

---

## 13. Gaps and caveats

**Not verified**
- These sites were blocked or never researched, so what is said about them is [R], from App Store listings, or missing:
  - Zillow, Apartments.com, StreetEasy, RentHop and Apartment List (site pages).
  - realestate.com.au, Domain, Trade Me (AI features).
  - Homegate, Comparis, Immowelt.
  - Immobiliare.it, Realo, Blocket.
  - Facebook Marketplace, Perplexity.
  - Movebubble (empty page), Housemates and Home Made (dead domains).
  - Rentd, Glide, Househunt, Birdeye (not researched).
- No Reddit complaints for DACH beyond what the Pullpush archive returned.

**Conflicting sources**
- Fredy's licence (the DACH stream says Commons Clause, the OSS stream says Apache-2.0).
- IS24 Suchen+ prices.
- Jinka premium versus its CGU.
- Goodlord's reusable references.
- Which US states mandate PTSR acceptance.
- Dwellio's source list.

**Unverified inferences**
- Common ownership of ShowMojo and Tenant Turner.
- Whether Traumwohnung.ai's inbox-position telemetry is real.
- Get The Flat's alleged AGPL violation.

# Privacy

nl-property-finder runs on your computer. There is no account with this
project, no server of ours, and no telemetry. This page lists everything that
leaves your machine, and why.

| Destination | What is sent | When | How to turn it off |
| --- | --- | --- | --- |
| The rental platforms you enabled | Ordinary page and search requests, at a low rate | Every check | Disable the source |
| Landlords and agents | Your message, through a form, a platform message or email, with the profile facts it uses | When the agent contacts a home or answers a reply | Pause the agent, or set automation to approve |
| Your dedicated mailbox provider (Gmail by default) | Mail the agent sends and reads | Continuously | `mail.provider: none` |
| Anthropic (Claude API) | Listing text, landlord messages, and the parts of your profile the agent writes from | For each matched listing and each reply, when AI is on | `ai.provider: rules` |
| ntfy.sh or Telegram | Notification titles; the body too if `notify.includeDetails` is on | For tasks and wins | Remove the channel |
| PDOK, BAG, WOZ-waardeloket, EP-Online (Dutch public registers) | Addresses | Geocoding and the legal-rent estimate | `rentCheck.enabled: false` |
| OpenStreetMap tile servers | Which map area you look at (your IP and the tile coordinates) | When a map is open in the dashboard | Start the daemon with `NLPF_TILES=0` |

Nothing else leaves: no analytics, no crash reports, no update checks.

## What stays on your machine

Your configuration, secrets, the database of listings and conversations, your
documents and the logged-in browser profiles, in the folders listed in
`SECURITY.md`. Deleting those folders deletes everything the agent knows.

## Documents

Documents you upload are labelled public, private or identity. Public ones
(the generated tenant profile) may be sent automatically. Private ones
(payslips, enrolment proof) are sent automatically only to a landlord who
passed the scam checks, and only after a viewing is booked, unless you change
the policy. Identity documents are never sent without your click, and are
watermarked with the recipient, the address and the date when they are.

## Your landlords' data

Landlords' names, email addresses and messages are stored locally so the agent
can keep the conversation going. They are never shared with anyone except, when
AI is on, Anthropic for classification and drafting replies.

# Configuration reference

`~/.config/nl-property-finder/config.yaml`. Every key has a default, so an
empty file is valid. `config.schema.json` next to it lets your editor check and
autocomplete the file. The dashboard edits the same file.

Secrets never go in this file. They live in `secrets.env` (mode 0600) and the
config refers to them by name.

## profile

| Key | Meaning |
| --- | --- |
| `firstName`, `lastName` | Used in every message |
| `email` | The dedicated mailbox address landlords reply to |
| `phone` | Given to landlords who ask for it; used on guest forms that require it |
| `birthYear`, `nationality` | Given only when asked |
| `occupation` | `student`, `phd`, `employed`, `self_employed`, `starting_job`, `other` |
| `organisation` | University or employer |
| `job` | For a student who also works: `employer` and `role`. Where a listing turns students away, the agent applies as a working tenant and introduces you by the job; elsewhere it mentions both |
| `incomeMonthlyGrossEur` | Used in income checks and when asked |
| `guarantor` | `relation`, `incomeMonthlyGrossEur`, `country` |
| `coApplicants` | People applying with you; incomes add up in requirement checks |
| `household` | `adults`, `children`, `pets` |
| `smoker` | |
| `moveInFrom`, `moveInLatest`, `stayMonths` | Dates as `YYYY-MM-DD` |
| `languages`, `messageLanguage` | `auto` writes Dutch to Dutch listings and English to English ones |
| `about` | A short paragraph in your own words |
| `facts` | Extra answers the agent may give, as key and text |
| `signature` | Appended to messages |

## searches

A list of named searches. A listing matches when it passes any enabled one.

| Key | Meaning |
| --- | --- |
| `id`, `name`, `enabled` | |
| `regions` | Each with `municipalities`, `postcodes` (`"2611-2629"`), and optionally `polygon` (`[lat, lon]` pairs) |
| `priceMinEur`, `priceMaxEur`, `priceIncludesServiceCosts` | |
| `sizeMinM2`, `roomsMin`, `bedroomsMin` | |
| `types` | `room`, `studio`, `apartment`, `house`, `other` |
| `furnishing` | Acceptable: `unfurnished`, `upholstered`, `furnished`, `unknown` |
| `availableBy` | Skip homes only available after this date |
| `requireRegistration` | Skip homes where you cannot register your address |
| `mustHaves`, `dealBreakers` | Words that must or must not appear |
| `commute` | Places with `lat`, `lon`, `mode` and `maxMinutes` |
| `minScore` | Minimum fit score |
| `skipAboveLegalMaxPct` | Skip rents this far above the estimated legal maximum |

## sources

Keyed by source id (`nlpf sources` lists them).

| Key | Meaning |
| --- | --- |
| `enabled` | |
| `intervalSec` | Seconds between checks; floors apply per kind of source |
| `contact` | `auto` or `watch_only`; unset follows the platform's terms |
| `termsAcknowledgedAt` | Set when you opted in on a platform that forbids automation |
| `paidPlan` | For example `kamernet-premium` if you pay for it |
| `searchUrls` | Extra search pages from the platform itself, imported as they are |

`agencies` lists estate-agent YAML files, relative to the config folder.

## automation

| Key | Default | Meaning |
| --- | --- | --- |
| `mode` | `auto` | `auto` sends, `threshold` sends above `scoreThreshold` and asks otherwise, `approve` asks every time |
| `paused` | `false` | The dashboard's pause switch |
| `dryRun` | `false` | Everything except actually sending |
| `dailyCap` | `40` | First messages per day |
| `sendWindow` | `07:00` to `23:30` | Outside it, messages wait for the start |
| `policies` | | Per reply type: `auto`, `task` or `ignore`. Offers, contracts and payment requests are always tasks |
| `availability` | weekdays 09:00 to 20:00, weekends 10:00 to 18:00 | When a viewing may be booked |
| `viewingBufferMin` | `45` | Travel time kept free around viewings |
| `autoAcceptViewings` | `true` | |
| `documents` | | `public: auto`, `private: after_viewing_booked`, `identity: approve` |
| `templates.first` | | Your first message, in `nl` and `en`, with `{firstName}`, `{street}`, `{city}`, `{price}` |
| `variants` | | Message styles to compare, with weights |
| `recheckBeforeSend` | `true` | Confirm the listing is still online |
| `followUp` | on, after 3 days, at most 1 | |
| `maxAutoRepliesPerConversationPerDay` | `3` | Loop guard |
| `disclosure` | off | A sentence saying the message was drafted with an assistant |
| `withdraw` | | The "I found a place" message |
| `callNowMinScore` | `85` | Push a call button for very strong matches with a phone number |

## registrations, rentCheck

`registrations` lists social-housing portal registrations (`portal`, `since`,
`renewBy`); a task opens 30 days before renewal. `rentCheck.enabled` turns the
legal-rent estimate on or off; `epOnlineKeyEnv` names the secret holding an
optional free EP-Online key for registered energy labels.

## mail, notify, ai, server

| Key | Meaning |
| --- | --- |
| `mail.provider` | `imap`, `memory` (demo) or `none` |
| `mail.address`, `mail.user`, `mail.imap`, `mail.smtp`, `mail.passwordEnv` | Defaults fit Gmail |
| `notify.ntfy` | `server`, `topic`, `actions` |
| `notify.telegram` | `chatId`, `tokenEnv`, `actions` |
| `notify.email` | `to`, `digest` (`instant` or `daily`) |
| `notify.desktop`, `notify.quietHours`, `notify.minPriority`, `notify.includeDetails` | |
| `ai.provider` | `claude`, `rules` or `demo` |
| `ai.extract`, `ai.compose`, `ai.classify`, `ai.reply` | `model` and `effort` per operation |
| `ai.monthlyTokenBudget` | Falls back to rules when reached |
| `server.port`, `server.lan` | `lan` also serves on your local network, token still required |

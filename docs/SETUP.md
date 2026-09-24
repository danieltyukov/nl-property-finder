# Setting it up for yourself

This is the long version of `nlpf init`. Install first as the README describes. It takes about fifteen minutes, most
of which is creating a mailbox.

## 1. A mailbox just for your search

Rental platforms send alerts, landlords reply, and agents follow up. None of
that should land in your personal inbox, so the agent gets its own.

1. Create a new Gmail account, for example `yourname.huur@gmail.com`. Google
   asks for a phone number once.
2. In that account, open Google Account, Security, and turn on 2-Step
   Verification.
3. Still under Security, open App passwords, create one named
   `nl-property-finder`, and copy the 16 characters.
4. `nlpf init` asks for the address and the app password. The password is
   stored in `secrets.env`, readable only by you.

Any IMAP and SMTP mailbox works; Gmail is the easiest free one. Set `mail.imap`
and `mail.smtp` in the config for another provider.

## 2. Your profile

The agent writes to landlords as you, from what you put in your profile: your
name, what you do, your income or guarantor, when you want to move, who lives
with you, and a short paragraph in your own words. It never invents a fact that
is not there. `profile.facts` holds extra answers the agent may give when a
landlord asks, for example `pets: "No pets"` or `parking: "I cycle"`.

## 3. Your searches

One or more named searches: regions (municipalities, postcode ranges like
`2611-2629`, or a polygon drawn on the dashboard's map), rent, size, rooms,
type, furnishing, the move-in date, deal-breakers, and places you commute to.
Only a listing that passes a search costs anything to evaluate.

## 4. Sources and logins

`nlpf sources` lists every source. Most read listings without an account. To
contact landlords on a platform that needs a login, run `nlpf connect
<source>`: a browser window opens on the platform's login page, you log in
once (and solve any captcha), and the window closes. The agent keeps that
session in its own browser profile.

Several large platforms forbid automated access in their terms. On those, the
agent only watches until you switch contact on for that platform, in the
onboarding wizard or with `nlpf sources enable-contact <source>`. The risk of
switching it on is your account on that platform.

Set up the saved-search email alerts each platform offers, sent to the new
mailbox. The agent reads them within seconds and they keep listings coming
when a site changes its layout.

## 5. Your phone

Install the free ntfy app and subscribe to the topic `nlpf init` generated, or
create a Telegram bot with @BotFather and give `nlpf init` its token and your
chat id. Tasks arrive with buttons (approve, dismiss, snooze, call), which work
from anywhere without opening anything on your computer to the internet.

## 6. Claude (optional)

With an Anthropic API key, Claude reads listing descriptions, writes messages
and sorts replies. Without one, rules and your templates do the same work more
plainly and nothing is paid. `ai.monthlyTokenBudget` caps spending; when it is
reached the agent falls back to rules until the next month.

## 7. Start it

```
nlpf doctor    # checks every part
nlpf on        # start now and at every login
nlpf open      # the dashboard
```

Start with `automation.dryRun: true` for an hour if you want to read what it
would send before it sends anything.

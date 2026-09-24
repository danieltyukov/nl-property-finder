import { longDate } from '../dates.js';
import type { SandboxListing, Submission } from '../types.js';
import { euros } from '../world.js';
import { esc, page, paragraphs } from './layout.js';

/*
 * Huisje, the fake rental platform. People can browse it; the agent uses its
 * JSON API (see platform.ts). The contact form posts to the same endpoint the
 * API uses.
 */

const HOME = '/huisje/';
const TYPES: Record<string, string> = {
  apartment: 'Appartement',
  studio: 'Studio',
  room: 'Kamer',
  house: 'Huis',
  other: 'Woning',
};
const FURNISHING: Record<string, string> = {
  unfurnished: 'Kaal',
  upholstered: 'Gestoffeerd',
  furnished: 'Gemeubileerd',
};

function nav(loggedIn: boolean): string {
  return `<a href="/huisje/">Aanbod</a><a href="/huisje/berichten">Berichten</a>${
    loggedIn ? '<a href="/huisje/uitloggen">Uitloggen</a>' : '<a href="/huisje/login">Inloggen</a>'
  }`;
}

const priceLine = (l: SandboxListing) =>
  `${euros(l.priceEur, 'nl')} per maand ${l.priceBasis === 'incl' ? 'inclusief' : 'exclusief'} servicekosten`;

export function huisjeHome(
  listings: SandboxListing[],
  q: { city?: string; priceMax?: string },
  loggedIn: boolean,
): string {
  const cities = ['Delft', 'Rotterdam', 'Den Haag'];
  const cards = listings
    .map(
      (l) => `<article class="card">
<a href="/huisje/listing/${esc(l.id)}"><img src="/media/${esc(l.id)}/1.svg" alt="${esc(l.title)}" width="480" height="360"></a>
<h3><a href="/huisje/listing/${esc(l.id)}">${esc(l.title)}</a></h3>
<div>${esc(l.addressText)}, ${esc(l.city)}</div>
<div><strong>${esc(euros(l.priceEur, 'nl'))}</strong> per maand, ${esc(l.sizeM2)} m², ${esc(l.rooms)} ${l.rooms === 1 ? 'kamer' : 'kamers'}</div>
</article>`,
    )
    .join('\n');
  const body = `<h1>Huurwoningen</h1>
<form class="stack" method="get" action="/huisje/">
<label>Plaats <select name="city"><option value="">Alle plaatsen</option>${cities
    .map(
      (c) =>
        `<option value="${esc(c.toLowerCase())}"${q.city === c.toLowerCase() ? ' selected' : ''}>${esc(c)}</option>`,
    )
    .join('')}</select></label>
<label>Maximale huur <input name="priceMax" inputmode="numeric" value="${esc(q.priceMax)}"></label>
<button type="submit">Zoeken</button>
</form>
<p class="muted">${listings.length} ${listings.length === 1 ? 'woning' : 'woningen'} gevonden.</p>
<div class="grid">${cards}</div>`;
  return page({ title: 'Huisje: huurwoningen', brand: 'Huisje', home: HOME, nav: nav(loggedIn), body });
}

export function huisjeDetail(l: SandboxListing, opts: { loggedIn: boolean; loginRequired: boolean }): string {
  const facts: [string, string][] = [
    ['Huurprijs', priceLine(l)],
    ...(l.serviceCostsEur
      ? ([['Servicekosten', `${euros(l.serviceCostsEur, 'nl')} per maand`]] as [string, string][])
      : []),
    ...(l.depositEur ? ([['Borg', euros(l.depositEur, 'nl')]] as [string, string][]) : []),
    ['Type', TYPES[l.type] ?? 'Woning'],
    ['Oppervlakte', `${l.sizeM2} m²`],
    ['Kamers', String(l.rooms)],
    ['Interieur', FURNISHING[l.furnishing] ?? ''],
    ['Beschikbaar', `per ${longDate(l.availableFrom, 'nl')}`],
    ...(l.energyLabel ? ([['Energielabel', l.energyLabel]] as [string, string][]) : []),
    ['Adres', `${l.addressText}, ${l.postcode} ${l.city}`],
    ['Verhuurder', l.landlord.name],
  ];
  const status =
    l.status === 'available'
      ? ''
      : `<p class="notice">Deze woning is ${l.status === 'rented' ? 'verhuurd' : 'onder optie'}.</p>`;
  const form =
    opts.loginRequired && !opts.loggedIn
      ? `<p class="notice">Log in om te reageren. <a href="/huisje/login?next=${encodeURIComponent(`/huisje/listing/${l.id}`)}">Inloggen</a></p>`
      : l.status !== 'available'
        ? ''
        : `<form class="stack" method="post" action="/huisje/listing/${esc(l.id)}/contact">
<label>Naam <input name="name" required></label>
<label>E-mailadres <input name="email" type="email" required></label>
<label>Telefoon <input name="phone" type="tel"></label>
<label>Bericht aan ${esc(l.landlord.name)} <textarea name="message" required></textarea></label>
<button type="submit">Reageren</button>
</form>`;
  const body = `<p><a href="/huisje/">Terug naar het aanbod</a></p>
<h1>${esc(l.title)}</h1>
<p class="muted">${esc(l.addressText)}, ${esc(l.postcode)} ${esc(l.city)}</p>
${status}
<img src="/media/${esc(l.id)}/1.svg" alt="${esc(l.title)}" width="480" height="360">
<div class="facts">${facts.map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('')}</div>
<h2>Omschrijving</h2>
<div class="description" lang="${l.language}">${paragraphs(l.description)}</div>
<h2 id="contact">Reageren</h2>
${form}`;
  return page({
    title: `${l.title} | Huisje`,
    brand: 'Huisje',
    home: HOME,
    nav: nav(opts.loggedIn),
    body,
  });
}

export function huisjeContactDone(l: SandboxListing, sub: Submission): string {
  const body = `<h1>Bedankt voor je reactie</h1>
<p class="notice">Je bericht over ${esc(l.addressText)} is doorgestuurd naar ${esc(l.landlord.name)}. Het antwoord komt in je berichten op Huisje (gesprek ${esc(sub.threadId)}).</p>
<p><a href="/huisje/listing/${esc(l.id)}">Terug naar de woning</a></p>`;
  return page({ title: 'Reactie ontvangen | Huisje', brand: 'Huisje', home: HOME, nav: nav(false), body });
}

export function huisjeLogin(next: string, error?: string): string {
  const body = `<h1>Inloggen</h1>
${error ? `<p class="notice">${esc(error)}</p>` : ''}
<form class="stack" method="post" action="/huisje/login">
<input type="hidden" name="next" value="${esc(next)}">
<label>E-mailadres <input name="email" type="email" required autocomplete="username"></label>
<label>Wachtwoord <input name="password" type="password" required autocomplete="current-password"></label>
<button type="submit">Inloggen</button>
</form>
<p class="muted">In de sandbox werkt elk e-mailadres met elk wachtwoord.</p>`;
  return page({ title: 'Inloggen | Huisje', brand: 'Huisje', home: HOME, nav: nav(false), body });
}

export function huisjeMessages(subs: Submission[], loggedIn: boolean): string {
  const rows = subs
    .map((s) => {
      const last = s.messages.at(-1);
      return `<article class="card"><h3>${esc(s.landlord.name)}</h3><p class="muted">Gesprek ${esc(s.threadId)}, ${s.messages.length} berichten</p>${
        last ? `<p>${esc(last.text.slice(0, 180))}</p>` : ''
      }</article>`;
    })
    .join('\n');
  const body = `<h1>Berichten</h1>${subs.length ? `<div class="grid">${rows}</div>` : '<p class="muted">Nog geen gesprekken.</p>'}`;
  return page({ title: 'Berichten | Huisje', brand: 'Huisje', home: HOME, nav: nav(loggedIn), body });
}

export function huisjeNotFound(): string {
  return page({
    title: 'Niet gevonden | Huisje',
    brand: 'Huisje',
    home: HOME,
    body: '<h1>Deze woning staat niet meer online</h1><p><a href="/huisje/">Naar het aanbod</a></p>',
  });
}

import { longDate } from '../dates.js';
import type { SandboxListing, Submission, ViewingSlot } from '../types.js';
import { euros, GRACHT_EMAIL } from '../world.js';
import { esc, page, paragraphs } from './layout.js';

/*
 * Makelaardij De Gracht, the fake estate agent. The markup follows
 * examples/agencies/_template.yaml exactly: cards are `.object` with
 * `.object-street`, `.object-place`, `.object-price`,
 * `.object-feature-woonoppervlakte` and `.object-status`; the listing page
 * has `.object-description`, `.object-media img` and a `#contact` form with
 * `naam`, `email`, `telefoon` and `bericht`. Only the confirmation page says
 * "Bedankt", which is what the template's `success` selector waits for.
 */

const HOME = '/gracht/';
const NAV = '<a href="/gracht/aanbod/woningaanbod/huur/">Huuraanbod</a><a href="/gracht/">Over ons</a>';
const BRAND = 'Makelaardij De Gracht';
const TYPE_SLUG: Record<string, string> = {
  apartment: 'appartement',
  studio: 'studio',
  room: 'kamer',
  house: 'woonhuis',
  other: 'woning',
};
const TYPE_WORD: Record<string, string> = {
  apartment: 'appartement',
  studio: 'studio',
  room: 'kamer',
  house: 'eengezinswoning',
  other: 'woning',
};
const FURNISHING: Record<string, string> = {
  unfurnished: 'Kaal',
  upholstered: 'Gestoffeerd',
  furnished: 'Gemeubileerd',
};
const STATUS: Record<string, string> = {
  available: 'Beschikbaar',
  option: 'Onder optie',
  rented: 'Verhuurd',
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** "/gracht/aanbod/woningaanbod/delft/huur/appartement-2001-tulpgracht-12-a/" */
export function grachtListingPath(l: SandboxListing): string {
  const num = l.id.replace(/^\D+/, '');
  return `/gracht/aanbod/woningaanbod/${slug(l.city)}/huur/${TYPE_SLUG[l.type] ?? 'woning'}-${num}-${slug(l.addressText)}/`;
}

/** The listing id from a detail path slug such as "appartement-2001-tulpgracht-12-a". */
export function grachtIdFromSlug(s: string): string | undefined {
  const m = /^[a-z]+-(\d{3,6})-/.exec(s);
  return m ? `dg-${m[1]}` : undefined;
}

const priceText = (l: SandboxListing) =>
  `${euros(l.priceEur, 'nl')},- per maand ${l.priceBasis === 'incl' ? 'incl.' : 'excl.'}`;

function teaser(l: SandboxListing): string {
  const furn = FURNISHING[l.furnishing] ?? '';
  return `${furn} ${TYPE_WORD[l.type] ?? 'woning'} van ${l.sizeM2} m² in ${l.city}.`;
}

export function grachtHome(): string {
  const body = `<h1>Makelaardij De Gracht</h1>
<p>Wij verhuren woningen in Delft, Rotterdam en Den Haag. Bekijk ons <a href="/gracht/aanbod/woningaanbod/huur/">huuraanbod</a> of mail naar <a href="mailto:${GRACHT_EMAIL}">${GRACHT_EMAIL}</a>.</p>`;
  return page({ title: BRAND, brand: BRAND, home: HOME, nav: NAV, body });
}

export function grachtList(listings: SandboxListing[]): string {
  const cards = listings
    .map(
      (l) => `<div class="object card">
  <a href="${esc(grachtListingPath(l))}">
    <img class="object-photo" src="/media/${esc(l.id)}/1.svg" alt="${esc(l.addressText)}" width="480" height="360">
    <span class="object-street">${esc(l.addressText)}</span>
  </a>
  <p class="object-teaser">${esc(teaser(l))}</p>
  <div><span class="object-place">${esc(l.postcode)} ${esc(l.city)}</span></div>
  <div><span class="object-price">${esc(priceText(l))}</span></div>
  <div><span class="object-feature-woonoppervlakte">Woonoppervlakte ${esc(l.sizeM2)} m²</span>, <span class="object-feature-kamers">Aantal kamers: ${esc(l.rooms)}</span></div>
  <div><span class="object-status">${esc(STATUS[l.status] ?? 'Beschikbaar')}</span></div>
</div>`,
    )
    .join('\n');
  const body = `<h1>Woningaanbod huur</h1>
<div class="grid aanbod">
${cards}
</div>`;
  return page({ title: `Huuraanbod | ${BRAND}`, brand: BRAND, home: HOME, nav: NAV, body });
}

export function grachtDetail(l: SandboxListing): string {
  const facts: [string, string][] = [
    ['Huurprijs', priceText(l)],
    ...(l.serviceCostsEur
      ? ([['Servicekosten', `${euros(l.serviceCostsEur, 'nl')} per maand`]] as [string, string][])
      : []),
    ...(l.depositEur ? ([['Waarborgsom', euros(l.depositEur, 'nl')]] as [string, string][]) : []),
    ['Woonoppervlakte', `${l.sizeM2} m²`],
    ['Aantal kamers', String(l.rooms)],
    ['Slaapkamers', String(l.bedrooms)],
    ['Interieur', FURNISHING[l.furnishing] ?? ''],
    ...(l.energyLabel ? ([['Energielabel', l.energyLabel]] as [string, string][]) : []),
    ['Aanvaarding', `per ${longDate(l.availableFrom, 'nl')}`],
  ];
  const available = l.status === 'available';
  const body = `<p><a href="/gracht/aanbod/woningaanbod/huur/">Terug naar het aanbod</a></p>
<h1 class="object-street">${esc(l.addressText)}</h1>
<p class="object-place muted">${esc(l.postcode)} ${esc(l.city)}</p>
<p><span class="object-status">${esc(STATUS[l.status] ?? 'Beschikbaar')}</span></p>
<div class="object-media">
  <img src="/media/${esc(l.id)}/1.svg" alt="Voorgevel" width="480" height="360">
  <img src="/media/${esc(l.id)}/2.svg" alt="Achtergevel" width="480" height="360">
</div>
<div class="facts">${facts.map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('')}</div>
<h2>Omschrijving</h2>
<div class="object-description">
${paragraphs(l.description)}
</div>
<p>Vragen? Mail ons op <a href="mailto:${GRACHT_EMAIL}">${GRACHT_EMAIL}</a>.</p>
<section id="contact">
  <h2>Reageren</h2>
  ${
    available
      ? `<form class="stack" method="post" action="/gracht/contact">
    <input type="hidden" name="object" value="${esc(l.id)}">
    <label>Naam <input name="naam" required></label>
    <label>E-mail <input name="email" type="email" required></label>
    <label>Telefoon <input name="telefoon" type="tel"></label>
    <label>Bericht <textarea name="bericht" required></textarea></label>
    <button type="submit">Versturen</button>
  </form>`
      : '<p class="notice">Op deze woning kunt u niet meer reageren.</p>'
  }
</section>`;
  return page({ title: `${l.addressText}, ${l.city} | ${BRAND}`, brand: BRAND, home: HOME, nav: NAV, body });
}

export function grachtContactDone(l: SandboxListing): string {
  const body = `<h1>Reactie ontvangen</h1>
<p class="melding notice">Bedankt voor uw reactie op ${esc(l.addressText)}. Wij nemen zo snel mogelijk contact met u op.</p>
<p><a href="${esc(grachtListingPath(l))}">Terug naar de woning</a></p>`;
  return page({ title: `Reactie ontvangen | ${BRAND}`, brand: BRAND, home: HOME, nav: NAV, body });
}

export function grachtContactFailed(reason: string): string {
  const body = `<h1>Reageren is niet gelukt</h1><p class="notice">${esc(reason)}</p>
<p><a href="/gracht/aanbod/woningaanbod/huur/">Naar het aanbod</a></p>`;
  return page({ title: `Reageren niet gelukt | ${BRAND}`, brand: BRAND, home: HOME, nav: NAV, body });
}

export function grachtBooking(
  sub: Submission,
  address: string,
  slots: ViewingSlot[],
  booked?: ViewingSlot,
): string {
  const body = booked
    ? `<h1>Bezichtiging gepland</h1><p class="notice">Uw bezichtiging van ${esc(address)} staat op ${esc(booked.text)}. Tot dan.</p>`
    : slots.length
      ? `<h1>Kies een moment voor de bezichtiging</h1>
<p>Woning: ${esc(address)}</p>
<form class="stack" method="post" action="/gracht/bezichtiging/${esc(sub.id)}">
${slots.map((s, i) => `<label><span><input type="radio" name="slot" value="${i}"${i === 0 ? ' checked' : ''}> ${esc(s.text)}</span></label>`).join('\n')}
<button type="submit">Inplannen</button>
</form>`
      : `<h1>Nog geen momenten</h1><p>Voor ${esc(address)} zijn nog geen tijden voor een bezichtiging.</p>`;
  return page({ title: `Bezichtiging | ${BRAND}`, brand: BRAND, home: HOME, nav: NAV, body });
}

export function grachtNotFound(): string {
  return page({
    title: `Niet gevonden | ${BRAND}`,
    brand: BRAND,
    home: HOME,
    nav: NAV,
    body: '<h1>Deze woning staat niet meer in ons aanbod</h1><p><a href="/gracht/aanbod/woningaanbod/huur/">Naar het huuraanbod</a></p>',
  });
}

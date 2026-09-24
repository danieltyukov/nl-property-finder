import { createWriteStream, existsSync } from 'node:fs';
import { once } from 'node:events';
import PDFDocument from 'pdfkit';
import type { Lang, Profile } from '@nlpf/core';

/*
 * The one-page tenant profile landlords receive automatically (a public
 * document). It holds what a landlord asks first and nothing private:
 * income figures and identity documents stay in the private dossier until a
 * viewing is booked. Type follows Canal Light mapped to the PDF standard
 * fonts: the serif display becomes Times, the sans body Helvetica, the mono
 * labels Courier. Only black at different opacities is used.
 */

const DISPLAY = 'Times-Roman';
const BODY = 'Helvetica';
const BODY_BOLD = 'Helvetica-Bold';
const MONO = 'Courier';

const T = {
  en: {
    title: 'Tenant profile', occupation: 'Occupation', organisation: 'University or employer', household: 'Household', moveIn: 'Move-in from',
    stay: 'Planned stay', guarantor: 'Guarantor', lifestyle: 'Lifestyle', languages: 'Languages', contact: 'Contact', about: 'About me',
    months: (n: number) => `${n} months`, adults: (n: number) => (n === 1 ? '1 adult' : `${n} adults`), children: (n: number) => (n === 1 ? '1 child' : `${n} children`),
    pets: 'pets', noPets: 'no pets', smoker: 'smoker', nonSmoker: 'non-smoker', yes: 'Yes', none: 'None', with: 'with',
    footer: 'Income and identity documents are available after a viewing.',
    occupations: { student: 'Student', phd: 'PhD candidate', employed: 'Employed', self_employed: 'Self-employed', starting_job: 'Starting a new job', other: 'Other' },
    monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    langNames: { en: 'English', nl: 'Dutch', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', zh: 'Chinese', tr: 'Turkish', pl: 'Polish', ru: 'Russian', ar: 'Arabic' } as Record<string, string>,
  },
  nl: {
    title: 'Huurdersprofiel', occupation: 'Beroep', organisation: 'Universiteit of werkgever', household: 'Huishouden', moveIn: 'Verhuizen vanaf',
    stay: 'Geplande huurperiode', guarantor: 'Garantsteller', lifestyle: 'Leefstijl', languages: 'Talen', contact: 'Contact', about: 'Over mij',
    months: (n: number) => `${n} maanden`, adults: (n: number) => (n === 1 ? '1 volwassene' : `${n} volwassenen`), children: (n: number) => (n === 1 ? '1 kind' : `${n} kinderen`),
    pets: 'huisdieren', noPets: 'geen huisdieren', smoker: 'roker', nonSmoker: 'niet-roker', yes: 'Ja', none: 'Geen', with: 'met',
    footer: 'Inkomens- en identiteitsdocumenten zijn beschikbaar na een bezichtiging.',
    occupations: { student: 'Student', phd: 'Promovendus (PhD)', employed: 'In loondienst', self_employed: 'Zelfstandig ondernemer', starting_job: 'Begint binnenkort aan een nieuwe baan', other: 'Anders' },
    monthNames: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
    langNames: { en: 'Engels', nl: 'Nederlands', de: 'Duits', fr: 'Frans', es: 'Spaans', it: 'Italiaans', pt: 'Portugees', zh: 'Chinees', tr: 'Turks', pl: 'Pools', ru: 'Russisch', ar: 'Arabisch' } as Record<string, string>,
  },
};

function formatDate(iso: string, names: string[]): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])} ${names[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/** Dutch labels when the person writes to landlords in Dutch, English otherwise. */
export function profileLanguage(profile: Profile): Lang {
  return profile.messageLanguage === 'nl' ? 'nl' : 'en';
}

/**
 * Renders the tenant profile as one A4 page. A photo is included only when
 * `profile.facts.photo` names a file that exists. Long introductions are
 * cut off with an ellipsis so the profile never runs onto a second page.
 */
export async function renderTenantProfilePdf(profile: Profile, out: string, opts: { language?: Lang } = {}): Promise<void> {
  const t = T[opts.language ?? profileLanguage(profile)];
  const name = `${profile.firstName} ${profile.lastName}`.trim() || t.title;
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `${t.title}: ${name}`, Author: name } });
  const stream = createWriteStream(out);
  doc.pipe(stream);

  const left = 56;
  const width = doc.page.width - 112;
  const bottom = doc.page.height - 56;

  const photo = profile.facts.photo;
  let textWidth = width;
  if (photo && existsSync(photo)) {
    try {
      doc.image(photo, left + width - 110, 56, { fit: [110, 140], align: 'right' });
      textWidth = width - 130;
    } catch {
      // An unreadable image is left out; the profile is still useful without it.
    }
  }

  doc.font(MONO).fontSize(9).fillColor('black', 0.55).text(t.title.toUpperCase(), left, 56, { characterSpacing: 1.2, width: textWidth });
  doc.font(DISPLAY).fontSize(30).fillColor('black', 1).text(name, left, 72, { width: textWidth });
  const occupation = t.occupations[profile.occupation];
  doc.font(BODY).fontSize(12).fillColor('black', 0.75).text([occupation, profile.organisation].filter(Boolean).join(', '), { width: textWidth });

  const household = [t.adults(profile.household.adults)];
  if (profile.household.children) household.push(t.children(profile.household.children));
  const co = profile.coApplicants.map((c) => `${c.name} (${c.relation})`);
  const rows: [string, string | undefined][] = [
    [t.occupation, occupation],
    [t.organisation, profile.organisation],
    [t.household, `${household.join(', ')}${co.length ? `, ${t.with} ${co.join(', ')}` : ''}`],
    [t.moveIn, profile.moveInFrom ? formatDate(profile.moveInFrom, t.monthNames) : undefined],
    [t.stay, profile.stayMonths ? t.months(profile.stayMonths) : undefined],
    [t.guarantor, profile.guarantor ? `${t.yes} (${profile.guarantor.relation}${profile.guarantor.country ? `, ${profile.guarantor.country}` : ''})` : undefined],
    [t.lifestyle, `${profile.smoker ? t.smoker : t.nonSmoker}, ${profile.household.pets ? t.pets : t.noPets}`],
    [t.languages, profile.languages.map((l) => t.langNames[l.toLowerCase()] ?? l.toUpperCase()).join(', ')],
    [t.contact, [profile.email, profile.phone].filter(Boolean).join(', ')],
  ];

  let y = Math.max(doc.y + 24, photo && textWidth < width ? 56 + 150 : 0);
  for (const [label, value] of rows) {
    if (!value) continue;
    doc.font(MONO).fontSize(8.5).fillColor('black', 0.55).text(label.toUpperCase(), left, y, { width: 150, characterSpacing: 0.8 });
    doc.font(BODY).fontSize(11).fillColor('black', 1).text(value, left + 160, y - 1, { width: width - 160 });
    y = Math.max(doc.y, y + 14) + 8;
  }

  if (profile.about.trim()) {
    y += 10;
    doc.font(MONO).fontSize(8.5).fillColor('black', 0.55).text(t.about.toUpperCase(), left, y, { characterSpacing: 0.8 });
    y = doc.y + 6;
    const room = bottom - 40 - y;
    if (room > 20) {
      doc.font(BODY).fontSize(11).fillColor('black', 1).text(profile.about.trim(), left, y, { width, height: room, ellipsis: true, lineGap: 2 });
    }
  }

  doc.font(BODY_BOLD).fontSize(9).fillColor('black', 0.55).text(t.footer, left, bottom - 14, { width, lineBreak: false });
  doc.end();
  await once(stream, 'finish');
}

/*
 * A believable day of searching in Delft, Rotterdam and Den Haag, for the mock
 * server and the component tests. Everything is relative to `now`, so times
 * read "38 s ago" whenever it runs. Addresses are real street names with
 * made-up numbers and people; nothing here is a real listing.
 *
 * This module must stay browser-safe (the tests run it in jsdom), so it
 * imports nothing from Node.
 */
import type {
  Application,
  ContractReview,
  Conversation,
  Listing,
  Match,
  Message,
  NlpfEvent,
  Property,
  PropertyView,
  StatsView,
  StatusView,
  Task,
  Viewing,
} from '@nlpf/core';
import { ConfigSchema } from '../core';
import type { ApplicationView, ConfigView, DocumentView, SourceView } from '../api/views';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ---------- Amsterdam wall-clock helpers ---------- */

function amsterdamParts(ms: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour), mm: Number(p.minute) };
}

/** The UTC instant of an Amsterdam wall-clock time `addDays` from the day of `now`. */
export function amsterdamAt(now: number, addDays: number, hh: number, mm = 0): string {
  const today = amsterdamParts(now + addDays * DAY);
  let guess = Date.UTC(today.y, today.m - 1, today.d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const seen = amsterdamParts(guess);
    const asUtc = Date.UTC(seen.y, seen.m - 1, seen.d, seen.hh, seen.mm);
    guess -= asUtc - Date.UTC(today.y, today.m - 1, today.d, hh, mm);
  }
  return new Date(guess).toISOString();
}

/* ---------- world ---------- */

export interface World {
  now: number;
  properties: PropertyView[];
  tasks: Task[];
  conversations: Conversation[];
  messages: Message[];
  viewings: Viewing[];
  sources: SourceView[];
  config: ConfigView;
  documents: DocumentView[];
  events: NlpfEvent[];
  stats: StatsView;
  paused: boolean;
  startedAt: string;
}

interface Seed {
  id: string;
  street: string;
  number: string;
  addition?: string;
  postcode: string;
  city: string;
  price: number;
  size: number;
  rooms: number;
  type: Property['type'];
  furnishing: Listing['furnishing'];
  sources: string[];
  seenAgo: number;
  description: string;
  agent?: { name: string; email?: string; phone?: string };
  energyLabel?: string;
  availableFrom?: string;
  match: Partial<Match> & { score: number };
  application?: Partial<Application> & { status: Application['status'] };
  responses?: number;
}

const SEEDS: Seed[] = [
  {
    id: 'p_oudedelft12a', street: 'Oude Delft', number: '12', addition: 'A', postcode: '2611 BC', city: 'Delft',
    price: 1150, size: 48, rooms: 2, type: 'apartment', furnishing: 'upholstered', sources: ['funda', 'pararius'], seenAgo: 2 * DAY + 3 * HOUR,
    description: 'Licht en gestoffeerd tweekamerappartement aan de gracht, op loopafstand van de TU en het station. Woonkamer met openslaande ramen, aparte slaapkamer, badkamer met inloopdouche. Inschrijven mogelijk. Huurprijs exclusief servicekosten van EUR 65.',
    agent: { name: 'Delftse Woningmakelaar', email: 'verhuur@delftsewoningmakelaar.nl', phone: '015 212 44 90' }, energyLabel: 'B', availableFrom: '2026-10-15',
    match: { score: 86, reasons: ['rent €1,150 within €1,400', 'Delft centre', '12 min by bike to TU Delft', 'registration allowed'], summary: 'Upholstered two-room flat on the canal in the centre of Delft, near the station. Registration allowed; service costs €65 on top.' },
    application: { status: 'viewing_booked', reactionMs: 38_000, channel: { kind: 'form', sourceId: 'funda' } },
  },
  {
    id: 'p_zwaanshals88', street: 'Zwaanshals', number: '88', postcode: '3035 KS', city: 'Rotterdam',
    price: 895, size: 32, rooms: 1, type: 'studio', furnishing: 'furnished', sources: ['kamernet', 'funda'], seenAgo: 1 * DAY + 5 * HOUR,
    description: 'Gemeubileerde studio in het Oude Noorden met eigen keuken en badkamer. Geschikt voor een werkende starter of promovendus. Inkomenseis 3x de kale huur.',
    agent: { name: 'Rotsvast Rotterdam', email: 'rotterdam@rotsvast.nl' }, energyLabel: 'C', availableFrom: '2026-10-01',
    match: { score: 78, reasons: ['rent €895 within €1,400', 'income 3x rent met', 'furnished'], requirements: { incomeMultiple: 3, studentsAllowed: true } },
    application: { status: 'replied', reactionMs: 44_000, channel: { kind: 'form', sourceId: 'funda' } },
    responses: 14,
  },
  {
    id: 'p_meerdervoort123', street: 'Laan van Meerdervoort', number: '123', addition: 'bis', postcode: '2517 AK', city: 'Den Haag',
    price: 1395, size: 62, rooms: 3, type: 'apartment', furnishing: 'unfurnished', sources: ['funda'], seenAgo: 9 * HOUR,
    description: 'Ruim driekamerappartement op de tweede verdieping met balkon op het zuiden. Kale oplevering, eigen berging. Huurprijs exclusief gas, water en licht.',
    agent: { name: 'Haagsche Makelaardij', email: 'info@haagschemakelaardij.nl' }, energyLabel: 'D', availableFrom: '2026-11-01',
    match: { score: 71, reasons: ['rent €1,395 within €1,400', 'Den Haag Zeeheldenkwartier', 'balcony'] },
    application: { status: 'contacted', reactionMs: 52_000, channel: { kind: 'form', sourceId: 'funda' } },
  },
  {
    id: 'p_voorstraat41', street: 'Voorstraat', number: '41', postcode: '2611 JN', city: 'Delft',
    price: 640, size: 18, rooms: 1, type: 'room', furnishing: 'unfurnished', sources: ['kamernet'], seenAgo: 3 * HOUR,
    description: 'Kamer in een studentenhuis met vier huisgenoten. Gedeelde keuken en badkamer. Geen inschrijving mogelijk.',
    match: { score: 64, reasons: ['room within €750', 'Delft centre'], requirements: { registrationAllowed: false }, searchId: 'rooms-delft' },
    application: { status: 'manual', channel: { kind: 'message', sourceId: 'kamernet' } },
    responses: 41,
  },
  {
    id: 'p_binnenweg215b', street: 'Nieuwe Binnenweg', number: '215', addition: 'B', postcode: '3021 GE', city: 'Rotterdam',
    price: 1290, size: 55, rooms: 2, type: 'apartment', furnishing: 'upholstered', sources: ['pararius', 'huurwoningen'], seenAgo: 20 * HOUR,
    description: 'Gestoffeerd appartement boven een winkel aan de Nieuwe Binnenweg. Slaapkamer aan de achterzijde, rustig. Bezichtigingen op vrijdag en zaterdag.',
    agent: { name: 'Bakker Vastgoed', email: 'verhuur@bakkervastgoed.nl' }, energyLabel: 'C',
    match: { score: 74, reasons: ['rent €1,290 within €1,400', 'Rotterdam Middelland', 'upholstered'] },
    application: { status: 'viewing_proposed', reactionMs: 61_000, channel: { kind: 'form', sourceId: 'pararius' } },
  },
  {
    id: 'p_phoenix66', street: 'Phoenixstraat', number: '66', postcode: '2611 AM', city: 'Delft',
    price: 980, size: 27, rooms: 1, type: 'studio', furnishing: 'furnished', sources: ['ogonline:verra'], seenAgo: 6 * HOUR,
    description: 'Compacte gemeubileerde studio vlak bij station Delft. Eigen voordeur, pantry en douche. Per 1 november beschikbaar.',
    agent: { name: 'Verra Makelaars', email: 'delft@verra.nl' }, energyLabel: 'A', availableFrom: '2026-11-01',
    match: { score: 69, reasons: ['rent €980 within €1,400', '4 min walk to station Delft'] },
    application: { status: 'replied', reactionMs: 47_000, channel: { kind: 'email', address: 'delft@verra.nl' } },
  },
  {
    id: 'p_wittedewith12c', street: 'Witte de Withstraat', number: '12', addition: 'C', postcode: '3012 BP', city: 'Rotterdam',
    price: 650, size: 40, rooms: 2, type: 'apartment', furnishing: 'furnished', sources: ['marktplaats'], seenAgo: 4 * HOUR,
    description: 'Beautiful apartment in the centre. I am currently abroad for work, so I will send the keys by post after you transfer the first month and the deposit.',
    match: { score: 12, passed: false, failedRule: 'scam guard', reasons: [], scam: { level: 'likely', signals: ['price_far_below_median', 'landlord_abroad', 'keys_by_post', 'payment_before_viewing'] } },
  },
  {
    id: 'p_prinsegracht30', street: 'Prinsegracht', number: '30', postcode: '2512 GA', city: 'Den Haag',
    price: 1650, size: 70, rooms: 3, type: 'apartment', furnishing: 'unfurnished', sources: ['funda', 'pararius'], seenAgo: 7 * HOUR,
    description: 'Statig bovenhuis aan de Prinsegracht met hoge plafonds en een dakterras.',
    match: { score: 0, passed: false, failedRule: 'rent €1,650 above €1,400', reasons: [] },
  },
  {
    id: 'p_kanaalweg5', street: 'Kanaalweg', number: '5', postcode: '2628 EB', city: 'Delft',
    price: 1190, size: 30, rooms: 1, type: 'studio', furnishing: 'upholstered', sources: ['funda'], seenAgo: 11 * HOUR,
    description: 'Studio op de TU-wijk met eigen keuken en badkamer. Energielabel A. WOZ-waarde volgens eigenaar 178.000.',
    agent: { name: 'Campus Wonen Delft', email: 'info@campuswonendelft.nl' }, energyLabel: 'A',
    match: {
      score: 58, reasons: ['rent €1,190 within €1,400', '5 min by bike to TU Delft'],
      rentCheck: { points: 146, maxRentEur: 845, sector: 'middle', aboveMaxPct: 41, inputs: { sizeM2: 30, energyLabel: 'A', wozEur: 178_000, buildYear: 1972 }, sources: ['bag', 'woz', 'listing'], note: 'An estimate from the 2025 point system for independent homes. The Huurcommissie can check the real maximum.' },
    },
    application: { status: 'contacted', reactionMs: 41_000, channel: { kind: 'form', sourceId: 'funda' } },
  },
  {
    id: 'p_plaslaan20', street: 'Kralingse Plaslaan', number: '20', postcode: '3062 BA', city: 'Rotterdam',
    price: 1380, size: 95, rooms: 4, type: 'house', furnishing: 'unfurnished', sources: ['funda'], seenAgo: 6 * DAY,
    description: 'Eengezinswoning met tuin op het zuiden, vlak bij de Kralingse Plas. Drie slaapkamers. Onbepaalde tijd.',
    agent: { name: 'Plas Makelaars', email: 'verhuur@plasmakelaars.nl', phone: '010 452 18 30' }, energyLabel: 'B',
    match: { score: 81, reasons: ['rent €1,380 within €1,400', 'garden', 'indefinite contract'] },
    application: { status: 'offer', reactionMs: 35_000, channel: { kind: 'form', sourceId: 'funda' } },
  },
  {
    id: 'p_pietheinstraat88', street: 'Piet Heinstraat', number: '88', postcode: '2518 CL', city: 'Den Haag',
    price: 1250, size: 45, rooms: 2, type: 'apartment', furnishing: 'furnished', sources: ['housinganywhere', 'marktplaats'], seenAgo: 1 * DAY + 2 * HOUR,
    description: 'Fully furnished apartment in the Zeeheldenkwartier. Available immediately for expats.',
    match: { score: 62, reasons: ['rent €1,250 within €1,400', 'furnished'], scam: { level: 'possible', signals: ['payment_before_viewing'] } },
    application: { status: 'replied', reactionMs: 58_000, channel: { kind: 'email', address: 'j.vermeer.rentals@gmail.com' } },
  },
  {
    id: 'p_hooikade14', street: 'Hooikade', number: '14', postcode: '2627 AB', city: 'Delft',
    price: 1325, size: 52, rooms: 2, type: 'apartment', furnishing: 'upholstered', sources: ['funda'], seenAgo: 2 * MIN,
    description: 'Appartement aan het water bij de Hooikade, met open keuken en ruime slaapkamer. Beschikbaar per 1 november.',
    agent: { name: 'Delftse Woningmakelaar', email: 'verhuur@delftsewoningmakelaar.nl' }, energyLabel: 'B',
    match: { score: 76, reasons: ['rent €1,325 within €1,400', 'Delft Hooikade', 'available 1 Nov'] },
    application: { status: 'contacted', reactionMs: 36_000, channel: { kind: 'form', sourceId: 'funda' } },
  },
  {
    id: 'p_mathenesser301', street: 'Mathenesserlaan', number: '301', postcode: '3021 HM', city: 'Rotterdam',
    price: 575, size: 16, rooms: 1, type: 'room', furnishing: 'furnished', sources: ['housinganywhere'], seenAgo: 5 * HOUR,
    description: 'Furnished room in a shared house with three professionals.',
    match: { score: 55, reasons: ['room within €750'], searchId: 'rooms-delft' },
  },
  {
    id: 'p_zeestraat71', street: 'Zeestraat', number: '71', postcode: '2518 AA', city: 'Den Haag',
    price: 890, size: 50, rooms: 2, type: 'apartment', furnishing: 'furnished', sources: ['marktplaats'], seenAgo: 8 * HOUR,
    description: 'Mooi appartement, alles inclusief. Neem contact op via WhatsApp. Borg graag vooraf overmaken, dan houd ik de woning voor je vast.',
    match: { score: 40, reasons: ['rent €890 within €1,400'], scam: { level: 'possible', signals: ['whatsapp_only', 'payment_before_viewing', 'price_far_below_median'] } },
  },
  {
    id: 'p_rotterdamseweg180', street: 'Rotterdamseweg', number: '180', postcode: '2628 AR', city: 'Delft',
    price: 1100, size: 44, rooms: 2, type: 'apartment', furnishing: 'upholstered', sources: ['pararius'], seenAgo: 3 * DAY,
    description: 'Tweekamerappartement met uitzicht op de Schie.',
    agent: { name: 'Schie Wonen', email: 'info@schiewonen.nl' },
    match: { score: 66, reasons: ['rent €1,100 within €1,400'] },
    application: { status: 'rejected', reactionMs: 49_000, channel: { kind: 'form', sourceId: 'pararius' }, note: 'Helaas is de woning al verhuurd.' },
  },
];

const SOURCE_URL: Record<string, string> = {
  funda: 'https://www.funda.nl/detail/huur/',
  pararius: 'https://www.pararius.nl/appartement-te-huur/',
  kamernet: 'https://kamernet.nl/huren/',
  huurwoningen: 'https://www.huurwoningen.nl/huren/',
  housinganywhere: 'https://housinganywhere.com/room/',
  marktplaats: 'https://www.marktplaats.nl/v/huizen-en-kamers/',
  'ogonline:verra': 'https://www.verra.nl/aanbod/',
};

/** Approximate coordinates, as PDOK geocoding would fill them in. */
const COORDS: Record<string, [number, number]> = {
  p_oudedelft12a: [52.0118, 4.3553],
  p_zwaanshals88: [51.9335, 4.4745],
  p_meerdervoort123: [52.0785, 4.2935],
  p_voorstraat41: [52.0122, 4.357],
  p_binnenweg215b: [51.9135, 4.461],
  p_phoenix66: [52.009, 4.356],
  p_wittedewith12c: [51.9162, 4.4745],
  p_prinsegracht30: [52.0765, 4.308],
  p_kanaalweg5: [51.999, 4.372],
  p_plaslaan20: [51.929, 4.513],
  p_pietheinstraat88: [52.085, 4.299],
  p_hooikade14: [52.015, 4.36],
  p_mathenesser301: [51.914, 4.456],
  p_zeestraat71: [52.0875, 4.303],
  p_rotterdamseweg180: [51.9975, 4.378],
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildProperty(seed: Seed, now: number): { view: PropertyView; seenAt: number } {
  const seenAt = now - seed.seenAgo;
  const iso = new Date(seenAt).toISOString();
  const [lat, lon] = COORDS[seed.id] ?? [undefined, undefined];
  const address = { street: seed.street, houseNumber: seed.number, addition: seed.addition, postcode: seed.postcode, city: seed.city, municipality: seed.city, lat, lon };
  const title = `${seed.street} ${seed.number}${seed.addition ?? ''}`;
  const property: Property = {
    id: seed.id, key: `pc:${seed.postcode.replace(' ', '')}:${seed.number}:${(seed.addition ?? '').toLowerCase()}`,
    address, title, priceEur: seed.price, sizeM2: seed.size, type: seed.type, createdAt: iso, updatedAt: iso,
  };
  const listings: Listing[] = seed.sources.map((sourceId, i) => {
    const externalId = `${slug(title)}-${seed.postcode.replace(' ', '').toLowerCase()}`;
    const spelled = i === 0 ? title : `${seed.street} ${seed.number}${seed.addition ? `-${seed.addition}` : ''}`;
    return {
      id: `${sourceId}:${externalId}`, sourceId, externalId,
      url: `${SOURCE_URL[sourceId] ?? 'https://example.nl/'}${externalId}`,
      title: `${spelled}, ${seed.city}`, priceEur: seed.price + (i === 1 ? 0 : 0), priceBasis: 'excl', sizeM2: seed.size, rooms: seed.rooms,
      type: seed.type, furnishing: seed.furnishing, address: i === 0 ? address : { ...address, addition: seed.addition ? `-${seed.addition}` : undefined },
      availableFrom: seed.availableFrom, description: seed.description, energyLabel: seed.energyLabel, agent: seed.agent,
      contact: sourceId === 'kamernet' || sourceId === 'housinganywhere' || sourceId === 'marktplaats' ? 'message' : seed.agent?.email && sourceId.startsWith('ogonline') ? 'email' : 'form',
      language: seed.description.startsWith('Beautiful') || seed.description.startsWith('Fully') || seed.description.startsWith('Furnished') ? 'en' : 'nl',
      extra: seed.responses && sourceId === 'kamernet' ? { responses: seed.responses } : seed.responses && i === 0 ? { responses: seed.responses } : {},
      propertyId: seed.id, firstSeenAt: new Date(seenAt + i * 7 * MIN).toISOString(), lastSeenAt: new Date(now - 40_000).toISOString(),
      state: 'active', via: 'poll',
    };
  });
  const match: Match = {
    propertyId: seed.id, passed: seed.match.passed ?? true, failedRule: seed.match.failedRule, score: seed.match.score,
    reasons: seed.match.reasons ?? [], requirements: seed.match.requirements ?? {}, scam: seed.match.scam ?? { level: 'none', signals: [] },
    summary: seed.match.summary, searchId: seed.match.searchId ?? 'main', rentCheck: seed.match.rentCheck, by: 'ai',
    evaluatedAt: new Date(seenAt + 4_000).toISOString(),
  };
  const application: Application | null = seed.application
    ? {
        id: `app_${seed.id.slice(2)}`, propertyId: seed.id, firstSeenAt: iso,
        contactedAt: seed.application.reactionMs ? new Date(seenAt + seed.application.reactionMs).toISOString() : undefined,
        updatedAt: new Date(now - Math.min(seed.seenAgo / 3, 3 * HOUR)).toISOString(), ...seed.application,
      }
    : null;
  return { view: { property, listings, match, application, viewings: [], conversationIds: [] }, seenAt };
}

interface ConvSeed {
  id: string;
  propertyId: string;
  counterpart: Conversation['counterpart'];
  messages: { dir: 'in' | 'out'; author: Message['author']; ago: number; body: string; intent?: Message['intent']; rationale?: string; channel?: Message['channel']; attachments?: Message['attachments']; subject?: string }[];
  unread?: number;
}

const FIRST_NL = (street: string, name = 'heer, mevrouw') =>
  `Beste ${name},\n\nIk zag uw advertentie voor ${street} en ben erg geïnteresseerd. Ik ben Sam de Vries, 29 jaar, promovendus aan de TU Delft met een vast inkomen van EUR 2.950 bruto per maand. Ik rook niet, heb geen huisdieren en kan per 15 oktober huren.\n\nGraag kom ik langs voor een bezichtiging. Ik ben op werkdagen na 17:00 en in het weekend flexibel.\n\nMet vriendelijke groet,\nSam de Vries\n06 1234 5678`;

const CONVERSATIONS: ConvSeed[] = [
  {
    id: 'c_oudedelft', propertyId: 'p_oudedelft12a', counterpart: { name: 'Marieke Smit, Delftse Woningmakelaar', email: 'verhuur@delftsewoningmakelaar.nl', sourceId: 'funda' },
    messages: [
      { dir: 'out', author: 'agent', ago: 2 * DAY + 3 * HOUR - 38_000, channel: 'form', body: FIRST_NL('Oude Delft 12A'), rationale: 'Dutch listing, so Dutch. Led with the PhD at TU Delft and the fixed income because the listing mentions an income requirement, and offered evenings and weekends from your availability. Variant: personal.' },
      { dir: 'in', author: 'landlord', ago: 20 * HOUR, intent: 'viewing_slots', subject: 'Bezichtiging Oude Delft 12A', body: 'Beste Sam,\n\nDank voor je reactie. We organiseren bezichtigingen op donderdag om 18:30, vrijdag om 12:00 en zaterdag om 10:15. Laat maar weten wat je past.\n\nGroet,\nMarieke Smit' },
      { dir: 'out', author: 'agent', ago: 20 * HOUR - 50_000, channel: 'email', body: 'Beste Marieke,\n\nDonderdag om 18:30 komt mij goed uit. Ik zie u dan bij Oude Delft 12A.\n\nMet vriendelijke groet,\nSam de Vries', rationale: 'Thursday 18:30 is the earliest slot inside your availability (weekdays 09:00 to 20:00) with a 45 minute buffer after your last booked viewing.' },
    ],
  },
  {
    id: 'c_zwaanshals', propertyId: 'p_zwaanshals88', counterpart: { name: 'Anouk Jansen, Rotsvast Rotterdam', email: 'rotterdam@rotsvast.nl', sourceId: 'funda' }, unread: 1,
    messages: [
      { dir: 'out', author: 'agent', ago: 1 * DAY + 5 * HOUR - 44_000, channel: 'form', body: FIRST_NL('Zwaanshals 88', 'mevrouw Jansen'), rationale: 'Dutch listing with an income requirement of 3x the rent. Your income covers it, so the message says so plainly. Variant: short.' },
      { dir: 'in', author: 'landlord', ago: 35 * MIN, intent: 'documents_request', subject: 'RE: Zwaanshals 88', body: 'Beste Sam,\n\nVoordat we een bezichtiging plannen ontvangen we graag je laatste drie loonstroken en een kopie van je paspoort.\n\nMet vriendelijke groet,\nAnouk Jansen\nRotsvast Rotterdam' },
    ],
  },
  {
    id: 'c_meerdervoort', propertyId: 'p_meerdervoort123', counterpart: { name: 'Haagsche Makelaardij', email: 'info@haagschemakelaardij.nl', sourceId: 'funda' },
    messages: [{ dir: 'out', author: 'agent', ago: 9 * HOUR - 52_000, channel: 'form', body: FIRST_NL('Laan van Meerdervoort 123 bis'), rationale: 'Dutch listing. The flat is unfurnished and available from 1 November, which matches your move-in window. Variant: personal.' }],
  },
  {
    id: 'c_binnenweg', propertyId: 'p_binnenweg215b', counterpart: { name: 'R. Bakker, Bakker Vastgoed', email: 'verhuur@bakkervastgoed.nl', sourceId: 'pararius' }, unread: 1,
    messages: [
      { dir: 'out', author: 'agent', ago: 20 * HOUR - 61_000, channel: 'form', body: FIRST_NL('Nieuwe Binnenweg 215B', 'heer Bakker'), rationale: 'Dutch listing that says viewings are on Friday and Saturday, so the message offers weekend availability first.' },
      { dir: 'in', author: 'landlord', ago: 3 * HOUR, intent: 'viewing_slots', body: 'Hoi Sam, je kunt komen kijken op vrijdag tussen 10:00 en 10:15, zaterdag om half twaalf of maandag rond vijf uur. Groet, Rob Bakker' },
    ],
  },
  {
    id: 'c_phoenix', propertyId: 'p_phoenix66', counterpart: { name: 'Verra Makelaars Delft', email: 'delft@verra.nl', sourceId: 'ogonline:verra' }, unread: 1,
    messages: [
      { dir: 'out', author: 'agent', ago: 6 * HOUR - 47_000, channel: 'email', subject: 'Phoenixstraat 66, Delft', body: FIRST_NL('Phoenixstraat 66'), rationale: 'The agency lists an email address and no form, so this went by email from your dedicated mailbox.' },
      { dir: 'in', author: 'landlord', ago: 2 * HOUR, intent: 'info_request', subject: 'RE: Phoenixstraat 66, Delft', body: 'Beste Sam,\n\nBedankt. Heb je huisdieren, en kun je per 1 november huren in plaats van 15 oktober?\n\nGroeten,\nLotte van Dijk' },
      { dir: 'out', author: 'agent', ago: 2 * HOUR - 70_000, channel: 'email', body: 'Beste Lotte,\n\nIk heb geen huisdieren. Over de ingangsdatum kom ik zo snel mogelijk bij u terug.\n\nMet vriendelijke groet,\nSam de Vries', rationale: 'Answered the pets question from your profile. The start date is a decision for you, so it is in the inbox with a draft.' },
    ],
  },
  {
    id: 'c_piethein', propertyId: 'p_pietheinstraat88', counterpart: { name: 'J. Vermeer', email: 'j.vermeer.rentals@gmail.com' }, unread: 1,
    messages: [
      { dir: 'out', author: 'agent', ago: 1 * DAY + 2 * HOUR - 58_000, channel: 'email', body: 'Dear Mr Vermeer,\n\nI saw your listing for Piet Heinstraat 88 and I am interested. I am Sam de Vries, a PhD candidate at TU Delft with a fixed income, non-smoking and without pets. I could move in from 15 October.\n\nI would like to view the apartment. Weekday evenings and weekends work for me.\n\nKind regards,\nSam de Vries', rationale: 'English listing, so English. Kept it short because the advert was short.' },
      { dir: 'in', author: 'landlord', ago: 50 * MIN, intent: 'payment_request', body: 'Hello Sam, many people want this apartment. If you transfer the deposit of EUR 2500 today I will reserve it for you and we can do the viewing next week when I am back in the Netherlands.' },
    ],
  },
  {
    id: 'c_plaslaan', propertyId: 'p_plaslaan20', counterpart: { name: 'Plas Makelaars', email: 'verhuur@plasmakelaars.nl', sourceId: 'funda' },
    messages: [
      { dir: 'out', author: 'agent', ago: 6 * DAY - 35_000, channel: 'form', body: FIRST_NL('Kralingse Plaslaan 20'), rationale: 'Dutch listing for a family house; the message mentions your household of one adult and your fixed income.' },
      { dir: 'in', author: 'landlord', ago: 4 * DAY, intent: 'viewing_invite', body: 'Beste Sam, u bent welkom op dinsdag om 17:30.' },
      { dir: 'out', author: 'agent', ago: 4 * DAY - 40_000, channel: 'email', body: 'Beste heer, mevrouw,\n\nDinsdag om 17:30 komt goed uit. Tot dan.\n\nMet vriendelijke groet,\nSam de Vries', rationale: 'Tuesday 17:30 fits your availability.' },
      { dir: 'in', author: 'landlord', ago: 3 * HOUR, intent: 'offer', subject: 'Aanbieding Kralingse Plaslaan 20', body: 'Beste Sam,\n\nNa de bezichtiging bieden wij u de woning graag aan per 1 november. In de bijlage vindt u het huurcontract. Graag ontvangen wij de waarborgsom van drie maanden kale huur en de bemiddelingskosten van EUR 350 voor ondertekening.\n\nMet vriendelijke groet,\nPlas Makelaars', attachments: [{ filename: 'huurovereenkomst-kralingse-plaslaan-20.pdf', contentType: 'application/pdf', size: 184_220 }] },
    ],
  },
  {
    id: 'c_rotterdamseweg', propertyId: 'p_rotterdamseweg180', counterpart: { name: 'Schie Wonen', email: 'info@schiewonen.nl', sourceId: 'pararius' },
    messages: [
      { dir: 'out', author: 'agent', ago: 3 * DAY - 49_000, channel: 'form', body: FIRST_NL('Rotterdamseweg 180'), rationale: 'Dutch listing. Variant: short.' },
      { dir: 'in', author: 'landlord', ago: 2 * DAY, intent: 'rejection', body: 'Beste Sam, helaas is de woning al verhuurd. Succes met zoeken.' },
    ],
  },
];

const SOURCES: SourceView[] = [
  { sourceId: 'funda', name: 'Funda', enabled: true, health: 'ok', consecutiveFailures: 0, consecutiveEmpty: 0, lastLatencyMs: 820, lastCount: 14, homepage: 'https://www.funda.nl', intervalSec: 90, contactMode: 'auto', termsNote: 'Funda\'s terms forbid automated use of the site.', capabilities: { search: 'html', detail: true, contact: 'form', login: 'none', terms: 'forbids', browser: 'headless' } },
  { sourceId: 'kamernet', name: 'Kamernet', enabled: true, health: 'watch_only', consecutiveFailures: 0, consecutiveEmpty: 0, lastLatencyMs: 410, lastCount: 22, homepage: 'https://kamernet.nl', intervalSec: 60, contactMode: 'watch_only', termsNote: 'Kamernet\'s terms forbid automated access and messaging.', capabilities: { search: 'json', detail: true, contact: 'message', login: 'required', paid: { feature: 'contact', plan: 'kamernet-premium' }, terms: 'forbids' } },
  { sourceId: 'pararius', name: 'Pararius', enabled: true, health: 'needs_login', consecutiveFailures: 1, consecutiveEmpty: 0, lastLatencyMs: 4200, lastCount: 9, lastError: 'Session expired: the account page redirected to /inloggen.', homepage: 'https://www.pararius.nl', intervalSec: 150, contactMode: 'auto', termsNote: 'Pararius\'s terms forbid scraping and automated messages.', capabilities: { search: 'browser', detail: true, contact: 'form', login: 'required', terms: 'forbids', browser: 'headed' } },
  { sourceId: 'huurwoningen', name: 'Huurwoningen', enabled: true, health: 'degraded', consecutiveFailures: 0, consecutiveEmpty: 3, lastLatencyMs: 3900, lastCount: 0, lastError: '3 empty checks in a row while this source usually finds 2 to 3 per check. The page layout may have changed.', homepage: 'https://www.huurwoningen.nl', intervalSec: 180, contactMode: 'watch_only', termsNote: 'Huurwoningen\'s terms forbid automated access.', capabilities: { search: 'browser', detail: true, contact: 'form', login: 'required', paid: { feature: 'contact', plan: 'huurwoningen-plus' }, terms: 'forbids', browser: 'headed' } },
  { sourceId: 'housinganywhere', name: 'HousingAnywhere', enabled: true, health: 'watch_only', consecutiveFailures: 0, consecutiveEmpty: 0, lastLatencyMs: 350, lastCount: 6, homepage: 'https://housinganywhere.com', intervalSec: 60, contactMode: 'watch_only', termsNote: 'HousingAnywhere\'s terms forbid automated messaging.', capabilities: { search: 'json', detail: true, contact: 'message', login: 'required', paid: { feature: 'contact', plan: 'housinganywhere-plus' }, terms: 'forbids' } },
  { sourceId: 'roommatch', name: 'RoomMatch', enabled: true, health: 'ok', consecutiveFailures: 0, consecutiveEmpty: 0, lastLatencyMs: 290, lastCount: 3, homepage: 'https://www.roommatch.nl', intervalSec: 60, contactMode: 'auto', capabilities: { search: 'json', detail: true, contact: 'form', login: 'required', terms: 'unknown' } },
  { sourceId: 'woonnet-haaglanden', name: 'Woonnet Haaglanden', enabled: true, health: 'ok', consecutiveFailures: 0, consecutiveEmpty: 0, lastLatencyMs: 310, lastCount: 5, homepage: 'https://www.woonnet-haaglanden.nl', intervalSec: 120, contactMode: 'auto', capabilities: { search: 'json', detail: true, contact: 'form', login: 'required', terms: 'unknown' } },
  { sourceId: 'ogonline:verra', name: 'Verra Makelaars', enabled: true, health: 'ok', consecutiveFailures: 0, consecutiveEmpty: 0, lastLatencyMs: 520, lastCount: 4, homepage: 'https://www.verra.nl', intervalSec: 120, contactMode: 'auto', capabilities: { search: 'json', detail: true, contact: 'email', login: 'none', terms: 'unknown' } },
  { sourceId: 'holland2stay', name: 'Holland2Stay', enabled: true, health: 'ok', consecutiveFailures: 0, consecutiveEmpty: 0, lastLatencyMs: 690, lastCount: 2, homepage: 'https://www.holland2stay.com', intervalSec: 60, contactMode: 'watch_only', termsNote: 'Holland2Stay\'s terms forbid automated bookings. A matching unit opens its booking page on your screen instead.', capabilities: { search: 'json', detail: true, contact: 'booking', login: 'required', terms: 'forbids' } },
  { sourceId: 'marktplaats', name: 'Marktplaats', enabled: true, health: 'down', consecutiveFailures: 5, consecutiveEmpty: 0, lastLatencyMs: 12_000, lastError: '429 Too Many Requests. Backing off; next try in 8 min.', homepage: 'https://www.marktplaats.nl', intervalSec: 120, contactMode: 'watch_only', termsNote: 'Marktplaats\'s terms forbid automated access and messages.', capabilities: { search: 'json', detail: true, contact: 'message', login: 'required', terms: 'forbids' } },
  { sourceId: 'vesteda', name: 'Vesteda', enabled: false, health: 'disabled', consecutiveFailures: 0, consecutiveEmpty: 0, homepage: 'https://www.vesteda.com', intervalSec: 300, contactMode: 'watch_only', termsNote: 'Vesteda\'s terms forbid automated use of Mijn Vesteda.', capabilities: { search: 'json', detail: true, contact: 'form', login: 'required', terms: 'forbids' } },
];

const REVIEW: ContractReview = {
  summary: 'Indefinite lease from 1 November 2026 at €1,380 a month excluding €95 service costs.',
  findings: [
    { severity: 'illegal', topic: 'Deposit', text: 'The deposit is three months of base rent (€4,140). Since 1 July 2023 the maximum is two months.' },
    { severity: 'illegal', topic: 'Mediation fee', text: 'Bemiddelingskosten of €350 are charged to you. An agent who works for the landlord may not charge the tenant.' },
    { severity: 'warning', topic: 'Service costs', text: '€95 a month in service costs without a breakdown. Ask for the yearly statement.' },
    { severity: 'info', topic: 'Notice period', text: 'One month notice for you, which is the legal standard.' },
  ],
};

export function buildWorld(now: number = Date.now(), opts: { fresh?: boolean } = {}): World {
  const properties: PropertyView[] = [];
  const firstSeen = new Map<string, number>();
  for (const seed of SEEDS) {
    const { view, seenAt } = buildProperty(seed, now);
    properties.push(view);
    firstSeen.set(seed.id, seenAt);
  }
  const byId = new Map(properties.map((p) => [p.property.id, p]));

  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  for (const c of CONVERSATIONS) {
    const view = byId.get(c.propertyId);
    const list = c.messages.map((m, i): Message => ({
      id: `m_${c.id.slice(2)}_${i}`, conversationId: c.id, direction: m.dir, author: m.author, channel: m.channel ?? 'email',
      subject: m.subject, body: m.body, at: new Date(now - m.ago).toISOString(), status: m.dir === 'in' ? 'received' : 'sent',
      intent: m.intent, rationale: m.rationale, attachments: m.attachments,
    }));
    messages.push(...list);
    conversations.push({
      id: c.id, applicationId: view?.application?.id ?? null, propertyId: c.propertyId, counterpart: c.counterpart,
      subject: list.find((m) => m.subject)?.subject, lastMessageAt: list[list.length - 1]!.at, unread: c.unread ?? 0,
    });
    view?.conversationIds.push(c.id);
  }

  const viewings: Viewing[] = [
    { id: 'v_oudedelft', applicationId: 'app_oudedelft12a', propertyId: 'p_oudedelft12a', startsAt: amsterdamAt(now, 1, 18, 30), endsAt: amsterdamAt(now, 1, 18, 45), location: 'Oude Delft 12A, Delft', state: 'booked', bookedBy: 'agent' },
    { id: 'v_plaslaan', applicationId: 'app_plaslaan20', propertyId: 'p_plaslaan20', startsAt: amsterdamAt(now, -4, 17, 30), endsAt: amsterdamAt(now, -4, 18, 0), location: 'Kralingse Plaslaan 20, Rotterdam', state: 'done', bookedBy: 'agent' },
    { id: 'v_meerdervoort', applicationId: 'app_meerdervoort123', propertyId: 'p_meerdervoort123', startsAt: amsterdamAt(now, 3, 11, 0), endsAt: amsterdamAt(now, 3, 11, 20), location: 'Laan van Meerdervoort 123 bis, Den Haag', state: 'booked', bookedBy: 'human', note: 'Bring your passport, the agent asked for it on the phone.' },
    { id: 'v_binnenweg', applicationId: 'app_binnenweg215b', propertyId: 'p_binnenweg215b', startsAt: amsterdamAt(now, 2, 10, 0), endsAt: amsterdamAt(now, 2, 10, 15), location: 'Nieuwe Binnenweg 215B, Rotterdam', state: 'proposed', bookedBy: 'agent' },
  ];
  for (const v of viewings) byId.get(v.propertyId)?.viewings.push(v);

  const t = (i: number) => new Date(now - i).toISOString();
  const tasks: Task[] = [
    {
      id: 't_viewing_oudedelft', kind: 'viewing_booked', priority: 1, state: 'open', propertyId: 'p_oudedelft12a', applicationId: 'app_oudedelft12a', conversationId: 'c_oudedelft',
      title: `Viewing booked, ${fmtDay(viewings[0]!.startsAt)}`, reason: 'The landlord offered three times. The agent took the first one inside your availability and confirmed it. Keep it or cancel before they plan the evening.',
      dueAt: new Date(now + 2 * HOUR).toISOString(), createdAt: t(20 * HOUR - 55_000), updatedAt: t(20 * HOUR - 55_000),
      payload: { viewing: { startsAt: viewings[0]!.startsAt, endsAt: viewings[0]!.endsAt, location: viewings[0]!.location } },
    },
    {
      id: 't_offer_plaslaan', kind: 'offer_or_contract', priority: 1, state: 'open', propertyId: 'p_plaslaan20', applicationId: 'app_plaslaan20', conversationId: 'c_plaslaan',
      title: 'Offer and contract for Kralingse Plaslaan 20', reason: 'The agency offers you the house from 1 November and sent a contract. Two clauses break the rules; nothing is signed or paid by the agent.',
      dueAt: new Date(now + 26 * HOUR).toISOString(), createdAt: t(3 * HOUR), updatedAt: t(3 * HOUR),
      payload: { contractReview: REVIEW, draft: 'Beste heer, mevrouw,\n\nDank voor het aanbod, daar ben ik blij mee. Voordat ik teken: de waarborgsom mag sinds 1 juli 2023 maximaal twee maanden kale huur zijn, en bemiddelingskosten mogen niet bij de huurder in rekening worden gebracht. Kunt u het contract daarop aanpassen?\n\nMet vriendelijke groet,\nSam de Vries' },
    },
    {
      id: 't_payment_piethein', kind: 'payment_warning', priority: 1, state: 'open', propertyId: 'p_pietheinstraat88', applicationId: 'app_pietheinstraat88', conversationId: 'c_piethein',
      title: 'Deposit asked before a viewing, Piet Heinstraat 88', reason: 'The advertiser wants €2,500 today to "reserve" a flat nobody has seen, and says he is abroad. The agent did not reply. Do not pay before a viewing and a signed contract.',
      createdAt: t(50 * MIN), updatedAt: t(50 * MIN),
      payload: { signals: ['payment_before_viewing', 'landlord_abroad'], message: 'Hello Sam, many people want this apartment. If you transfer the deposit of EUR 2500 today I will reserve it for you and we can do the viewing next week when I am back in the Netherlands.' },
    },
    {
      id: 't_slots_binnenweg', kind: 'viewing_choice', priority: 2, state: 'open', propertyId: 'p_binnenweg215b', applicationId: 'app_binnenweg215b', conversationId: 'c_binnenweg',
      title: 'Pick a viewing time, Nieuwe Binnenweg 215B', reason: 'Friday 10:00 clashes with nothing but is outside your weekday hours, and "maandag rond vijf uur" is not a fixed time. The agent did not choose for you.',
      dueAt: new Date(now + 5 * HOUR).toISOString(), createdAt: t(3 * HOUR - 30_000), updatedAt: t(3 * HOUR - 30_000),
      payload: {
        slots: [
          { start: amsterdamAt(now, 2, 10, 0), end: amsterdamAt(now, 2, 10, 15), text: 'vrijdag tussen 10:00 en 10:15', certain: true },
          { start: amsterdamAt(now, 3, 11, 30), text: 'zaterdag om half twaalf', certain: true },
          { start: amsterdamAt(now, 5, 17, 0), text: 'maandag rond vijf uur', certain: false },
        ],
        draft: 'Hoi Rob,\n\nZaterdag om half twaalf komt mij goed uit. Tot dan.\n\nGroet,\nSam de Vries',
      },
    },
    {
      id: 't_docs_zwaanshals', kind: 'documents_approval', priority: 2, state: 'open', propertyId: 'p_zwaanshals88', applicationId: 'app_zwaanshals88', conversationId: 'c_zwaanshals',
      title: 'Payslips and passport requested for Zwaanshals 88', reason: 'Rotsvast asks for three payslips and a passport copy before any viewing. Private and identity documents wait for you until a viewing is booked.',
      createdAt: t(35 * MIN), updatedAt: t(35 * MIN),
      payload: { documents: ['loonstrook-2026-07.pdf', 'loonstrook-2026-08.pdf', 'loonstrook-2026-09.pdf', 'paspoort.pdf (watermarked)'], draft: 'Beste Anouk,\n\nIn de bijlage mijn laatste drie loonstroken en een kopie van mijn paspoort met watermerk. Ik kom graag kijken.\n\nMet vriendelijke groet,\nSam de Vries' },
    },
    {
      id: 't_reply_phoenix', kind: 'reply_needed', priority: 2, state: 'open', propertyId: 'p_phoenix66', applicationId: 'app_phoenix66', conversationId: 'c_phoenix',
      title: 'Can you start on 1 November? Phoenixstraat 66', reason: 'Your profile says you can move from 15 October. Whether 1 November works is your call, so the agent drafted a yes for you to check.',
      createdAt: t(2 * HOUR - 60_000), updatedAt: t(2 * HOUR - 60_000),
      payload: { questions: ['Kun je per 1 november huren in plaats van 15 oktober?'], message: 'Heb je huisdieren, en kun je per 1 november huren in plaats van 15 oktober?', draft: 'Beste Lotte,\n\n1 november is voor mij ook goed. Ik kom graag kijken wanneer het u uitkomt.\n\nMet vriendelijke groet,\nSam de Vries' },
    },
    {
      id: 't_scam_zeestraat', kind: 'scam_review', priority: 2, state: 'open', propertyId: 'p_zeestraat71',
      title: 'Possible scam, Zeestraat 71', reason: 'The advert asks to continue on WhatsApp and wants the deposit before a viewing, at 40% below the usual rent for its size in Den Haag. Nothing was sent.',
      createdAt: t(8 * HOUR - 5_000), updatedAt: t(8 * HOUR - 5_000),
      payload: { signals: ['whatsapp_only', 'payment_before_viewing', 'price_far_below_median'] },
    },
    {
      id: 't_reconnect_pararius', kind: 'reconnect', priority: 2, state: 'open', sourceId: 'pararius',
      title: 'Log in to Pararius again', reason: 'The saved Pararius session expired. New Pararius listings are still read, but the agent cannot answer them until you log in once.',
      createdAt: t(70 * MIN), updatedAt: t(70 * MIN),
    },
    {
      id: 't_manual_voorstraat', kind: 'react_manually', priority: 3, state: 'open', propertyId: 'p_voorstraat41', applicationId: 'app_voorstraat41', sourceId: 'kamernet',
      title: 'React yourself on Kamernet, Voorstraat 41', reason: 'Kamernet needs Premium to answer this room and no free copy of it was found on another site. The message is ready to paste.',
      createdAt: t(3 * HOUR - 20_000), updatedAt: t(3 * HOUR - 20_000),
      payload: { url: 'https://kamernet.nl/huren/kamer-delft/voorstraat/kamer-2291044', draft: 'Hoi! Ik ben Sam, 29, promovendus aan de TU Delft. Rustig, kookt graag en is vaak weg in het weekend. Ik zou graag een keer langskomen om kennis te maken. Groet, Sam' },
    },
  ];

  const config = ConfigSchema.parse({
    profile: opts.fresh
      ? {}
      : {
          firstName: 'Sam', lastName: 'de Vries', email: 'sam.zoekt.huis@gmail.com', phone: '06 1234 5678', birthYear: 1997, nationality: 'Dutch',
          occupation: 'phd', organisation: 'TU Delft', incomeMonthlyGrossEur: 2950, languages: ['en', 'nl'], moveInFrom: '2026-10-15', moveInLatest: '2026-12-01', stayMonths: 24,
          about: 'I am a PhD candidate in civil engineering at TU Delft. I cycle everywhere, cook a lot and like a quiet house. I have lived in Delft for four years and always paid rent on time.',
          facts: { 'Reference from previous landlord': 'Yes, from DUWO (2022 to 2026)', 'Bike storage needed': 'Yes, one bike' },
          signature: 'Sam de Vries\n06 1234 5678',
        },
    searches: [
      {
        id: 'main', name: 'Flats in Delft, Rotterdam and Den Haag', enabled: true, priceMaxEur: 1400, sizeMinM2: 25, types: ['studio', 'apartment'],
        regions: [
          { name: 'Delft', municipalities: ['Delft'], postcodes: ['2611-2629'] },
          { name: 'Rotterdam', municipalities: ['Rotterdam'], postcodes: [] },
          { name: 'Den Haag', municipalities: ['Den Haag'], postcodes: [], polygon: [[52.0905, 4.2800], [52.0960, 4.3050], [52.0870, 4.3260], [52.0730, 4.3150], [52.0760, 4.2860]] },
        ],
        dealBreakers: ['anti-kraak', 'alleen vrouwen'], mustHaves: [],
        commute: [{ name: 'TU Delft, Stevinweg 1', lat: 51.9990, lon: 4.3740, mode: 'bike', maxMinutes: 30 }],
        skipAboveLegalMaxPct: 60,
      },
      { id: 'rooms-delft', name: 'Rooms in Delft', enabled: true, priceMaxEur: 750, types: ['room'], regions: [{ name: 'Delft', municipalities: ['Delft'], postcodes: [] }] },
    ],
    registrations: [
      { portal: 'Woonnet Haaglanden', since: '2023-02-01', renewBy: '2026-10-14', url: 'https://www.woonnet-haaglanden.nl' },
      { portal: 'ROOM (DUWO, RoomMatch)', since: '2022-08-20', url: 'https://www.roommatch.nl' },
    ],
    sources: opts.fresh ? {} : {
      funda: { contact: 'auto', termsAcknowledgedAt: new Date(now - 9 * DAY).toISOString() },
      pararius: { contact: 'auto', termsAcknowledgedAt: new Date(now - 9 * DAY).toISOString() },
      vesteda: { enabled: false },
      'woonnet-haaglanden': { searchUrls: ['https://www.woonnet-haaglanden.nl/aanbod/nu-te-huur/?gemeente=Delft'] },
    },
    automation: {
      mode: 'auto', scoreThreshold: 60, dailyCap: 40,
      variants: [
        { id: 'short', instruction: 'Keep it under 90 words. Name, work, income, move-in date, ask for a viewing.', weight: 1 },
        { id: 'personal', instruction: 'Open with one sentence about why this home fits, then the facts.', weight: 1 },
      ],
      templates: {
        first: {
          nl: 'Beste {landlord},\n\nIk zag uw advertentie voor {street} in {city} en ben erg geïnteresseerd. Ik ben {firstName}, {occupation} bij {organisation}, met een vast inkomen. Ik kan per {moveIn} huren.\n\nGraag kom ik langs voor een bezichtiging.\n\nMet vriendelijke groet,\n{firstName} {lastName}',
          en: '',
        },
      },
    },
    mail: { provider: 'imap', address: 'sam.zoekt.huis@gmail.com', user: 'sam.zoekt.huis@gmail.com' },
    notify: { ntfy: { server: 'https://ntfy.sh', topic: 'nlpf-k3v9q2m7xd', actions: true }, desktop: true, quietHours: { start: '23:00', end: '07:30' }, minPriority: 3 },
    ai: { provider: 'claude', monthlyTokenBudget: 5_000_000 },
  }) as ConfigView;
  config.secretsPresent = ['ANTHROPIC_API_KEY', 'NLPF_MAIL_PASSWORD'];

  const documents: DocumentView[] = opts.fresh
    ? []
    : [
        { name: 'tenant-profile.pdf', sensitivity: 'public', kind: 'Tenant profile', size: 48_210, addedAt: new Date(now - 9 * DAY).toISOString() },
        { name: 'loonstrook-2026-09.pdf', sensitivity: 'private', kind: 'Payslip', size: 91_340, addedAt: new Date(now - 2 * DAY).toISOString() },
        { name: 'werkgeversverklaring-tu-delft.pdf', sensitivity: 'private', kind: 'Employer statement', size: 120_880, addedAt: new Date(now - 9 * DAY).toISOString() },
        { name: 'paspoort.pdf', sensitivity: 'identity', kind: 'Passport', size: 702_144, addedAt: new Date(now - 9 * DAY).toISOString() },
      ];

  const sources = SOURCES.map((s, i) => ({
    ...s,
    ...(opts.fresh && s.capabilities?.terms === 'forbids' ? { contactMode: 'watch_only' as const, health: s.enabled ? ('watch_only' as const) : s.health } : {}),
    lastRunAt: s.enabled ? new Date(now - (12 + i * 9) * 1000).toISOString() : undefined,
    lastOkAt: s.enabled && s.health !== 'down' ? new Date(now - (12 + i * 9) * 1000).toISOString() : new Date(now - 40 * MIN).toISOString(),
    nextRunAt: s.enabled ? new Date(now + (30 + i * 11) * 1000).toISOString() : undefined,
    config: config.sources[s.sourceId],
  }));

  const events = buildEvents(now, properties);
  const stats = buildStats(now);

  if (opts.fresh) {
    return { now, properties: [], tasks: [], conversations: [], messages: [], viewings: [], sources, config, documents, events: [], stats: emptyStats(), paused: false, startedAt: new Date(now - 30_000).toISOString() };
  }
  return { now, properties, tasks, conversations, messages, viewings, sources, config, documents, events, stats, paused: false, startedAt: new Date(now - 3 * HOUR - 12 * MIN).toISOString() };
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

function buildEvents(now: number, properties: PropertyView[]): NlpfEvent[] {
  const events: Omit<NlpfEvent, 'id'>[] = [];
  const push = (ago: number, type: NlpfEvent['type'], summary: string, data: Record<string, unknown> = {}) =>
    events.push({ at: new Date(now - ago).toISOString(), type, summary, data });
  for (const view of properties) {
    const p = view.property;
    const seen = now - Date.parse(view.listings[0]!.firstSeenAt);
    if (seen > 14 * HOUR) continue;
    const source = view.listings[0]!.sourceId;
    const line = `${p.address.street} ${p.address.houseNumber}${p.address.addition ?? ''}, ${p.address.city} · €${p.priceEur?.toLocaleString('en-GB')} · ${p.sizeM2} m²`;
    push(seen, 'listing.new', `${nameOf(source)} · ${line}`, { propertyId: p.id, sourceId: source });
    if (view.match?.scam.level === 'likely') push(seen - 3_000, 'property.scam', `Not contacted: ${p.title}, ${view.match.scam.signals.length} scam signals`, { propertyId: p.id });
    else if (view.match && !view.match.passed) push(seen - 2_000, 'property.rejected', `Skipped ${p.title}: ${view.match.failedRule}`, { propertyId: p.id });
    else if (view.match) push(seen - 4_000, 'property.matched', `Matched ${p.title} · score ${view.match.score}`, { propertyId: p.id });
    if (view.application?.reactionMs) push(seen - view.application.reactionMs, 'message.sent', `Sent to ${p.title} by ${view.application.channel?.kind === 'email' ? 'email' : `${nameOf(view.application.channel?.sourceId ?? '')} form`}, ${Math.round(view.application.reactionMs / 1000)} s after it appeared`, { propertyId: p.id, rationale: 'Dutch listing, so Dutch. Led with income and the move-in date.' });
  }
  push(3 * HOUR, 'message.received', 'Reply from Bakker Vastgoed about Nieuwe Binnenweg 215B: viewing times', { propertyId: 'p_binnenweg215b' });
  push(3 * HOUR - 30_000, 'task.created', 'Needs you: pick a viewing time for Nieuwe Binnenweg 215B', { propertyId: 'p_binnenweg215b' });
  push(3 * HOUR, 'message.received', 'Offer from Plas Makelaars for Kralingse Plaslaan 20, with a contract', { propertyId: 'p_plaslaan20' });
  push(2 * HOUR, 'message.received', 'Question from Verra Makelaars about Phoenixstraat 66', { propertyId: 'p_phoenix66' });
  push(2 * HOUR - 70_000, 'message.sent', 'Answered the pets question for Phoenixstraat 66 from your profile', { propertyId: 'p_phoenix66' });
  push(70 * MIN, 'source.health', 'Pararius login expired. Listings are still read', { sourceId: 'pararius', health: 'needs_login' });
  push(50 * MIN, 'message.received', 'Deposit request from J. Vermeer for Piet Heinstraat 88. Not answered', { propertyId: 'p_pietheinstraat88' });
  push(40 * MIN, 'source.health', 'Marktplaats answered 429. Backing off for 8 min', { sourceId: 'marktplaats', health: 'down' });
  push(35 * MIN, 'message.received', 'Rotsvast asks for payslips and a passport for Zwaanshals 88', { propertyId: 'p_zwaanshals88' });
  push(22 * MIN, 'source.health', 'Huurwoningen degraded: 3 empty checks in a row', { sourceId: 'huurwoningen', health: 'degraded' });
  push(20 * HOUR - 50_000, 'viewing.booked', 'Viewing booked for Oude Delft 12A tomorrow at 18:30', { propertyId: 'p_oudedelft12a' });
  push(3 * HOUR + 20 * MIN, 'followup.sent', 'Follow-up sent to Haagsche Makelaardij about Laan van Meerdervoort 123 bis', { propertyId: 'p_meerdervoort123' });
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return events.map((e, i) => ({ ...e, id: i + 1 })).reverse();
}

function nameOf(sourceId: string): string {
  return SOURCES.find((s) => s.sourceId === sourceId)?.name ?? sourceId;
}

function buildStats(now: number): StatsView {
  const daily = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(now - (13 - i) * DAY).toISOString().slice(0, 10);
    const wave = Math.sin(i / 2.2) * 0.35 + 1;
    return {
      date,
      seen: Math.round((170 + (i % 5) * 18) * wave),
      matched: Math.round((28 + (i % 4) * 4) * wave),
      contacted: Math.round((22 + (i % 3) * 3) * wave),
      replies: Math.round((4 + (i % 4)) * wave),
      viewings: i % 3 === 0 ? 2 : i % 2,
    };
  });
  return {
    reactionMsMedian7d: 43_000,
    daily,
    perSource: [
      { sourceId: 'funda', seen7d: 412, matched7d: 71, contacted7d: 64, replies7d: 17, medianReactionMs: 39_000 },
      { sourceId: 'pararius', seen7d: 288, matched7d: 52, contacted7d: 31, replies7d: 9, medianReactionMs: 58_000 },
      { sourceId: 'kamernet', seen7d: 506, matched7d: 38, contacted7d: 0, replies7d: 0, medianReactionMs: null },
      { sourceId: 'ogonline:verra', seen7d: 41, matched7d: 12, contacted7d: 12, replies7d: 6, medianReactionMs: 47_000 },
      { sourceId: 'roommatch', seen7d: 23, matched7d: 5, contacted7d: 5, replies7d: 1, medianReactionMs: 31_000 },
      { sourceId: 'housinganywhere', seen7d: 190, matched7d: 22, contacted7d: 0, replies7d: 0, medianReactionMs: null },
    ],
    perVariant: [
      { variant: 'short', sent: 58, replies: 13, viewings: 4 },
      { variant: 'personal', sent: 54, replies: 19, viewings: 7 },
    ],
    perAgency: [
      { agency: 'Verra Makelaars', contacted: 12, replied: 6, medianReplyHours: 4.5, viewings: 2 },
      { agency: 'Delftse Woningmakelaar', contacted: 9, replied: 5, medianReplyHours: 20, viewings: 3 },
      { agency: 'Rotsvast Rotterdam', contacted: 7, replied: 2, medianReplyHours: 30, viewings: 0 },
      { agency: 'Bakker Vastgoed', contacted: 4, replied: 1, medianReplyHours: 17, viewings: 1 },
      { agency: 'Private landlords', contacted: 19, replied: 3, medianReplyHours: 9, viewings: 1 },
    ],
    freshness: [
      { sourceId: 'funda', medianDetectMs: 96_000 },
      { sourceId: 'kamernet', medianDetectMs: 64_000 },
      { sourceId: 'pararius', medianDetectMs: 210_000 },
      { sourceId: 'ogonline:verra', medianDetectMs: 140_000 },
      { sourceId: 'roommatch', medianDetectMs: 58_000 },
    ],
  };
}

function emptyStats(): StatsView {
  return { reactionMsMedian7d: null, daily: [], perSource: [], perVariant: [], perAgency: [], freshness: [] };
}

export function statusOf(world: World, now: number = Date.now()): StatusView {
  const today = (iso?: string) => Boolean(iso) && new Date(iso!).toDateString() === new Date(now).toDateString();
  return {
    version: '0.1.0',
    startedAt: world.startedAt,
    paused: world.paused,
    dryRun: world.config.automation.dryRun,
    demo: false,
    sources: world.sources.map(({ homepage: _h, capabilities: _c, intervalSec: _i, contactMode: _m, config: _cfg, termsNote: _t, ...state }) => state),
    mail: { connected: world.config.mail.provider !== 'none', address: world.config.mail.address || undefined, lastIdleAt: new Date(now - 25_000).toISOString() },
    ai: { provider: world.config.ai.provider, usageThisMonth: { inputTokens: 412_300, outputTokens: 61_870, cacheReadTokens: 1_254_000, calls: 318 }, budget: world.config.ai.monthlyTokenBudget },
    counts: {
      openTasks: world.tasks.filter((t) => t.state === 'open').length,
      seenToday: world.properties.length ? 186 + world.properties.filter((p) => today(p.listings[0]?.firstSeenAt)).length : 0,
      matchedToday: world.properties.length ? 31 : 0,
      contactedToday: world.properties.length ? 24 : 0,
      repliesToday: world.properties.length ? 6 : 0,
      viewingsUpcoming: world.viewings.filter((v) => v.state === 'booked' && Date.parse(v.startsAt) > now).length,
    },
    nextPollAt: new Date(now + 42_000 - (now % 60_000) / 2).toISOString(),
  };
}

export function applicationsOf(world: World): ApplicationView[] {
  return world.properties
    .filter((p) => p.application)
    .map((p) => {
      const conversationId = p.conversationIds[0] ?? null;
      const conversation = world.conversations.find((c) => c.id === conversationId);
      const last = world.messages.filter((m) => m.conversationId === conversationId).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      const contacted = p.application?.contactedAt ? Date.parse(p.application.contactedAt) : null;
      const waiting = p.application?.status === 'contacted' && contacted && last?.direction === 'out';
      return {
        application: p.application!,
        property: p.property,
        conversationId,
        counterpart: conversation?.counterpart ?? null,
        lastMessage: last ? { direction: last.direction, author: last.author, body: last.body, at: last.at } : null,
        nextFollowUpAt: waiting && contacted ? new Date(contacted + 3 * DAY).toISOString() : null,
      };
    });
}

/** Streets for the listings the mock server "finds" while it runs. */
export const LIVE_POOL: { street: string; number: string; postcode: string; city: string; price: number; size: number; type: Property['type']; source: string }[] = [
  { street: 'Koornmarkt', number: '58', postcode: '2611 EG', city: 'Delft', price: 1240, size: 46, type: 'apartment', source: 'funda' },
  { street: 'Mauritsweg', number: '31', postcode: '3012 JT', city: 'Rotterdam', price: 1150, size: 41, type: 'apartment', source: 'pararius' },
  { street: 'Weimarstraat', number: '204', postcode: '2562 HD', city: 'Den Haag', price: 995, size: 34, type: 'studio', source: 'funda' },
  { street: 'Oosterstraat', number: '9', postcode: '2611 TT', city: 'Delft', price: 710, size: 19, type: 'room', source: 'kamernet' },
  { street: 'Goudsesingel', number: '140', postcode: '3011 KD', city: 'Rotterdam', price: 1375, size: 58, type: 'apartment', source: 'funda' },
  { street: 'Frederik Hendrikplein', number: '12', postcode: '2582 AT', city: 'Den Haag', price: 1320, size: 49, type: 'apartment', source: 'ogonline:verra' },
  { street: 'Brabantse Turfmarkt', number: '77', postcode: '2611 CN', city: 'Delft', price: 1080, size: 36, type: 'studio', source: 'roommatch' },
  { street: 'Schiedamse Vest', number: '101', postcode: '3012 BH', city: 'Rotterdam', price: 1290, size: 52, type: 'apartment', source: 'funda' },
];

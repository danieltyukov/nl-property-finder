import type { AutomationConfig, ScamVerdict } from '@nlpf/core';
import { squash } from './text.js';

export interface DocumentFile {
  name: string;
  path: string;
  sensitivity: 'public' | 'private' | 'identity';
  kind: string;
}

/** Canonical document kinds and the Dutch and English words landlords use for them. */
export const DOCUMENT_KINDS: Record<string, string[]> = {
  id: [
    'identiteitsbewijs',
    'paspoort',
    'passport',
    'idkaart',
    'idcard',
    'identitycard',
    'identiteitskaart',
    'rijbewijs',
    'drivinglicence',
    'driverslicense',
    'legitimatie',
    'kopieid',
    'copyofid',
    'identity',
  ],
  payslip: [
    'loonstrook',
    'loonstroken',
    'salarisstrook',
    'salarisstroken',
    'payslip',
    'salaryslip',
    'paystub',
    'inkomensverklaring',
    'jaaropgave',
    'ib60',
    'proofofincome',
    'inkomen',
    'income',
  ],
  employer_statement: [
    'werkgeversverklaring',
    'employerstatement',
    'employersdeclaration',
    'arbeidscontract',
    'arbeidsovereenkomst',
    'employmentcontract',
    'contractofemployment',
  ],
  enrolment: [
    'inschrijfbewijs',
    'bewijsvaninschrijving',
    'inschrijvingsbewijs',
    'collegekaart',
    'studentenkaart',
    'studentcard',
    'enrolment',
    'enrollment',
    'proofofenrolment',
    'studiebewijs',
  ],
  bank_statement: ['bankafschrift', 'bankafschriften', 'rekeningafschrift', 'bankstatement', 'saldo'],
  landlord_reference: [
    'verhuurdersverklaring',
    'huurdersverklaring',
    'landlordreference',
    'referentie',
    'reference',
  ],
  guarantor: ['garantstelling', 'borgstelling', 'borgsteller', 'guarantor', 'guarantee'],
  tenant_profile: [
    'huurdersprofiel',
    'profiel',
    'profile',
    'motivatie',
    'motivation',
    'introductie',
    'introduction',
    'cv',
  ],
};

const GENERIC = [
  'documenten',
  'documents',
  'stukken',
  'papieren',
  'papers',
  'gegevens',
  'dossier',
  'huurdossier',
];

function kindsRequested(requested: string[]): { kinds: Set<string>; generic: boolean } {
  const kinds = new Set<string>();
  let generic = requested.length === 0;
  for (const r of requested) {
    const q = squash(r);
    let hit = false;
    for (const [kind, words] of Object.entries(DOCUMENT_KINDS)) {
      if (q === squash(kind) || words.some((w) => q.includes(w))) {
        kinds.add(kind);
        hit = true;
      }
    }
    if (!hit && GENERIC.some((g) => q.includes(g))) generic = true;
  }
  return { kinds, generic };
}

function fileKind(f: DocumentFile): string | undefined {
  const k = squash(f.kind);
  const byKind = Object.keys(DOCUMENT_KINDS).find((kind) => squash(kind) === k);
  if (byKind) return byKind;
  const name = squash(f.name);
  return Object.entries(DOCUMENT_KINDS).find(([, words]) => words.some((w) => name.includes(w)))?.[0];
}

/**
 * Splits the requested documents into those the agent may send now and
 * those that need approval (spec, Agent pipeline step 11). Identity
 * documents always need approval, whatever the config says. Private
 * documents go out automatically only after a viewing is booked and only
 * when the conversation shows no scam signal. Public documents (the tenant
 * profile) go out unless a scam is likely. A general request ("uw
 * documenten") means the public documents only.
 */
export function documentsToSend(
  requested: string[],
  policy: AutomationConfig['documents'],
  ctx: { viewingBooked: boolean; scam: ScamVerdict; files: DocumentFile[] },
): { send: DocumentFile[]; approve: DocumentFile[] } {
  const { kinds, generic } = kindsRequested(requested);
  const chosen = ctx.files.filter((f) => {
    const k = fileKind(f);
    return (k !== undefined && kinds.has(k)) || (generic && f.sensitivity === 'public');
  });
  const send: DocumentFile[] = [];
  const approve: DocumentFile[] = [];
  for (const f of chosen) {
    if (f.sensitivity === 'identity') approve.push(f);
    else if (f.sensitivity === 'private') {
      const ok = policy.private === 'after_viewing_booked' && ctx.viewingBooked && ctx.scam.level === 'none';
      (ok ? send : approve).push(f);
    } else {
      const ok = policy.public === 'auto' && ctx.scam.level !== 'likely';
      (ok ? send : approve).push(f);
    }
  }
  return { send, approve };
}

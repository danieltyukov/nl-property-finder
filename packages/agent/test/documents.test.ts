import { describe, expect, test } from 'vitest';
import { AutomationSchema, type ScamVerdict } from '@nlpf/core';
import { documentsToSend, type DocumentFile } from '../src/documents.js';

const policy = AutomationSchema.parse({}).documents; // public auto, private after viewing, identity approve
const none: ScamVerdict = { level: 'none', signals: [] };
const possible: ScamVerdict = { level: 'possible', signals: ['whatsapp_only'] };

const files: DocumentFile[] = [
  { name: 'Tenant profile.pdf', path: '/d/profile.pdf', sensitivity: 'public', kind: 'tenant_profile' },
  { name: 'Loonstrook augustus.pdf', path: '/d/payslip.pdf', sensitivity: 'private', kind: 'payslip' },
  { name: 'Werkgeversverklaring.pdf', path: '/d/employer.pdf', sensitivity: 'private', kind: 'employer_statement' },
  { name: 'Paspoort.pdf', path: '/d/passport.pdf', sensitivity: 'identity', kind: 'id' },
];
const names = (fs: DocumentFile[]) => fs.map((f) => f.kind);

describe('documentsToSend', () => {
  test('identity documents always need approval', () => {
    for (const viewingBooked of [false, true]) {
      const out = documentsToSend(['kopie paspoort'], policy, { viewingBooked, scam: none, files });
      expect(names(out.approve)).toEqual(['id']);
      expect(out.send).toEqual([]);
    }
    const permissive = { public: 'auto', private: 'after_viewing_booked', identity: 'auto' } as unknown as typeof policy;
    expect(names(documentsToSend(['passport'], permissive, { viewingBooked: true, scam: none, files }).approve)).toEqual(['id']);
  });

  test('private documents go out only after a viewing is booked and with no scam signals', () => {
    const requested = ['loonstroken', 'werkgeversverklaring'];
    expect(names(documentsToSend(requested, policy, { viewingBooked: true, scam: none, files }).send)).toEqual(['payslip', 'employer_statement']);
    expect(names(documentsToSend(requested, policy, { viewingBooked: false, scam: none, files }).approve)).toEqual(['payslip', 'employer_statement']);
    expect(names(documentsToSend(requested, policy, { viewingBooked: true, scam: possible, files }).approve)).toEqual(['payslip', 'employer_statement']);
    const strict = { ...policy, private: 'approve' as const };
    expect(documentsToSend(requested, strict, { viewingBooked: true, scam: none, files }).send).toEqual([]);
  });

  test('public documents go out automatically unless a scam is likely or the policy says approve', () => {
    expect(names(documentsToSend(['huurdersprofiel'], policy, { viewingBooked: false, scam: none, files }).send)).toEqual(['tenant_profile']);
    expect(names(documentsToSend(['profile'], policy, { viewingBooked: false, scam: { level: 'likely', signals: [] }, files }).approve)).toEqual(['tenant_profile']);
    expect(names(documentsToSend(['profile'], { ...policy, public: 'approve' }, { viewingBooked: false, scam: none, files }).approve)).toEqual(['tenant_profile']);
  });

  test('a general request sends the public documents only', () => {
    expect(documentsToSend(['documenten'], policy, { viewingBooked: true, scam: none, files })).toEqual({ send: [files[0]], approve: [] });
    expect(documentsToSend([], policy, { viewingBooked: true, scam: none, files })).toEqual({ send: [files[0]], approve: [] });
  });

  test('English names and missing documents', () => {
    const out = documentsToSend(['payslips', 'proof of enrolment'], policy, { viewingBooked: true, scam: none, files });
    expect(names(out.send)).toEqual(['payslip']);
    expect(out.approve).toEqual([]);
  });
});

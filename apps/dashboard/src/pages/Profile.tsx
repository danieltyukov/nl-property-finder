/*
 * Profile and documents. The profile is what the agent writes and answers
 * from; it never invents anything that is not here. Documents stay on this
 * computer with a sensitivity level that decides when they may be sent.
 */
import { useRef, useState } from 'react';
import type { Profile } from '@nlpf/core';
import { useApi } from '../api/client';
import { useConfig, useDocumentMutations, useDocuments, usePatchConfig } from '../api/hooks';
import type { ConfigView, DocumentView } from '../api/views';
import { useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { Button, Card, Field, IconButton, Loading, PageHeader, Pill, Toggle } from '../components/ui';
import { ago, bytes } from '../lib/format';
import { OCCUPATION } from '../lib/labels';

const SENSITIVITY: Record<DocumentView['sensitivity'], { label: string; tone: 'found' | 'needs-you' | 'error'; rule: string }> = {
  public: { label: 'Public', tone: 'found', rule: 'Sent when asked' },
  private: { label: 'Private', tone: 'needs-you', rule: 'Sent after a viewing is booked' },
  identity: { label: 'Identity', tone: 'error', rule: 'Always asks you, sent watermarked' },
};

const num = (v: string) => (v.trim() === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);

export function ProfilePage() {
  const config = useConfig();
  if (!config.data) return <div className="page"><Loading label="Loading your profile" /></div>;
  return <ProfileEditor config={config.data} />;
}

export function ProfileFields({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => onChange({ ...profile, [key]: value });
  return (
    <div className="form-grid">
      <Field label="First name">{(id) => <input id={id} className="input" autoComplete="given-name" value={profile.firstName} onChange={(e) => set('firstName', e.currentTarget.value)} />}</Field>
      <Field label="Last name">{(id) => <input id={id} className="input" autoComplete="family-name" value={profile.lastName} onChange={(e) => set('lastName', e.currentTarget.value)} />}</Field>
      <Field label="Salutation" hint="Many Dutch agency forms ask for one.">
        {(id, hint) => (
          <select id={id} className="input" aria-describedby={hint} value={profile.salutation ?? ''} onChange={(e) => set('salutation', (e.currentTarget.value || undefined) as Profile['salutation'])}>
            <option value="">Not set</option>
            <option value="dhr">Dhr. (Mr)</option>
            <option value="mevr">Mevr. (Ms)</option>
            <option value="none">Neither</option>
          </select>
        )}
      </Field>
      <Field label="Email address" hint="The dedicated mailbox the agent reads and writes from.">
        {(id, hint) => <input id={id} className="input" type="email" aria-describedby={hint} value={profile.email} onChange={(e) => set('email', e.currentTarget.value)} />}
      </Field>
      <Field label="Phone">{(id) => <input id={id} className="input" type="tel" autoComplete="tel" value={profile.phone ?? ''} onChange={(e) => set('phone', e.currentTarget.value || undefined)} />}</Field>
      <Field label="Birth year">{(id) => <input id={id} className="input mono" inputMode="numeric" value={profile.birthYear ?? ''} onChange={(e) => set('birthYear', num(e.currentTarget.value))} />}</Field>
      <Field label="Nationality">{(id) => <input id={id} className="input" value={profile.nationality ?? ''} onChange={(e) => set('nationality', e.currentTarget.value || undefined)} />}</Field>
      <Field label="Occupation">
        {(id) => (
          <select id={id} className="input" value={profile.occupation} onChange={(e) => set('occupation', e.currentTarget.value as Profile['occupation'])}>
            {Object.entries(OCCUPATION).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="University or employer">{(id) => <input id={id} className="input" value={profile.organisation ?? ''} onChange={(e) => set('organisation', e.currentTarget.value || undefined)} />}</Field>
      {profile.occupation === 'student' && (
        <>
          <Field label="Employer, if you also work" hint="Where a listing turns students away, the agent applies as a working tenant.">
            {(id, hint) => <input id={id} className="input" aria-describedby={hint} value={profile.job?.employer ?? ''} onChange={(e) => { const employer = e.currentTarget.value; set('job', employer ? { ...profile.job, employer } : undefined); }} />}
          </Field>
          <Field label="Job title">
            {(id) => <input id={id} className="input" disabled={!profile.job} value={profile.job?.role ?? ''} onChange={(e) => { const role = e.currentTarget.value; set('job', profile.job ? { ...profile.job, role: role || undefined } : undefined); }} />}
          </Field>
        </>
      )}
      <Field label="Gross monthly income (EUR)" hint="Used to check income requirements, and mentioned in first messages so landlords see you qualify.">
        {(id, hint) => <input id={id} className="input mono" inputMode="numeric" aria-describedby={hint} value={profile.incomeMonthlyGrossEur ?? ''} onChange={(e) => set('incomeMonthlyGrossEur', num(e.currentTarget.value))} />}
      </Field>
      <Field label="Move in from">{(id) => <input id={id} className="input mono" type="date" value={profile.moveInFrom ?? ''} onChange={(e) => set('moveInFrom', e.currentTarget.value || undefined)} />}</Field>
      <Field label="Move in at the latest">{(id) => <input id={id} className="input mono" type="date" value={profile.moveInLatest ?? ''} onChange={(e) => set('moveInLatest', e.currentTarget.value || undefined)} />}</Field>
      <Field label="Stay (months)">{(id) => <input id={id} className="input mono" inputMode="numeric" value={profile.stayMonths ?? ''} onChange={(e) => set('stayMonths', num(e.currentTarget.value))} />}</Field>
    </div>
  );
}

function ProfileEditor({ config }: { config: ConfigView }) {
  const patch = usePatchConfig();
  const { toast } = useFeedback();
  const [profile, setProfile] = useState<Profile>(() => structuredClone(config.profile));
  const dirty = JSON.stringify(profile) !== JSON.stringify(config.profile);
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setProfile((p) => ({ ...p, [key]: value }));
  const facts = Object.entries(profile.facts);

  const save = () =>
    patch.mutate({ section: 'profile', value: profile }, { onSuccess: () => toast('Profile saved.'), onError: (e) => toast(`Not saved: ${e.message}`, 'error') });

  return (
    <div className="page">
      <PageHeader eyebrow="Profile" title="Who the agent writes as." lede="Messages and answers come from this page. Anything a landlord asks that is not here comes to your inbox instead of being guessed." />
      <div className="profile-grid">
        <div className="stack">
          <Card label="About you">
            <ProfileFields profile={profile} onChange={setProfile} />
          </Card>
          <Card label="Household">
            <div className="form-grid three">
              <Field label="Adults">{(id) => <input id={id} className="input mono" inputMode="numeric" value={profile.household.adults} onChange={(e) => set('household', { ...profile.household, adults: num(e.currentTarget.value) ?? 1 })} />}</Field>
              <Field label="Children">{(id) => <input id={id} className="input mono" inputMode="numeric" value={profile.household.children} onChange={(e) => set('household', { ...profile.household, children: num(e.currentTarget.value) ?? 0 })} />}</Field>
            </div>
            <Toggle label="Pets" checked={profile.household.pets} onChange={(v) => set('household', { ...profile.household, pets: v })} />
            <Toggle label="Smoker" checked={profile.smoker} onChange={(v) => set('smoker', v)} />
            <h3 className="label sub">Guarantor</h3>
            <div className="form-grid three">
              <Field label="Relation">{(id) => <input id={id} className="input" placeholder="Parent" value={profile.guarantor?.relation ?? ''} onChange={(e) => { const v = e.currentTarget.value; set('guarantor', v ? { ...(profile.guarantor ?? {}), relation: v } : undefined); }} />}</Field>
              <Field label="Their monthly income (EUR)">{(id) => <input id={id} className="input mono" inputMode="numeric" value={profile.guarantor?.incomeMonthlyGrossEur ?? ''} disabled={!profile.guarantor} onChange={(e) => profile.guarantor && set('guarantor', { ...profile.guarantor, incomeMonthlyGrossEur: num(e.currentTarget.value) })} />}</Field>
              <Field label="Country">{(id) => <input id={id} className="input" value={profile.guarantor?.country ?? ''} disabled={!profile.guarantor} onChange={(e) => profile.guarantor && set('guarantor', { ...profile.guarantor, country: e.currentTarget.value || undefined })} />}</Field>
            </div>
            <h3 className="label sub">Co-applicants</h3>
            {profile.coApplicants.map((c, i) => (
              <div className="form-grid three row-with-remove" key={i}>
                <Field label="Name">{(id) => <input id={id} className="input" value={c.name} onChange={(e) => { const v = e.currentTarget.value; set('coApplicants', profile.coApplicants.map((x, j) => (j === i ? { ...x, name: v } : x))); }} />}</Field>
                <Field label="Relation">{(id) => <input id={id} className="input" value={c.relation} onChange={(e) => { const v = e.currentTarget.value; set('coApplicants', profile.coApplicants.map((x, j) => (j === i ? { ...x, relation: v } : x))); }} />}</Field>
                <Field label="Monthly income (EUR)">{(id) => <input id={id} className="input mono" inputMode="numeric" value={c.incomeMonthlyGrossEur ?? ''} onChange={(e) => { const v = num(e.currentTarget.value); set('coApplicants', profile.coApplicants.map((x, j) => (j === i ? { ...x, incomeMonthlyGrossEur: v } : x))); }} />}</Field>
                <IconButton icon="trash" label={`Remove ${c.name || 'co-applicant'}`} onClick={() => set('coApplicants', profile.coApplicants.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button size="sm" icon="plus" onClick={() => set('coApplicants', [...profile.coApplicants, { name: '', relation: 'partner' }])}>
              Add a co-applicant
            </Button>
            <p className="field-hint">Co-applicants' incomes count in income checks, and messages mention them.</p>
          </Card>
          <Card label="How you write">
            <div className="form-grid">
              <Field label="Languages you speak" hint="Comma separated, for example en, nl">
                {(id, hint) => <input id={id} className="input mono" aria-describedby={hint} defaultValue={profile.languages.join(', ')} onBlur={(e) => set('languages', e.currentTarget.value.split(',').map((x) => x.trim()).filter(Boolean))} />}
              </Field>
              <Field label="Message language">
                {(id) => (
                  <select id={id} className="input" value={profile.messageLanguage} onChange={(e) => set('messageLanguage', e.currentTarget.value as Profile['messageLanguage'])}>
                    <option value="auto">Same as the listing</option>
                    <option value="nl">Always Dutch</option>
                    <option value="en">Always English</option>
                  </select>
                )}
              </Field>
              <Field label="About you, in your words" hint="A few sentences the agent can draw on. It will not add anything you did not write." wide>
                {(id, hint) => <textarea id={id} className="input" rows={5} aria-describedby={hint} value={profile.about} onChange={(e) => set('about', e.currentTarget.value)} />}
              </Field>
              <Field label="Signature" wide>
                {(id) => <textarea id={id} className="input mono-area" rows={3} value={profile.signature ?? ''} onChange={(e) => set('signature', e.currentTarget.value || undefined)} />}
              </Field>
            </div>
            <h3 className="label sub">Answers the agent may give</h3>
            <p className="field-hint">Questions landlords ask often, with your answer. The agent uses these word for word.</p>
            {facts.map(([q, a], i) => (
              <div className="form-grid row-with-remove" key={i}>
                <Field label="Question">
                  {(id) => (
                    <input id={id} className="input" value={q} onChange={(e) => { const v = e.currentTarget.value; set('facts', Object.fromEntries(facts.map(([k, val], j) => (j === i ? [v, val] : [k, val])))); }} />
                  )}
                </Field>
                <Field label="Answer">
                  {(id) => (
                    <input id={id} className="input" value={a} onChange={(e) => { const v = e.currentTarget.value; set('facts', Object.fromEntries(facts.map(([k, val], j) => (j === i ? [k, v] : [k, val])))); }} />
                  )}
                </Field>
                <IconButton icon="trash" label="Remove this answer" onClick={() => set('facts', Object.fromEntries(facts.filter((_, j) => j !== i)))} />
              </div>
            ))}
            <Button size="sm" icon="plus" onClick={() => set('facts', { ...profile.facts, [`Question ${facts.length + 1}`]: '' })}>
              Add an answer
            </Button>
          </Card>
        </div>
        <div className="stack">
          <Documents />
        </div>
      </div>
      <div className={`savebar${dirty ? ' show' : ''}`} role="region" aria-label="Unsaved changes" hidden={!dirty}>
        <p>You have unsaved changes to your profile.</p>
        <Button variant="ghost" onClick={() => setProfile(structuredClone(config.profile))}>
          Discard
        </Button>
        <Button variant="primary" onClick={save} disabled={patch.isPending}>
          Save profile
        </Button>
      </div>
    </div>
  );
}

function Documents() {
  const api = useApi();
  const documents = useDocuments();
  const m = useDocumentMutations();
  const { toast } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sensitivity, setSensitivity] = useState<DocumentView['sensitivity']>('private');
  const [kind, setKind] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const preview = async () => {
    setPdfBusy(true);
    // The PDF route needs the token header, so it is fetched and opened as a blob rather than linked.
    const tab = window.open('', '_blank');
    try {
      const blob = await api.tenantProfilePdf();
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      toast(`Could not make the PDF: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <Card label="Tenant profile PDF">
        <p className="card-intro">A one-page summary of you as a tenant, generated from this profile. It counts as a public document, so the agent may send it when asked.</p>
        <Button icon="file" onClick={() => void preview()} disabled={pdfBusy}>
          Preview tenant profile PDF
        </Button>
      </Card>
      <Card label="Documents" count={documents.data?.length || undefined}>
        {documents.isLoading ? <Loading label="Loading documents" /> : null}
        <ul className="doc-list">
          {(documents.data ?? []).map((d) => {
            const s = SENSITIVITY[d.sensitivity];
            return (
              <li key={d.name} className="doc-row">
                <Icon name="file" />
                <span className="doc-name">
                  <span className="mono">{d.name}</span>
                  <span className="cell-sub">
                    {[d.kind, bytes(d.size), d.addedAt ? `added ${ago(d.addedAt)}` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="doc-rule">
                  <Pill tone={s.tone}>{s.label}</Pill>
                  <span className="cell-sub">{s.rule}</span>
                </span>
                <IconButton
                  icon="trash"
                  label={`Delete ${d.name}`}
                  onClick={() => m.remove.mutate(d.name, { onSuccess: () => toast(`${d.name} deleted.`), onError: (e) => toast(e.message, 'error') })}
                />
              </li>
            );
          })}
          {documents.data && documents.data.length === 0 ? <li className="card-empty">No documents yet. Add payslips, an employer statement or a passport copy below.</li> : null}
        </ul>
        <form
          className="upload"
          onSubmit={(e) => {
            e.preventDefault();
            const file = fileRef.current?.files?.[0];
            if (!file) {
              toast('Pick a file first.', 'error');
              return;
            }
            const form = new FormData();
            form.append('file', file);
            form.append('sensitivity', sensitivity);
            form.append('kind', kind.trim() || file.name.replace(/\.[^.]+$/, ''));
            m.upload.mutate(form, {
              onSuccess: () => {
                toast(`${file.name} added as ${SENSITIVITY[sensitivity].label.toLowerCase()}.`);
                if (fileRef.current) fileRef.current.value = '';
                setKind('');
              },
              onError: (err) => toast(`Upload failed: ${err.message}`, 'error'),
            });
          }}
        >
          <div className="form-grid">
            <Field label="Document" wide>
              {(id) => <input id={id} ref={fileRef} className="input file-input" type="file" accept=".pdf,.png,.jpg,.jpeg" />}
            </Field>
            <Field label="Sensitivity" hint={SENSITIVITY[sensitivity].rule}>
              {(id, hint) => (
                <select id={id} className="input" aria-describedby={hint} value={sensitivity} onChange={(e) => setSensitivity(e.currentTarget.value as DocumentView['sensitivity'])}>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="identity">Identity</option>
                </select>
              )}
            </Field>
            <Field label="What it is">{(id) => <input id={id} className="input" placeholder="Payslip" value={kind} onChange={(e) => setKind(e.currentTarget.value)} />}</Field>
          </div>
          <Button type="submit" icon="upload" disabled={m.upload.isPending}>
            Upload
          </Button>
        </form>
        <p className="field-hint">Files stay in the data folder on this computer. Identity documents are only ever sent after you approve, with a watermark naming the recipient, the address and the date.</p>
      </Card>
    </>
  );
}

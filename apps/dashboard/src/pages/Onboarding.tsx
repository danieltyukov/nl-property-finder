/*
 * First run: profile, search, mail, notifications, sources, review. Each step
 * saves its own config section when you continue, so closing the tab halfway
 * loses nothing. The sources step is where automatic contact on platforms
 * whose terms forbid it is switched on, one platform at a time, with the risk
 * stated; opting in records the date.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Config, NamedSearch, Profile, SourceConfig } from '@nlpf/core';
import { useApi } from '../api/client';
import { useConfig, usePatchConfig, useSources } from '../api/hooks';
import type { ConfigView, SourceView } from '../api/views';
import { NamedSearchSchema } from '../core';
import { useFeedback } from '../components/Feedback';
import { Mark } from '../components/Mark';
import { Button, Chip, Field, Loading, Tag, Toggle } from '../components/ui';
import { eur, ymd } from '../lib/format';
import { OCCUPATION, PROPERTY_TYPE } from '../lib/labels';
import { suggestTopic } from '../lib/access';
import { termsRisk } from '../lib/sources';

const STEPS = ['Profile', 'Search', 'Mail', 'Notifications', 'Sources', 'Review'] as const;
type Step = (typeof STEPS)[number];

const CITIES = ['Delft', 'Rotterdam', 'Den Haag', 'Leiden', 'Rijswijk', 'Schiedam', 'Zoetermeer', 'Utrecht', 'Amsterdam', 'Haarlem', 'Eindhoven', 'Groningen'];
const TYPES = ['room', 'studio', 'apartment', 'house'] as const;

export function OnboardingPage({ onFinish }: { onFinish: () => void }) {
  const config = useConfig();
  const sources = useSources();
  if (!config.data) {
    return (
      <div className="splash">
        <Loading label="Loading" />
      </div>
    );
  }
  return <Wizard config={config.data} sources={sources.data ?? []} onFinish={onFinish} />;
}

function Wizard({ config, sources, onFinish }: { config: ConfigView; sources: SourceView[]; onFinish: () => void }) {
  const patch = usePatchConfig();
  const api = useApi();
  const { toast } = useFeedback();
  const [step, setStep] = useState<Step>('Profile');
  const [profile, setProfile] = useState<Profile>(() => structuredClone(config.profile));
  const baseSearch = config.searches[0] ?? (NamedSearchSchema.parse({ id: 'main', name: 'Main search' }) as NamedSearch);
  const [cities, setCities] = useState<string[]>(() => baseSearch.regions.flatMap((r) => (r.municipalities.length ? r.municipalities : [r.name])));
  const [other, setOther] = useState('');
  const [maxRent, setMaxRent] = useState(baseSearch.priceMaxEur ? String(baseSearch.priceMaxEur) : '');
  const [minSize, setMinSize] = useState(baseSearch.sizeMinM2 ? String(baseSearch.sizeMinM2) : '');
  const [types, setTypes] = useState<NamedSearch['types']>(baseSearch.types);
  const [mail, setMail] = useState<Config['mail']>(() => structuredClone(config.mail));
  const [notify, setNotify] = useState<Config['notify']>(() => structuredClone(config.notify));
  const [sourceCfg, setSourceCfg] = useState<Record<string, SourceConfig>>(() => structuredClone(config.sources));
  const [dryRun, setDryRun] = useState(config.automation.dryRun);
  const [error, setError] = useState<string | null>(null);
  const index = STEPS.indexOf(step);

  useEffect(() => {
    document.getElementById('wizard-title')?.focus();
    setError(null);
  }, [step]);

  const allCities = useMemo(() => [...new Set([...CITIES, ...cities])], [cities]);

  const save = async (section: keyof Config, value: unknown) => {
    await patch.mutateAsync({ section, value });
  };

  const next = async () => {
    setError(null);
    try {
      if (step === 'Profile') {
        if (!profile.firstName.trim()) {
          setError('The agent needs at least your first name to sign messages.');
          return;
        }
        await save('profile', { ...profile, firstName: profile.firstName.trim(), lastName: profile.lastName.trim() });
      } else if (step === 'Search') {
        const picked = [...cities, ...other.split(',').map((c) => c.trim()).filter(Boolean)];
        if (!picked.length) {
          setError('Pick at least one city or region.');
          return;
        }
        const main: NamedSearch = {
          ...baseSearch,
          regions: [...new Set(picked)].map((name) => {
            const existing = baseSearch.regions.find((r) => r.name === name);
            return existing ?? { name, municipalities: [name], postcodes: [] };
          }),
          priceMaxEur: maxRent ? Number(maxRent) : undefined,
          sizeMinM2: minSize ? Number(minSize) : undefined,
          types: types.length ? types : baseSearch.types,
        };
        await save('searches', [main, ...config.searches.slice(1)]);
        setCities([...new Set(picked)]);
        setOther('');
      } else if (step === 'Mail') {
        await save('mail', mail);
      } else if (step === 'Notifications') {
        await save('notify', notify);
      } else if (step === 'Sources') {
        await save('sources', sourceCfg);
      } else if (step === 'Review') {
        if (dryRun !== config.automation.dryRun) await save('automation', { ...config.automation, dryRun });
        onFinish();
        return;
      }
      setStep(STEPS[index + 1]!);
    } catch (e) {
      setError(`That step was not saved: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  const forbids = sources.filter((s) => s.capabilities?.terms === 'forbids');
  const others = sources.filter((s) => s.capabilities?.terms !== 'forbids');

  return (
    <div className="onboarding">
      <aside className="wizard-rail" aria-label="Setup steps">
        <p className="brand">
          <Mark size={22} light="running" />
          <span className="brand-name">nl-property-finder</span>
        </p>
        <ol className="wizard-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === index ? 'current' : i < index ? 'done' : ''} aria-current={i === index ? 'step' : undefined}>
              <span className="wizard-num">{String(i + 1).padStart(2, '0')}</span>
              {s}
            </li>
          ))}
        </ol>
        <p className="wizard-note">Everything stays on this computer. You can change any of it later in Settings.</p>
      </aside>
      <main className="wizard-main" id="main">
        <div className="wizard-progress" aria-hidden="true">
          <span style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
        </div>
        <form
          className="wizard-card"
          onSubmit={(e) => {
            e.preventDefault();
            void next();
          }}
        >
          <Chip>{`Step ${index + 1} of ${STEPS.length}`}</Chip>
          {step === 'Profile' ? (
            <>
              <h1 className="wizard-title" id="wizard-title" tabIndex={-1}>
                Who is looking?
              </h1>
              <p className="wizard-lede">The agent writes to landlords as you, using only what you put here.</p>
              <div className="form-grid">
                <Field label="First name">{(id) => <input id={id} className="input" autoComplete="given-name" required value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.currentTarget.value })} />}</Field>
                <Field label="Last name">{(id) => <input id={id} className="input" autoComplete="family-name" value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.currentTarget.value })} />}</Field>
                <Field label="Email address" hint="A mailbox used only for the search. Landlords reply here.">
                  {(id, hint) => <input id={id} className="input" type="email" aria-describedby={hint} value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.currentTarget.value })} />}
                </Field>
                <Field label="Phone">{(id) => <input id={id} className="input" type="tel" value={profile.phone ?? ''} onChange={(e) => setProfile({ ...profile, phone: e.currentTarget.value || undefined })} />}</Field>
                <Field label="Occupation">
                  {(id) => (
                    <select id={id} className="input" value={profile.occupation} onChange={(e) => setProfile({ ...profile, occupation: e.currentTarget.value as Profile['occupation'] })}>
                      {Object.entries(OCCUPATION).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="University or employer">{(id) => <input id={id} className="input" value={profile.organisation ?? ''} onChange={(e) => setProfile({ ...profile, organisation: e.currentTarget.value || undefined })} />}</Field>
                <Field label="Gross monthly income (EUR)">
                  {(id) => <input id={id} className="input mono" inputMode="numeric" value={profile.incomeMonthlyGrossEur ?? ''} onChange={(e) => setProfile({ ...profile, incomeMonthlyGrossEur: e.currentTarget.value ? Number(e.currentTarget.value) : undefined })} />}
                </Field>
                <Field label="Move in from">{(id) => <input id={id} className="input mono" type="date" value={profile.moveInFrom ?? ''} onChange={(e) => setProfile({ ...profile, moveInFrom: e.currentTarget.value || undefined })} />}</Field>
                <Field label="About you, in your words" hint="Optional. Two or three sentences the agent may use." wide>
                  {(id, hint) => <textarea id={id} className="input" rows={3} aria-describedby={hint} value={profile.about} onChange={(e) => setProfile({ ...profile, about: e.currentTarget.value })} />}
                </Field>
              </div>
            </>
          ) : null}

          {step === 'Search' ? (
            <>
              <h1 className="wizard-title" id="wizard-title" tabIndex={-1}>
                Where, and for how much?
              </h1>
              <p className="wizard-lede">Pick the places to search. You can draw exact areas on a map later, under Search.</p>
              <fieldset className="chip-set">
                <legend className="field-label">Cities</legend>
                {allCities.map((c) => (
                  <label key={c} className="check-chip">
                    <input type="checkbox" checked={cities.includes(c)} onChange={() => setCities((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]))} />
                    <span>{c}</span>
                  </label>
                ))}
              </fieldset>
              <div className="form-grid three">
                <Field label="Other places" hint="Comma separated">
                  {(id, hint) => <input id={id} className="input" aria-describedby={hint} value={other} onChange={(e) => setOther(e.currentTarget.value)} />}
                </Field>
                <Field label="Maximum rent (EUR)">{(id) => <input id={id} className="input mono" inputMode="numeric" value={maxRent} onChange={(e) => setMaxRent(e.currentTarget.value.replace(/[^\d]/g, ''))} />}</Field>
                <Field label="Minimum size (m²)">{(id) => <input id={id} className="input mono" inputMode="numeric" value={minSize} onChange={(e) => setMinSize(e.currentTarget.value.replace(/[^\d]/g, ''))} />}</Field>
              </div>
              <fieldset className="chip-set">
                <legend className="field-label">Kind of home</legend>
                {TYPES.map((t) => (
                  <label key={t} className="check-chip">
                    <input type="checkbox" checked={types.includes(t)} onChange={() => setTypes((list) => (list.includes(t) ? list.filter((x) => x !== t) : [...list, t]))} />
                    <span>{PROPERTY_TYPE[t]}</span>
                  </label>
                ))}
              </fieldset>
            </>
          ) : null}

          {step === 'Mail' ? (
            <>
              <h1 className="wizard-title" id="wizard-title" tabIndex={-1}>
                A mailbox for the replies.
              </h1>
              <p className="wizard-lede">Use a new address just for this search, so nothing touches your personal inbox. Gmail works: turn on 2-Step Verification and create an app password.</p>
              <div className="form-grid">
                <Field label="Mailbox">
                  {(id) => (
                    <select id={id} className="input" value={mail.provider} onChange={(e) => setMail({ ...mail, provider: e.currentTarget.value as Config['mail']['provider'] })}>
                      <option value="imap">IMAP and SMTP (Gmail and most providers)</option>
                      <option value="memory">In memory (demo)</option>
                      <option value="none">No mailbox for now</option>
                    </select>
                  )}
                </Field>
                <Field label="Mailbox address">{(id) => <input id={id} className="input" type="email" value={mail.address || profile.email} disabled={mail.provider === 'none'} onChange={(e) => setMail({ ...mail, address: e.currentTarget.value })} />}</Field>
              </div>
              <p className="field-hint">
                The app password goes into secrets.env as <code>{mail.passwordEnv}</code>, where <code>nlpf init</code> puts it. The dashboard never sees it.{' '}
                {config.secretsPresent?.includes(mail.passwordEnv) ? 'It is already set.' : 'It is not set yet.'}
              </p>
            </>
          ) : null}

          {step === 'Notifications' ? (
            <>
              <h1 className="wizard-title" id="wizard-title" tabIndex={-1}>
                How should it reach you?
              </h1>
              <p className="wizard-lede">Install the free ntfy app on your phone and subscribe to the topic below. Only viewings, offers and things that need you are pushed.</p>
              <div className="form-grid">
                <Field label="ntfy topic" hint="Long and random, because anyone who knows it can read it." wide>
                  {(id, hint) => (
                    <div className="input-row">
                      <input
                        id={id}
                        className="input mono"
                        aria-describedby={hint}
                        value={notify.ntfy?.topic ?? ''}
                        onChange={(e) => setNotify({ ...notify, ntfy: e.currentTarget.value ? { server: notify.ntfy?.server ?? 'https://ntfy.sh', topic: e.currentTarget.value, actions: true } : undefined })}
                      />
                      <Button size="sm" onClick={() => setNotify({ ...notify, ntfy: { server: notify.ntfy?.server ?? 'https://ntfy.sh', topic: suggestTopic(), actions: true } })}>
                        Suggest
                      </Button>
                    </div>
                  )}
                </Field>
              </div>
              <Toggle label="Desktop notifications on this computer" checked={notify.desktop} onChange={(v) => setNotify({ ...notify, desktop: v })} />
              <p>
                <Button
                  size="sm"
                  icon="bolt"
                  onClick={async () => {
                    try {
                      await save('notify', notify);
                      await api.notifyTest();
                      toast('Test notification sent.');
                    } catch (e) {
                      toast(`The test did not go out: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
                    }
                  }}
                >
                  Send test
                </Button>
              </p>
            </>
          ) : null}

          {step === 'Sources' ? (
            <>
              <h1 className="wizard-title" id="wizard-title" tabIndex={-1}>
                Which sites, and how?
              </h1>
              <p className="wizard-lede">The agent reads every site you leave on. Some platforms forbid automated messages in their terms; on those it only watches, unless you opt in here.</p>
              {forbids.length ? (
                <fieldset className="optin-set">
                  <legend className="field-label">Platforms whose terms forbid automation</legend>
                  <ul className="optin-list">
                    {forbids.map((s) => {
                      const cfg: Partial<SourceConfig> = sourceCfg[s.sourceId] ?? {};
                      const enabled = cfg.enabled ?? s.enabled;
                      const optedIn = cfg.contact === 'auto' && Boolean(cfg.termsAcknowledgedAt);
                      return (
                        <li key={s.sourceId} className="optin">
                          <div className="optin-head">
                            <label className="check-row">
                              <input type="checkbox" checked={enabled} onChange={(e) => { const v = e.currentTarget.checked; setSourceCfg((c) => ({ ...c, [s.sourceId]: { ...(c[s.sourceId] ?? {}), enabled: v } as SourceConfig })); }} />
                              <span className="optin-name">{s.name}</span>
                            </label>
                            <Tag>{optedIn ? 'contacts automatically' : 'watch only'}</Tag>
                          </div>
                          <p className="optin-risk">{termsRisk(s)}</p>
                          <label className="check-row">
                            <input
                              type="checkbox"
                              checked={optedIn}
                              disabled={!enabled}
                              onChange={(e) => {
                                const v = e.currentTarget.checked;
                                setSourceCfg((c) => {
                                  const current = { ...(c[s.sourceId] ?? {}) } as SourceConfig;
                                  if (v) return { ...c, [s.sourceId]: { ...current, contact: 'auto', termsAcknowledgedAt: new Date().toISOString() } };
                                  const { termsAcknowledgedAt: _t, ...rest } = current;
                                  return { ...c, [s.sourceId]: { ...rest, contact: 'watch_only' } as SourceConfig };
                                });
                              }}
                            />
                            <span>
                              Let the agent contact landlords on {s.name} automatically. I accept that {s.name} may suspend my account.
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ) : null}
              {others.length ? (
                <fieldset className="chip-set">
                  <legend className="field-label">Other sources</legend>
                  {others.map((s) => {
                    const enabled = sourceCfg[s.sourceId]?.enabled ?? s.enabled;
                    return (
                      <label key={s.sourceId} className="check-chip">
                        <input type="checkbox" checked={enabled} onChange={(e) => { const v = e.currentTarget.checked; setSourceCfg((c) => ({ ...c, [s.sourceId]: { ...(c[s.sourceId] ?? {}), enabled: v } as SourceConfig })); }} />
                        <span>{s.name}</span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
              {!sources.length ? <p className="field-hint">The source list is loading. You can also set sources later on the Sources page.</p> : null}
            </>
          ) : null}

          {step === 'Review' ? (
            <>
              <h1 className="wizard-title" id="wizard-title" tabIndex={-1}>
                Ready to start.
              </h1>
              <p className="wizard-lede">This is what the agent will do. Change anything later; it applies from the next check.</p>
              <dl className="review-list">
                <div>
                  <dt className="label">Writes as</dt>
                  <dd>
                    {[profile.firstName, profile.lastName].filter(Boolean).join(' ')}
                    {profile.organisation ? `, ${OCCUPATION[profile.occupation]?.toLowerCase()} at ${profile.organisation}` : ''}
                    {profile.moveInFrom ? `, moving from ${ymd(profile.moveInFrom)}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="label">Searches</dt>
                  <dd>
                    {cities.join(', ') || 'no places yet'}
                    {maxRent ? `, up to ${eur(Number(maxRent))}` : ''}
                    {minSize ? `, ${minSize} m² or more` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="label">Mail</dt>
                  <dd>{mail.provider === 'none' ? 'No mailbox: replies are not read yet' : mail.provider === 'memory' ? 'In memory (demo)' : mail.address || profile.email}</dd>
                </div>
                <div>
                  <dt className="label">Pushes</dt>
                  <dd>{[notify.ntfy?.topic ? `ntfy topic ${notify.ntfy.topic}` : null, notify.desktop ? 'desktop' : null].filter(Boolean).join(', ') || 'none'}</dd>
                </div>
                <div>
                  <dt className="label">Contacts automatically on</dt>
                  <dd>
                    {sources
                      .filter((s) => (sourceCfg[s.sourceId]?.enabled ?? s.enabled) && (s.capabilities?.terms === 'forbids' ? sourceCfg[s.sourceId]?.contact === 'auto' : s.capabilities?.contact !== 'none'))
                      .map((s) => s.name)
                      .join(', ') || 'no source yet'}
                  </dd>
                </div>
              </dl>
              <Toggle label="Start in dry run" checked={dryRun} onChange={setDryRun} hint="Writes every message and shows it to you, sends nothing. Turn it off under Automation when the drafts look right." />
            </>
          ) : null}

          {error ? (
            <p className="error-note" role="alert">
              {error}
            </p>
          ) : null}
          <div className="wizard-actions">
            {index > 0 ? (
              <Button variant="ghost" onClick={() => setStep(STEPS[index - 1]!)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="wizard-actions-right">
              {step === 'Mail' || step === 'Notifications' ? (
                <Button variant="ghost" onClick={() => setStep(STEPS[index + 1]!)}>
                  Skip for now
                </Button>
              ) : null}
              <Button type="submit" variant="primary" disabled={patch.isPending}>
                {step === 'Review' ? 'Finish' : 'Continue'}
              </Button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}

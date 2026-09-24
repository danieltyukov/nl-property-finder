/*
 * Automation: how much the agent does on its own. Mode, limits, the send
 * window, dry run, the policy per kind of reply, when you can do viewings,
 * which documents it may send, the first-message templates and variants.
 * Offers, contracts and payment requests always come to you; the table shows
 * them locked.
 */
import { useRef, useState } from 'react';
import type { AutomationConfig, Intent } from '@nlpf/core';
import { useConfig, usePatchConfig } from '../api/hooks';
import type { ConfigView } from '../api/views';
import { useFeedback } from '../components/Feedback';
import { Button, Card, Field, IconButton, Loading, PageHeader, Toggle } from '../components/ui';
import { INTENT, INTENT_DEFAULT, LOCKED_INTENTS } from '../lib/labels';

type Automation = AutomationConfig;

const DAYS = [
  ['mon', 'Mon'],
  ['tue', 'Tue'],
  ['wed', 'Wed'],
  ['thu', 'Thu'],
  ['fri', 'Fri'],
  ['sat', 'Sat'],
  ['sun', 'Sun'],
] as const;

export const TEMPLATE_VARIABLES = ['{firstName}', '{lastName}', '{street}', '{city}', '{price}', '{size}', '{moveIn}', '{occupation}', '{organisation}', '{landlord}'];

const POLICY_LABEL = { auto: 'Agent handles it', task: 'Ask me', ignore: 'Ignore' } as const;

const n = (v: string, fallback: number) => (v.trim() === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));

export function AutomationPage() {
  const config = useConfig();
  if (!config.data) return <div className="page"><Loading label="Loading automation settings" /></div>;
  return <AutomationEditor config={config.data} />;
}

function AutomationEditor({ config }: { config: ConfigView }) {
  const patch = usePatchConfig();
  const { toast } = useFeedback();
  const [a, setA] = useState<Automation>(() => structuredClone(config.automation));
  const dirty = JSON.stringify(a) !== JSON.stringify(config.automation);
  const set = <K extends keyof Automation>(key: K, value: Automation[K]) => setA((x) => ({ ...x, [key]: value }));
  const save = () =>
    patch.mutate({ section: 'automation', value: a }, { onSuccess: () => toast('Automation saved.'), onError: (e) => toast(`Not saved: ${e.message}`, 'error') });

  return (
    <div className="page">
      <PageHeader eyebrow="Automation" title="How much the agent does alone." lede="The agent never pays, signs, or sends identity documents without you. Everything else is set here." />
      <div className="stack narrow">
        <Card label="Mode">
          <fieldset className="mode-set">
            <legend className="sr-only">When the agent sends a first message</legend>
            {(
              [
                ['auto', 'Send automatically', 'Every match that passes your filters and the scam guard gets a message within a minute.'],
                ['threshold', 'Send when the score is high enough', 'Matches below the threshold wait in the inbox for your approval.'],
                ['approve', 'Ask me first', 'Every first message waits in the inbox until you approve it.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className={`mode-option${a.mode === value ? ' active' : ''}`}>
                <input type="radio" name="mode" value={value} checked={a.mode === value} onChange={() => set('mode', value)} />
                <span className="mode-label">{label}</span>
                <span className="mode-hint">{hint}</span>
              </label>
            ))}
          </fieldset>
          <div className="form-grid three">
            <Field label="Score threshold" hint="0 to 100">
              {(id, hint) => <input id={id} className="input mono" inputMode="numeric" aria-describedby={hint} value={a.scoreThreshold} disabled={a.mode !== 'threshold'} onChange={(e) => set('scoreThreshold', n(e.currentTarget.value, 60))} />}
            </Field>
            <Field label="Messages per day at most">{(id) => <input id={id} className="input mono" inputMode="numeric" value={a.dailyCap} onChange={(e) => set('dailyCap', n(e.currentTarget.value, 40))} />}</Field>
            <Field label="Call-now score" hint="Pushes a call button for matches this strong with a phone number">
              {(id, hint) => <input id={id} className="input mono" inputMode="numeric" aria-describedby={hint} value={a.callNowMinScore} onChange={(e) => set('callNowMinScore', n(e.currentTarget.value, 85))} />}
            </Field>
            <Field label="Send from">{(id) => <input id={id} className="input mono" type="time" value={a.sendWindow.start} onChange={(e) => set('sendWindow', { ...a.sendWindow, start: e.currentTarget.value })} />}</Field>
            <Field label="Send until">{(id) => <input id={id} className="input mono" type="time" value={a.sendWindow.end} onChange={(e) => set('sendWindow', { ...a.sendWindow, end: e.currentTarget.value })} />}</Field>
          </div>
          <Toggle label="Dry run" checked={a.dryRun} onChange={(v) => set('dryRun', v)} hint="Writes every message and logs it, sends nothing. Good for the first hour." />
          <Toggle label="Check the listing is still online before sending" checked={a.recheckBeforeSend} onChange={(v) => set('recheckBeforeSend', v)} />
        </Card>

        <Card label="Replies">
          <div className="table-wrap">
            <table className="table policy-table">
              <thead>
                <tr>
                  <th scope="col">When a landlord sends</th>
                  {(['auto', 'task', 'ignore'] as const).map((p) => (
                    <th scope="col" key={p}>
                      {POLICY_LABEL[p]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(INTENT) as Intent[]).map((intent) => {
                  const locked = LOCKED_INTENTS.includes(intent);
                  const value = locked ? 'task' : (a.policies[intent] ?? INTENT_DEFAULT[intent]);
                  return (
                    <tr key={intent}>
                      <th scope="row">
                        {INTENT[intent]}
                        {locked ? <span className="cell-sub">Always comes to you</span> : null}
                      </th>
                      {(['auto', 'task', 'ignore'] as const).map((p) => (
                        <td key={p}>
                          <input
                            type="radio"
                            name={`policy-${intent}`}
                            aria-label={`${INTENT[intent]}: ${POLICY_LABEL[p]}`}
                            checked={value === p}
                            disabled={locked}
                            onChange={() => set('policies', { ...a.policies, [intent]: p })}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="form-grid three">
            <Field label="Automatic replies per conversation per day" hint="Stops loops with auto-responders">
              {(id, hint) => <input id={id} className="input mono" inputMode="numeric" aria-describedby={hint} value={a.maxAutoRepliesPerConversationPerDay} onChange={(e) => set('maxAutoRepliesPerConversationPerDay', n(e.currentTarget.value, 3))} />}
            </Field>
            <Field label="Follow up after (days)">{(id) => <input id={id} className="input mono" inputMode="numeric" value={a.followUp.afterDays} disabled={!a.followUp.enabled} onChange={(e) => set('followUp', { ...a.followUp, afterDays: n(e.currentTarget.value, 3) })} />}</Field>
            <Field label="Follow-ups at most">{(id) => <input id={id} className="input mono" inputMode="numeric" value={a.followUp.max} disabled={!a.followUp.enabled} onChange={(e) => set('followUp', { ...a.followUp, max: Math.min(2, n(e.currentTarget.value, 1)) })} />}</Field>
          </div>
          <Toggle label="One polite follow-up when a landlord does not answer" checked={a.followUp.enabled} onChange={(v) => set('followUp', { ...a.followUp, enabled: v })} hint="Only when the listing is still online." />
        </Card>

        <Card label="Viewings">
          <Toggle label="Accept a proposed time automatically when it fits" checked={a.autoAcceptViewings} onChange={(v) => set('autoAcceptViewings', v)} />
          <p className="field-label">When you can do viewings</p>
          <ul className="avail-list">
            {a.availability.map((block, i) => (
              <li key={i} className="avail-row">
                <fieldset className="day-set">
                  <legend className="sr-only">Days for time block {i + 1}</legend>
                  {DAYS.map(([d, label]) => (
                    <label key={d} className="day-chip">
                      <input
                        type="checkbox"
                        checked={block.days.includes(d)}
                        onChange={() => {
                          const days = block.days.includes(d) ? block.days.filter((x) => x !== d) : [...block.days, d];
                          set('availability', a.availability.map((b, j) => (j === i ? { ...b, days } : b)));
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="sr-only" htmlFor={`from-${i}`}>
                  From
                </label>
                <input id={`from-${i}`} className="input mono time" type="time" value={block.start} onChange={(e) => { const v = e.currentTarget.value; set('availability', a.availability.map((b, j) => (j === i ? { ...b, start: v } : b))); }} />
                <span aria-hidden="true">to</span>
                <label className="sr-only" htmlFor={`to-${i}`}>
                  To
                </label>
                <input id={`to-${i}`} className="input mono time" type="time" value={block.end} onChange={(e) => { const v = e.currentTarget.value; set('availability', a.availability.map((b, j) => (j === i ? { ...b, end: v } : b))); }} />
                <IconButton icon="trash" label={`Remove time block ${i + 1}`} onClick={() => set('availability', a.availability.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
          <Button size="sm" icon="plus" onClick={() => set('availability', [...a.availability, { days: ['sat'], start: '10:00', end: '16:00' }])}>
            Add a time block
          </Button>
          <div className="form-grid three">
            <Field label="Travel buffer between viewings (min)">{(id) => <input id={id} className="input mono" inputMode="numeric" value={a.viewingBufferMin} onChange={(e) => set('viewingBufferMin', n(e.currentTarget.value, 45))} />}</Field>
          </div>
        </Card>

        <Card label="Documents">
          <div className="form-grid three">
            <Field label="Public documents">
              {(id) => (
                <select id={id} className="input" value={a.documents.public} onChange={(e) => set('documents', { ...a.documents, public: e.currentTarget.value as 'auto' | 'approve' })}>
                  <option value="auto">Send when asked</option>
                  <option value="approve">Ask me</option>
                </select>
              )}
            </Field>
            <Field label="Private documents">
              {(id) => (
                <select id={id} className="input" value={a.documents.private} onChange={(e) => set('documents', { ...a.documents, private: e.currentTarget.value as 'after_viewing_booked' | 'approve' })}>
                  <option value="after_viewing_booked">Send once a viewing is booked</option>
                  <option value="approve">Ask me</option>
                </select>
              )}
            </Field>
            <Field label="Identity documents">
              {(id) => (
                <select id={id} className="input" value="approve" disabled>
                  <option value="approve">Always ask me</option>
                </select>
              )}
            </Field>
          </div>
        </Card>

        <Card label="First message">
          <p className="card-intro">Leave a template empty and the agent writes the whole message from your profile. With a template it fills in the variables and stays close to your words.</p>
          <Template label="Dutch template" value={a.templates.first.nl} onChange={(v) => set('templates', { first: { ...a.templates.first, nl: v } })} />
          <Template label="English template" value={a.templates.first.en} onChange={(v) => set('templates', { first: { ...a.templates.first, en: v } })} />
          <h3 className="label sub">Variants</h3>
          <p className="field-hint">Each home gets one variant, picked by weight. Overview shows which gets more replies.</p>
          <ul className="variant-list">
            {a.variants.map((v, i) => (
              <li key={i} className="form-grid variant-row row-with-remove">
                <Field label="Name">{(id) => <input id={id} className="input mono" value={v.id} onChange={(e) => { const val = e.currentTarget.value; set('variants', a.variants.map((x, j) => (j === i ? { ...x, id: val } : x))); }} />}</Field>
                <Field label="Instruction">{(id) => <input id={id} className="input" value={v.instruction} onChange={(e) => { const val = e.currentTarget.value; set('variants', a.variants.map((x, j) => (j === i ? { ...x, instruction: val } : x))); }} />}</Field>
                <Field label="Weight">{(id) => <input id={id} className="input mono" inputMode="numeric" value={v.weight} onChange={(e) => { const val = n(e.currentTarget.value, 1); set('variants', a.variants.map((x, j) => (j === i ? { ...x, weight: val } : x))); }} />}</Field>
                <IconButton icon="trash" label={`Remove variant ${v.id}`} onClick={() => set('variants', a.variants.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
          <Button size="sm" icon="plus" onClick={() => set('variants', [...a.variants, { id: `variant-${a.variants.length + 1}`, instruction: '', weight: 1 }])}>
            Add a variant
          </Button>
        </Card>

        <Card label="Other messages">
          <Toggle label="Add a line saying an assistant helped write the message" checked={a.disclosure.enabled} onChange={(v) => set('disclosure', { ...a.disclosure, enabled: v })} />
          <div className="form-grid">
            <Field label="Disclosure line, Dutch">{(id) => <input id={id} className="input" value={a.disclosure.nl} disabled={!a.disclosure.enabled} onChange={(e) => set('disclosure', { ...a.disclosure, nl: e.currentTarget.value })} />}</Field>
            <Field label="Disclosure line, English">{(id) => <input id={id} className="input" value={a.disclosure.en} disabled={!a.disclosure.enabled} onChange={(e) => set('disclosure', { ...a.disclosure, en: e.currentTarget.value })} />}</Field>
            <Field label="Withdrawal message, Dutch" hint="Sent by I found a place. Empty uses a built-in text." wide>
              {(id, hint) => <textarea id={id} className="input mono-area" rows={4} aria-describedby={hint} value={a.withdraw.nl} onChange={(e) => set('withdraw', { ...a.withdraw, nl: e.currentTarget.value })} />}
            </Field>
            <Field label="Withdrawal message, English" wide>
              {(id) => <textarea id={id} className="input mono-area" rows={4} value={a.withdraw.en} onChange={(e) => set('withdraw', { ...a.withdraw, en: e.currentTarget.value })} />}
            </Field>
          </div>
        </Card>
      </div>
      <div className={`savebar${dirty ? ' show' : ''}`} role="region" aria-label="Unsaved changes" hidden={!dirty}>
        <p>You have unsaved changes to automation.</p>
        <Button variant="ghost" onClick={() => setA(structuredClone(config.automation))}>
          Discard
        </Button>
        <Button variant="primary" onClick={save} disabled={patch.isPending}>
          Save automation
        </Button>
      </div>
    </div>
  );
}

function Template({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const area = ref.current;
    if (!area) return onChange(value + token);
    const start = area.selectionStart ?? value.length;
    const end = area.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <Field label={label} wide>
      {(id) => (
        <div className="template">
          <div className="var-chips" role="group" aria-label={`Insert a variable into the ${label.toLowerCase()}`}>
            {TEMPLATE_VARIABLES.map((v) => (
              <button key={v} type="button" className="var-chip" onClick={() => insert(v)}>
                {v}
              </button>
            ))}
          </div>
          <textarea id={id} ref={ref} className="input mono-area" rows={8} value={value} placeholder="Empty: the agent writes from your profile." onChange={(e) => onChange(e.currentTarget.value)} />
        </div>
      )}
    </Field>
  );
}

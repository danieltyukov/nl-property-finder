/*
 * "I found a place": withdraw every open application politely and pause the
 * agent. The dialog shows exactly which conversations get the message before
 * anything is sent; the daemon skips the home you took.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ApplicationStatus } from '@nlpf/core';
import { useApplications, useConfig, useWithdrawAll } from '../api/hooks';
import type { ApplicationView } from '../api/views';
import { CHANNEL, sourceName } from '../lib/labels';
import { fullAddress, street } from '../lib/format';
import { Dialog } from './Dialog';
import { useFeedback } from './Feedback';
import { useUi } from './state';
import { Button, Field } from './ui';

export const OPEN_STATUSES: ApplicationStatus[] = ['queued', 'contacted', 'replied', 'viewing_proposed', 'viewing_booked', 'viewed', 'offer'];

export function isOpen(view: ApplicationView): boolean {
  return OPEN_STATUSES.includes(view.application.status) && Boolean(view.conversationId);
}

export function defaultWithdrawal(firstName: string, lang: 'nl' | 'en'): string {
  const name = firstName || '';
  return lang === 'nl'
    ? `Beste heer, mevrouw,\n\nIk heb inmiddels een andere woning gevonden en trek mijn reactie daarom in. Dank voor uw tijd, en succes met de verhuur.\n\nMet vriendelijke groet,\n${name}`.trim()
    : `Dear landlord,\n\nI have found another home, so I am withdrawing my application. Thank you for your time, and good luck with the rental.\n\nKind regards,\n${name}`.trim();
}

const ELSEWHERE = '__elsewhere__';

export function FoundPlaceDialog() {
  const ui = useUi();
  const applications = useApplications();
  const config = useConfig();
  const withdraw = useWithdrawAll();
  const { toast } = useFeedback();
  const open = ui.foundOpen;
  const openApps = useMemo(() => (applications.data ?? []).filter(isOpen), [applications.data]);
  const [found, setFound] = useState<string>(ELSEWHERE);
  const [elsewhere, setElsewhere] = useState('');
  const [message, setMessage] = useState('');
  const [pause, setPause] = useState(true);

  useEffect(() => {
    if (!open) return;
    const profile = config.data?.profile;
    const custom = config.data?.automation.withdraw;
    setFound(ELSEWHERE);
    setElsewhere('');
    setPause(true);
    setMessage(custom?.nl || defaultWithdrawal(profile?.firstName ?? '', 'nl'));
  }, [open, config.data]);

  const foundView = openApps.find((a) => a.application.propertyId === found);
  const foundAddress = found === ELSEWHERE ? elsewhere.trim() : fullAddress(foundView?.property?.address, foundView?.property?.title);
  const recipients = openApps.filter((a) => a.application.propertyId !== found);

  const submit = () => {
    withdraw.mutate(
      { foundAddress: foundAddress || undefined, message: message.trim() || undefined, pause },
      {
        onSuccess: () => {
          ui.setFoundOpen(false);
          toast(
            `Withdrawal sent to ${recipients.length} ${recipients.length === 1 ? 'landlord' : 'landlords'}.${pause ? ' The agent is paused.' : ''} Congratulations on the new place.`,
          );
        },
        onError: (error) => toast(`Nothing was withdrawn: ${error.message}`, 'error'),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={() => ui.setFoundOpen(false)}
      title="I found a place"
      size="lg"
      description="Every open application gets a short, polite withdrawal, and the agent stops looking. You can resume it later."
      footer={
        <>
          <Button variant="ghost" onClick={() => ui.setFoundOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={withdraw.isPending || (recipients.length === 0 && !pause)}>
            {recipients.length ? `Withdraw ${recipients.length} ${recipients.length === 1 ? 'application' : 'applications'}` : 'Pause the agent'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Which place did you get?" wide>
          {(id) => (
            <select id={id} className="input" value={found} onChange={(e) => setFound(e.currentTarget.value)}>
              <option value={ELSEWHERE}>A place found another way</option>
              {openApps.map((a) => (
                <option key={a.application.propertyId} value={a.application.propertyId}>
                  {fullAddress(a.property?.address, a.property?.title)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {found === ELSEWHERE ? (
          <Field label="Its address (optional)" hint="If it is also in your applications, it will not get a withdrawal." wide>
            {(id, hint) => (
              <input id={id} className="input" value={elsewhere} aria-describedby={hint} onChange={(e) => setElsewhere(e.currentTarget.value)} placeholder="Oude Delft 12A, Delft" />
            )}
          </Field>
        ) : null}
        <Field label="Message to the other landlords" hint="Sent in the language of each conversation when a translation is set in Automation." wide>
          {(id, hint) => (
            <textarea id={id} className="input mono-area" rows={7} value={message} aria-describedby={hint} onChange={(e) => setMessage(e.currentTarget.value)} />
          )}
        </Field>
        <label className="check-row wide">
          <input type="checkbox" checked={pause} onChange={(e) => setPause(e.currentTarget.checked)} />
          <span>Pause the agent afterwards</span>
        </label>
      </div>
      <h3 className="label previews-title">
        {recipients.length ? `${recipients.length} ${recipients.length === 1 ? 'conversation gets' : 'conversations get'} this message` : 'No open conversations'}
      </h3>
      <ul className="previews" aria-label="Withdrawal previews">
        {recipients.map((a) => (
          <li key={a.application.id} className="preview">
            <p className="preview-head">
              <span className="preview-to">To {a.counterpart?.name ?? a.counterpart?.email ?? 'the landlord'}</span>
              <span className="preview-meta">
                {street(a.property?.address, a.property?.title)} · {CHANNEL[a.application.channel?.kind ?? 'email'] ?? 'Email'}
                {a.application.channel?.sourceId ? ` on ${sourceName(a.application.channel.sourceId)}` : ''}
              </span>
            </p>
            <p className="preview-body">{message}</p>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

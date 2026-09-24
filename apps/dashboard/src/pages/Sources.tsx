/*
 * Sources: one card per site with its health, timing, account and contact
 * mode. Automatic contact on a platform whose terms forbid it is an explicit
 * opt-in with the risk spelled out, recorded with a timestamp.
 */
import { useState } from 'react';
import { useConfig, usePatchConfig, useSourceMutations, useSources } from '../api/hooks';
import type { SourceView, TestSourceResult } from '../api/views';
import { Dialog } from '../components/Dialog';
import { useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { useNow } from '../components/state';
import { Button, Dot, ErrorNote, Loading, PageHeader, StatusPill, Tag, Toggle } from '../components/ui';
import { ago, duration, eur } from '../lib/format';
import { CHANNEL, SOURCE_HEALTH } from '../lib/labels';
import { safeHref } from '../lib/url';

const PLAN_NAMES: Record<string, string> = {
  'kamernet-premium': 'Kamernet Premium',
  'housinganywhere-plus': 'HousingAnywhere Plus',
  'huurwoningen-plus': 'Huurwoningen Premium',
};

export function planName(plan: string): string {
  return PLAN_NAMES[plan] ?? plan.replace(/-/g, ' ');
}

export function termsRisk(source: Pick<SourceView, 'name' | 'termsNote'>): string {
  return `${source.termsNote ?? `${source.name}'s terms forbid automated use.`} Messages the agent sends come from your own account, and ${source.name} can suspend that account. Reading public listings continues either way.`;
}

export function SourcesPage() {
  const sources = useSources();
  const now = useNow(5000);
  const list = sources.data ?? [];
  const on = list.filter((s) => s.enabled);
  const attention = on.filter((s) => s.health === 'degraded' || s.health === 'down' || s.health === 'needs_login');

  return (
    <div className="page">
      <PageHeader
        eyebrow="Sources"
        title={list.length ? `${on.length} of ${list.length} sources on.` : 'Sources'}
        lede={
          attention.length
            ? `${attention.length} ${attention.length === 1 ? 'needs' : 'need'} attention: ${attention.map((s) => s.name).join(', ')}.`
            : 'Every enabled source is working.'
        }
      />
      {sources.isLoading ? <Loading label="Loading sources" /> : null}
      {sources.error ? <ErrorNote error={sources.error} /> : null}
      <ul className="source-grid">
        {[...list]
          .sort((a, b) => Number(b.enabled) - Number(a.enabled) || rank(a) - rank(b) || a.name.localeCompare(b.name))
          .map((s) => (
            <SourceCard key={s.sourceId} source={s} now={now} />
          ))}
      </ul>
    </div>
  );
}

function rank(s: SourceView): number {
  return { needs_login: 0, down: 1, degraded: 2, ok: 3, watch_only: 4, disabled: 5 }[s.health] ?? 6;
}

function SourceCard({ source, now }: { source: SourceView; now: number }) {
  const m = useSourceMutations();
  const config = useConfig();
  const patchConfig = usePatchConfig();
  const { toast } = useFeedback();
  const [result, setResult] = useState<TestSourceResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const caps = source.capabilities;
  const health = SOURCE_HEALTH[source.health];
  const auto = source.contactMode === 'auto';
  const forbids = caps?.terms === 'forbids';
  const acknowledged = Boolean(source.config?.termsAcknowledgedAt ?? config.data?.sources[source.sourceId]?.termsAcknowledgedAt);
  const loginNeeded = caps?.login === 'required' || caps?.login === 'optional';
  const plan = caps?.paid?.plan;
  const hasPlan = Boolean(source.config?.paidPlan ?? config.data?.sources[source.sourceId]?.paidPlan);

  const patch = (body: Parameters<typeof m.patch.mutate>[0]['body'], done: string) =>
    m.patch.mutate({ id: source.sourceId, body }, { onSuccess: () => toast(done), onError: (e) => toast(`Not saved: ${e.message}`, 'error') });

  const optIn = () => {
    const current = config.data?.sources ?? {};
    patchConfig.mutate(
      { section: 'sources', value: { ...current, [source.sourceId]: { ...(current[source.sourceId] ?? {}), contact: 'auto', termsAcknowledgedAt: new Date().toISOString() } } },
      {
        onSuccess: () => {
          setConfirm(false);
          toast(`The agent now contacts landlords on ${source.name} automatically.`);
        },
        onError: (e) => toast(`Not saved: ${e.message}`, 'error'),
      },
    );
  };

  return (
    <li className={`card source-card${source.enabled ? '' : ' off'}`}>
      <div className="source-head">
        <Dot tone={health.tone} pulse={source.enabled && source.health === 'ok'} />
        <h2 className="source-name">{source.name}</h2>
        <StatusPill status={health} />
        {safeHref(source.homepage) ? (
          <a className="source-home" href={safeHref(source.homepage)} target="_blank" rel="noreferrer" aria-label={`${source.name} website`}>
            <Icon name="external" size={14} />
          </a>
        ) : null}
      </div>
      <dl className="source-facts">
        <div>
          <dt>Last check</dt>
          <dd className="mono">{source.lastRunAt ? ago(source.lastRunAt, now) : 'never'}</dd>
        </div>
        <div>
          <dt>Interval</dt>
          <dd className="mono">{source.intervalSec ? `every ${duration(source.intervalSec * 1000)}` : 'default'}</dd>
        </div>
        <div>
          <dt>Last result</dt>
          <dd className="mono">
            {[source.lastCount !== undefined ? `${source.lastCount} listings` : null, source.lastLatencyMs ? `${(source.lastLatencyMs / 1000).toFixed(1)} s` : null]
              .filter(Boolean)
              .join(' · ') || 'none yet'}
          </dd>
        </div>
        <div>
          <dt>Contact</dt>
          <dd>{auto ? (CHANNEL[caps?.contact ?? ''] ?? 'Automatic') : 'Watch only'}</dd>
        </div>
        <div>
          <dt>Account</dt>
          <dd>{source.health === 'needs_login' ? 'Session expired' : loginNeeded ? 'Login needed to reply' : 'No login'}</dd>
        </div>
        {source.nextRunAt && source.enabled ? (
          <div>
            <dt>Next check</dt>
            <dd className="mono">{ago(source.nextRunAt, now)}</dd>
          </div>
        ) : null}
      </dl>
      {source.lastError ? <pre className="code-block source-error">{source.lastError}</pre> : null}
      {forbids ? (
        <p className="terms-note">
          <Tag>terms forbid automation</Tag> {auto ? (acknowledged ? 'You opted in to automatic contact.' : 'Automatic contact is on.') : 'Listings are read; messages need your opt-in.'}
        </p>
      ) : null}
      {result ? (
        <div className={`test-result${result.ok ? '' : ' failed'}`} role="note">
          <p>
            {result.ok ? `Test found ${result.count ?? 0} listings${result.ms ? ` in ${(result.ms / 1000).toFixed(1)} s` : ''}.` : `Test failed: ${result.error ?? 'unknown error'}`}
          </p>
          {result.sample?.length ? (
            <ul className="plain-list">
              {result.sample.slice(0, 3).map((l) => (
                <li key={l.url}>
                  {safeHref(l.url) ? (
                    <a href={safeHref(l.url)} target="_blank" rel="noreferrer">
                      {l.title}
                    </a>
                  ) : (
                    l.title
                  )}{' '}
                  <span className="mono">{eur(l.priceEur)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="source-toggles">
        <Toggle label="On" checked={source.enabled} onChange={(v) => patch({ enabled: v }, `${source.name} is ${v ? 'on' : 'off'}.`)} />
        <Toggle
          label="Contact landlords automatically"
          checked={auto}
          disabled={!source.enabled || caps?.contact === 'none'}
          hint={forbids && !auto ? 'Asks you to accept the risk first.' : undefined}
          onChange={(v) => {
            if (v && forbids && !acknowledged) setConfirm(true);
            else patch({ contact: v ? 'auto' : 'watch_only' }, v ? `The agent contacts landlords on ${source.name}.` : `${source.name} is watch only.`);
          }}
        />
        {plan ? (
          <Toggle
            label={`I have ${planName(plan)}`}
            checked={hasPlan}
            hint="Only for a plan you already pay for. The agent never buys one."
            onChange={(v) => patch({ paidPlan: v ? plan : null }, v ? `${planName(plan)} noted.` : `${planName(plan)} removed.`)}
          />
        ) : null}
      </div>
      <div className="source-actions">
        <Button
          icon="refresh"
          size="sm"
          disabled={!source.enabled || m.poll.isPending}
          onClick={() => m.poll.mutate(source.sourceId, { onSuccess: () => toast(`Checking ${source.name} now.`), onError: (e) => toast(e.message, 'error') })}
        >
          Check now
        </Button>
        <Button
          size="sm"
          disabled={m.test.isPending}
          onClick={() =>
            m.test.mutate(source.sourceId, {
              onSuccess: (r) => setResult(r),
              onError: (e) => setResult({ ok: false, error: e.message }),
            })
          }
        >
          {m.test.isPending && m.test.variables === source.sourceId ? 'Testing' : 'Test'}
        </Button>
        {loginNeeded ? (
          <Button
            size="sm"
            variant={source.health === 'needs_login' ? 'primary' : 'secondary'}
            icon="key"
            onClick={() =>
              m.connect.mutate(source.sourceId, {
                onSuccess: () => toast(`A ${source.name} login window opened on this computer. Log in there once; the agent keeps the session.`),
                onError: (e) => toast(e.message, 'error'),
              })
            }
          >
            {source.health === 'needs_login' ? 'Reconnect' : 'Connect'}
          </Button>
        ) : null}
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Automatic contact on ${source.name}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep watch only
            </Button>
            <Button variant="primary" onClick={optIn} disabled={patchConfig.isPending}>
              I accept the risk
            </Button>
          </>
        }
      >
        <p>{termsRisk(source)}</p>
        <p className="field-hint">Your choice is saved with today's date. You can switch back to watch only at any time.</p>
      </Dialog>
    </li>
  );
}

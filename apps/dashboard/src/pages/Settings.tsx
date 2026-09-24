/*
 * Settings, one column: AI, mail, notifications, the service, and how other
 * programs (Claude through MCP, scripts through REST) reach the agent.
 * Secrets never pass through the dashboard; it only shows whether each one
 * is set in secrets.env.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { Config } from '@nlpf/core';
import { useApi } from '../api/client';
import { useConfig, usePatchConfig, useStatus } from '../api/hooks';
import type { ConfigView } from '../api/views';
import { useFeedback } from '../components/Feedback';
import { CopyButton } from '../components/state';
import { Button, Card, Field, Loading, PageHeader, Pill, Toggle } from '../components/ui';
import { ago, duration, num } from '../lib/format';
import { apiOrigin, apiToken } from '../env';
import { CLAUDE_CODE_COMMAND, mcpSnippet, suggestTopic } from '../lib/access';

type Section = 'ai' | 'mail' | 'notify' | 'server';

const OPS = ['extract', 'compose', 'classify', 'reply'] as const;
const OP_LABEL: Record<(typeof OPS)[number], string> = {
  extract: 'Reading listings',
  compose: 'First messages',
  classify: 'Sorting replies',
  reply: 'Answering replies',
};

export function SettingsPage() {
  const config = useConfig();
  if (!config.data) return <div className="page"><Loading label="Loading settings" /></div>;
  return <SettingsEditor config={config.data} />;
}

function Secret({ name, config }: { name: string; config: ConfigView }) {
  const set = config.secretsPresent?.includes(name);
  return (
    <p className="secret-line">
      <code>{name}</code> <Pill tone={set ? 'contacted' : 'closed'}>{set ? 'set in secrets.env' : 'not set'}</Pill>
    </p>
  );
}

function SettingsEditor({ config }: { config: ConfigView }) {
  const patch = usePatchConfig();
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<Pick<Config, Section>>(() => structuredClone({ ai: config.ai, mail: config.mail, notify: config.notify, server: config.server }));
  const dirtySections = (['ai', 'mail', 'notify', 'server'] as Section[]).filter((s) => JSON.stringify(draft[s]) !== JSON.stringify(config[s]));

  const setSection = <S extends Section>(section: S, value: Config[S]) => setDraft((d) => ({ ...d, [section]: value }));

  const save = async () => {
    for (const section of dirtySections) {
      try {
        await patch.mutateAsync({ section, value: draft[section] });
      } catch (e) {
        toast(`${section} not saved: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
        return;
      }
    }
    toast('Settings saved.');
  };

  return (
    <div className="page">
      <PageHeader eyebrow="Settings" title="Settings" lede="Changes are written to config.yaml. Secrets live in secrets.env next to it and never pass through this page." />
      <div className="stack settings">
        <AiSettings ai={draft.ai} config={config} onChange={(v) => setSection('ai', v)} />
        <MailSettings mail={draft.mail} config={config} onChange={(v) => setSection('mail', v)} />
        <NotifySettings notify={draft.notify} config={config} onChange={(v) => setSection('notify', v)} />
        <ServiceSettings server={draft.server} onChange={(v) => setSection('server', v)} />
        <AgentAccess />
        <Card label="Setup">
          <p className="card-intro">Walk through profile, search, mail, notifications and sources again. Nothing is lost; each step starts from what you have now.</p>
          <Link className="btn btn-secondary btn-md" href="/welcome">
            <span className="btn-label">Run the setup again</span>
          </Link>
        </Card>
      </div>
      <div className={`savebar${dirtySections.length ? ' show' : ''}`} role="region" aria-label="Unsaved changes" hidden={!dirtySections.length}>
        <p>Unsaved changes in {dirtySections.map((s) => ({ ai: 'AI', mail: 'mail', notify: 'notifications', server: 'service' })[s]).join(', ')}.</p>
        <Button variant="ghost" onClick={() => setDraft(structuredClone({ ai: config.ai, mail: config.mail, notify: config.notify, server: config.server }))}>
          Discard
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={patch.isPending}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

function AiSettings({ ai, config, onChange }: { ai: Config['ai']; config: ConfigView; onChange: (v: Config['ai']) => void }) {
  const status = useStatus();
  const usage = status.data?.ai.usageThisMonth;
  const tokens = usage ? usage.inputTokens + usage.outputTokens : 0;
  const budget = ai.monthlyTokenBudget;
  return (
    <Card label="AI">
      <fieldset className="mode-set compact">
        <legend className="field-label">Provider</legend>
        {(
          [
            ['claude', 'Claude', 'Reads listings, writes messages and sorts replies. Costs API usage.'],
            ['rules', 'Rules only', 'Keywords and templates. Free, less natural.'],
            ['demo', 'Demo', 'Fixed answers for trying the tool out.'],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className={`mode-option${ai.provider === value ? ' active' : ''}`}>
            <input type="radio" name="ai-provider" checked={ai.provider === value} onChange={() => onChange({ ...ai, provider: value })} />
            <span className="mode-label">{label}</span>
            <span className="mode-hint">{hint}</span>
          </label>
        ))}
      </fieldset>
      <Secret name={ai.keyEnv} config={config} />
      <div className="table-wrap">
        <table className="table ops-table">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Model</th>
              <th scope="col">Effort</th>
            </tr>
          </thead>
          <tbody>
            {OPS.map((op) => (
              <tr key={op}>
                <th scope="row">{OP_LABEL[op]}</th>
                <td>
                  <input
                    className="input mono"
                    aria-label={`Model for ${OP_LABEL[op].toLowerCase()}`}
                    value={ai[op].model}
                    disabled={ai.provider !== 'claude'}
                    onChange={(e) => onChange({ ...ai, [op]: { ...ai[op], model: e.currentTarget.value } })}
                  />
                </td>
                <td>
                  <select
                    className="input"
                    aria-label={`Effort for ${OP_LABEL[op].toLowerCase()}`}
                    value={ai[op].effort}
                    disabled={ai.provider !== 'claude'}
                    onChange={(e) => onChange({ ...ai, [op]: { ...ai[op], effort: e.currentTarget.value as 'low' | 'medium' | 'high' } })}
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid">
        <Field label="Monthly token budget" hint="When reached, the agent falls back to rules until next month. Empty means no limit.">
          {(id, hint) => (
            <input
              id={id}
              className="input mono"
              inputMode="numeric"
              aria-describedby={hint}
              value={budget ?? ''}
              onChange={(e) => {
                const v = e.currentTarget.value.replace(/[^\d]/g, '');
                onChange({ ...ai, monthlyTokenBudget: v ? Number(v) : undefined });
              }}
            />
          )}
        </Field>
        <div className="usage">
          <p className="field-label">This month</p>
          <p className="mono">
            {num(tokens)} tokens in {num(usage?.calls ?? 0)} calls
            {usage?.cacheReadTokens ? `, ${num(usage.cacheReadTokens)} read from cache` : ''}
          </p>
          {budget ? (
            <span className="meter" aria-hidden="true">
              <span className="meter-fill" style={{ width: `${Math.min(100, (tokens / budget) * 100)}%` }} />
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function MailSettings({ mail, config, onChange }: { mail: Config['mail']; config: ConfigView; onChange: (v: Config['mail']) => void }) {
  const status = useStatus();
  const m = status.data?.mail;
  return (
    <Card label="Mail">
      <p className="card-intro">A mailbox used only by this tool. The agent reads it over IMAP and replies over SMTP with an app password.</p>
      {m ? (
        <p className="secret-line">
          <Pill tone={m.error ? 'error' : m.connected ? 'contacted' : 'closed'}>{m.error ? 'Error' : m.connected ? 'Connected' : 'Not connected'}</Pill>
          {m.error ? <span className="mono"> {m.error}</span> : m.lastIdleAt ? <span className="cell-sub"> last heard {ago(m.lastIdleAt)}</span> : null}
        </p>
      ) : null}
      <div className="form-grid">
        <Field label="Mailbox">
          {(id) => (
            <select id={id} className="input" value={mail.provider} onChange={(e) => onChange({ ...mail, provider: e.currentTarget.value as Config['mail']['provider'] })}>
              <option value="imap">IMAP and SMTP</option>
              <option value="memory">In memory (demo)</option>
              <option value="none">No mailbox</option>
            </select>
          )}
        </Field>
        <Field label="Address">{(id) => <input id={id} className="input" type="email" value={mail.address} onChange={(e) => onChange({ ...mail, address: e.currentTarget.value })} />}</Field>
        <Field label="Login name" hint="Usually the address.">
          {(id, hint) => <input id={id} className="input" aria-describedby={hint} value={mail.user ?? ''} onChange={(e) => onChange({ ...mail, user: e.currentTarget.value || undefined })} />}
        </Field>
        <Field label="Folder">{(id) => <input id={id} className="input mono" value={mail.folder} onChange={(e) => onChange({ ...mail, folder: e.currentTarget.value })} />}</Field>
        <Field label="IMAP server">{(id) => <input id={id} className="input mono" value={`${mail.imap.host}:${mail.imap.port}`} onChange={(e) => { const [host, port] = e.currentTarget.value.split(':'); onChange({ ...mail, imap: { ...mail.imap, host: host ?? '', port: Number(port) || mail.imap.port } }); }} />}</Field>
        <Field label="SMTP server">{(id) => <input id={id} className="input mono" value={`${mail.smtp.host}:${mail.smtp.port}`} onChange={(e) => { const [host, port] = e.currentTarget.value.split(':'); onChange({ ...mail, smtp: { ...mail.smtp, host: host ?? '', port: Number(port) || mail.smtp.port } }); }} />}</Field>
      </div>
      <Secret name={mail.passwordEnv} config={config} />
      <p className="field-hint">
        Set the app password with <code>nlpf init</code>, or add <code>{mail.passwordEnv}=...</code> to secrets.env yourself.
      </p>
    </Card>
  );
}

function NotifySettings({ notify, config, onChange }: { notify: Config['notify']; config: ConfigView; onChange: (v: Config['notify']) => void }) {
  const api = useApi();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      await api.notifyTest();
      toast('Test notification sent. It should reach every channel within a few seconds.');
    } catch (e) {
      toast(`The test did not go out: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card label="Notifications" action={<Button size="sm" icon="bolt" onClick={() => void test()} disabled={busy}>Send test</Button>}>
      <p className="card-intro">Only things that need you and wins (a viewing booked, an offer) are pushed. Buttons on the phone act on the task directly.</p>
      <h3 className="label sub">ntfy</h3>
      <div className="form-grid">
        <Field label="ntfy server">{(id) => <input id={id} className="input mono" value={notify.ntfy?.server ?? 'https://ntfy.sh'} onChange={(e) => onChange({ ...notify, ntfy: { server: e.currentTarget.value, topic: notify.ntfy?.topic ?? '', actions: notify.ntfy?.actions ?? true } })} />}</Field>
        <Field label="ntfy topic" hint="Anyone who knows the topic can read it, so keep it long and random.">
          {(id, hint) => (
            <div className="input-row">
              <input id={id} className="input mono" aria-describedby={hint} value={notify.ntfy?.topic ?? ''} onChange={(e) => onChange({ ...notify, ntfy: e.currentTarget.value ? { server: notify.ntfy?.server ?? 'https://ntfy.sh', topic: e.currentTarget.value, actions: notify.ntfy?.actions ?? true } : undefined })} />
              <Button size="sm" onClick={() => onChange({ ...notify, ntfy: { server: notify.ntfy?.server ?? 'https://ntfy.sh', topic: suggestTopic(), actions: notify.ntfy?.actions ?? true } })}>
                Suggest
              </Button>
            </div>
          )}
        </Field>
      </div>
      {notify.ntfy ? <Toggle label="Action buttons on ntfy" checked={notify.ntfy.actions} onChange={(v) => notify.ntfy && onChange({ ...notify, ntfy: { ...notify.ntfy, actions: v } })} /> : null}
      <h3 className="label sub">Telegram</h3>
      <div className="form-grid">
        <Field label="Telegram chat id">{(id) => <input id={id} className="input mono" value={notify.telegram?.chatId ?? ''} onChange={(e) => onChange({ ...notify, telegram: e.currentTarget.value ? { chatId: e.currentTarget.value, tokenEnv: notify.telegram?.tokenEnv ?? 'NLPF_TELEGRAM_TOKEN', actions: notify.telegram?.actions ?? true } : undefined })} />}</Field>
        {notify.telegram ? <Secret name={notify.telegram.tokenEnv} config={config} /> : null}
      </div>
      <h3 className="label sub">Email and desktop</h3>
      <div className="form-grid">
        <Field label="Email to" hint="Sent from the dedicated mailbox.">
          {(id, hint) => <input id={id} className="input" type="email" aria-describedby={hint} value={notify.email?.to ?? ''} onChange={(e) => onChange({ ...notify, email: e.currentTarget.value ? { to: e.currentTarget.value, digest: notify.email?.digest ?? 'daily' } : undefined })} />}
        </Field>
        <Field label="Email timing">
          {(id) => (
            <select id={id} className="input" value={notify.email?.digest ?? 'daily'} disabled={!notify.email} onChange={(e) => notify.email && onChange({ ...notify, email: { ...notify.email, digest: e.currentTarget.value as 'instant' | 'daily' } })}>
              <option value="daily">One daily digest</option>
              <option value="instant">Right away</option>
            </select>
          )}
        </Field>
      </div>
      <Toggle label="Desktop notifications" checked={notify.desktop} onChange={(v) => onChange({ ...notify, desktop: v })} />
      <div className="form-grid three">
        <Field label="Quiet from">{(id) => <input id={id} className="input mono" type="time" value={notify.quietHours?.start ?? ''} onChange={(e) => onChange({ ...notify, quietHours: e.currentTarget.value ? { start: e.currentTarget.value, end: notify.quietHours?.end ?? '07:30' } : undefined })} />}</Field>
        <Field label="Quiet until">{(id) => <input id={id} className="input mono" type="time" value={notify.quietHours?.end ?? ''} disabled={!notify.quietHours} onChange={(e) => notify.quietHours && onChange({ ...notify, quietHours: { ...notify.quietHours, end: e.currentTarget.value } })} />}</Field>
        <Field label="Push from priority" hint="1 is everything, 5 only urgent">
          {(id, hint) => (
            <select id={id} className="input" aria-describedby={hint} value={notify.minPriority} onChange={(e) => onChange({ ...notify, minPriority: Number(e.currentTarget.value) })}>
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Toggle label="Include addresses and details in pushes" checked={notify.includeDetails} onChange={(v) => onChange({ ...notify, includeDetails: v })} hint="Off: only a short title leaves this computer." />
    </Card>
  );
}

function ServiceSettings({ server, onChange }: { server: Config['server']; onChange: (v: Config['server']) => void }) {
  const status = useStatus();
  const s = status.data;
  return (
    <Card label="Service">
      <dl className="facts">
        <div>
          <dt className="label">Version</dt>
          <dd className="mono">{s?.version ?? ''}</dd>
        </div>
        <div>
          <dt className="label">Running for</dt>
          <dd className="mono">{s ? duration(Date.now() - Date.parse(s.startedAt)) : ''}</dd>
        </div>
        <div>
          <dt className="label">Address</dt>
          <dd className="mono">{apiOrigin()}</dd>
        </div>
        <div>
          <dt className="label">Mode</dt>
          <dd>{s?.demo ? 'Demo' : 'Live'}</dd>
        </div>
      </dl>
      <div className="form-grid three">
        <Field label="Port" hint="Takes effect after a restart.">
          {(id, hint) => <input id={id} className="input mono" inputMode="numeric" aria-describedby={hint} value={server.port} onChange={(e) => onChange({ ...server, port: Number(e.currentTarget.value) || 7431 })} />}
        </Field>
      </div>
      <Toggle label="Also listen on the local network" checked={server.lan} onChange={(v) => onChange({ ...server, lan: v })} hint="So a phone on the same Wi-Fi can open the dashboard. The token is still required." />
      <p className="field-hint">
        Start at login with <code>nlpf on</code>, stop with <code>nlpf off</code>, check with <code>nlpf status</code>.
      </p>
    </Card>
  );
}

function CodeBlock({ children, copy, what }: { children: ReactNode; copy: string; what: string }) {
  return (
    <div className="code-wrap">
      <pre className="code-block">{children}</pre>
      <CopyButton text={copy} what={what} />
    </div>
  );
}

function AgentAccess() {
  const [reveal, setReveal] = useState(false);
  const token = apiToken();
  const masked = token ? `${token.slice(0, 4)}${'•'.repeat(Math.max(8, Math.min(24, token.length - 8)))}${token.slice(-4)}` : 'not available';
  const curl = `curl -H "X-NLPF-Token: $NLPF_TOKEN" ${apiOrigin()}/api/v1/tasks`;
  return (
    <Card label="Agent access">
      <p className="card-intro">Claude (or any MCP client) can read your inbox, draft replies and resolve tasks through the MCP server. Tools that contact real people say so, and withdrawing everything needs an explicit confirmation.</p>
      <h3 className="label sub">Claude Desktop</h3>
      <CodeBlock copy={mcpSnippet()} what="MCP config">
        {mcpSnippet()}
      </CodeBlock>
      <h3 className="label sub">Claude Code</h3>
      <CodeBlock copy={CLAUDE_CODE_COMMAND} what="Command">
        {CLAUDE_CODE_COMMAND}
      </CodeBlock>
      <h3 className="label sub">API token</h3>
      <div className="token-row">
        <code className="token">{reveal ? token : masked}</code>
        <Button size="sm" icon="eye" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
          Show
        </Button>
        <CopyButton text={token} label="Copy token" what="API token" />
      </div>
      <p className="field-hint">Every request needs it in the X-NLPF-Token header. It is also in the data folder as api-token.</p>
      <h3 className="label sub">REST</h3>
      <CodeBlock copy={curl} what="Command">
        {curl}
      </CodeBlock>
      <p className="field-hint">
        The full description is at <code>/api/v1/openapi.json</code>. The CLI takes <code>--json</code> on every command, for example <code>nlpf tasks list --json</code>.
      </p>
    </Card>
  );
}

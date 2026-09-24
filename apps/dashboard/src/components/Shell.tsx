/*
 * The frame around every page: a 232px sidebar (a 60px icon rail on narrow
 * screens, a drawer on phones) and a 52px top bar with the slash breadcrumb,
 * the command field, the agent status pill, the pause switch and the theme
 * toggle.
 */
import { Link, useLocation } from 'wouter';
import type { StatusView } from '@nlpf/core';
import { usePauseResume, useConversations, useStatus } from '../api/hooks';
import { useEventStream, type StreamState } from '../api/sse';
import { useFeedback } from './Feedback';
import { countdown, clock } from '../lib/format';
import { sourceName, type Tone } from '../lib/labels';
import { NAV, navFor } from '../lib/nav';
import { useTheme } from '../lib/theme';
import { isMac } from '../env';
import { Icon } from './Icon';
import { Facade, Mark, type AgentLight } from './Mark';
import { useNow, useUi } from './state';
import { Kbd } from './ui';

export interface AgentState {
  label: string;
  tone: Tone;
  light: AgentLight;
  pulse: boolean;
}

export function agentState(status: StatusView | undefined, stream: StreamState, now: number): AgentState {
  if (!status) return { label: 'Connecting', tone: 'closed', light: 'idle', pulse: false };
  if (status.paused) return { label: 'Paused', tone: 'closed', light: 'paused', pulse: false };
  const login = status.sources.find((s) => s.enabled && s.health === 'needs_login');
  if (login) return { label: `Error: ${login.name || sourceName(login.sourceId)} login expired`, tone: 'error', light: 'error', pulse: false };
  const down = status.sources.find((s) => s.enabled && s.health === 'down');
  if (down) return { label: `Error: ${down.name || sourceName(down.sourceId)} is down`, tone: 'error', light: 'error', pulse: false };
  if (status.mail?.error) return { label: 'Error: mail is not connected', tone: 'error', light: 'error', pulse: false };
  if (stream === 'closed') return { label: 'Reconnecting', tone: 'closed', light: 'idle', pulse: false };
  const next = status.nextPollAt ? Date.parse(status.nextPollAt) - now : NaN;
  const label = Number.isFinite(next) && next > 0 ? `Running · next check ${countdown(next)}` : 'Running';
  return { label, tone: 'live', light: 'running', pulse: true };
}

export function AgentStatusPill({ state, dryRun }: { state: AgentState; dryRun?: boolean }) {
  return (
    <span className={`agent-pill ${state.tone}`} data-testid="agent-status">
      <span className={`dot ${state.tone}${state.pulse ? ' pulse' : ''}`} aria-hidden="true" />
      <span className="agent-pill-text">{state.label}</span>
      {dryRun ? <span className="agent-pill-flag">Dry run</span> : null}
    </span>
  );
}

export function PauseSwitch({ paused }: { paused: boolean }) {
  const mutation = usePauseResume();
  const { toast } = useFeedback();
  return (
    <button
      type="button"
      className="btn btn-secondary btn-md pause-btn"
      disabled={mutation.isPending}
      onClick={() =>
        mutation.mutate(!paused, {
          onError: (error) => toast(`Could not ${paused ? 'resume' : 'pause'}: ${error.message}`, 'error'),
          onSuccess: () => toast(paused ? 'The agent is running again.' : 'The agent is paused. Sources are still read; nothing is sent.'),
        })
      }
    >
      <Icon name={paused ? 'play' : 'pause'} size={14} />
      <span className="btn-label">{paused ? 'Resume' : 'Pause'}</span>
    </button>
  );
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button type="button" id="theme" className="theme-toggle" aria-pressed={dark} onClick={toggle}>
      <Icon name="moon" size={14} />
      <span>Dark mode</span>
    </button>
  );
}

export function TopBar({ crumb }: { crumb?: string }) {
  const [location] = useLocation();
  const status = useStatus();
  const { state: stream } = useEventStream();
  const now = useNow();
  const ui = useUi();
  const state = agentState(status.data, stream, now);
  const page = navFor(location);
  return (
    <header className="topbar">
      <button type="button" className="icon-btn nav-toggle" aria-label="Open navigation" aria-expanded={ui.navOpen} onClick={() => ui.setNavOpen(!ui.navOpen)}>
        <Icon name="menu" />
      </button>
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li className="crumb-root">nlpf</li>
          <li aria-current={crumb ? undefined : 'page'}>{page.label}</li>
          {crumb ? <li aria-current="page">{crumb}</li> : null}
        </ol>
      </nav>
      <button type="button" className="command-field" onClick={() => ui.setPaletteOpen(true)} aria-haspopup="dialog">
        <span className="command-slash" aria-hidden="true">
          /
        </span>
        <span className="command-text">Search listings or run a command</span>
        <Kbd>{isMac() ? 'Cmd K' : 'Ctrl K'}</Kbd>
      </button>
      <div className="topbar-right">
        <AgentStatusPill state={state} dryRun={status.data?.dryRun} />
        <PauseSwitch paused={Boolean(status.data?.paused)} />
        <ThemeToggle />
      </div>
    </header>
  );
}

export function Sidebar({ openTasks }: { openTasks: number }) {
  const [location] = useLocation();
  const ui = useUi();
  const status = useStatus();
  const conversations = useConversations();
  const { events } = useEventStream();
  const unread = (conversations.data ?? []).reduce((n, c) => n + (c.unread || 0), 0);
  const sources = status.data?.sources ?? [];
  const active = sources.filter((s) => s.enabled);
  const problems = active.filter((s) => s.health !== 'ok' && s.health !== 'watch_only').length;
  const lastRun = active.map((s) => s.lastRunAt).filter(Boolean).sort().pop();
  const state = agentState(status.data, 'open', Date.now());
  const lastFound = events.findIndex((e) => e.type === 'listing.new');

  const count = (path: string) => {
    if (path === '/' && openTasks > 0) return <span className="nav-badge">{openTasks}</span>;
    if (path === '/conversations' && unread > 0) return <span className="nav-count">{unread}</span>;
    if (path === '/sources' && problems > 0) return <span className="nav-warn" title={`${problems} need attention`} />;
    return null;
  };

  return (
    <>
      <div className={`nav-scrim${ui.navOpen ? ' open' : ''}`} onClick={() => ui.setNavOpen(false)} aria-hidden="true" />
      <aside className={`sidebar${ui.navOpen ? ' open' : ''}`} aria-label="Main">
        <Link href="/" className="brand" onClick={() => ui.setNavOpen(false)}>
          <Mark size={22} light={state.light} />
          <span className="brand-name">nl-property-finder</span>
        </Link>
        <nav className="nav">
          {NAV.map((group) => (
            <div className="nav-group" key={group.group}>
              <p className="nav-group-label">{group.group}</p>
              <ul>
                {group.items.map((item) => {
                  const current = navFor(location).path === item.path;
                  return (
                    <li key={item.path}>
                      <Link
                        href={item.path}
                        className={`nav-link${current ? ' active' : ''}`}
                        aria-current={current ? 'page' : undefined}
                        onClick={() => ui.setNavOpen(false)}
                        title={item.label}
                      >
                        <Icon name={item.icon} />
                        <span className="nav-label">{item.label}</span>
                        {count(item.path)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="agent-block">
          <Facade found={status.data?.counts.seenToday ?? 0} needsYou={openTasks > 0} ping={lastFound === 0 ? events[0]?.id : undefined} />
          <p className="agent-block-line">
            {status.data?.paused ? 'Paused' : `Checking ${active.length} ${active.length === 1 ? 'source' : 'sources'}`}
          </p>
          <p className="agent-block-meta">{lastRun ? `Last check ${clock(lastRun)}` : 'No check yet'}</p>
        </div>
      </aside>
    </>
  );
}

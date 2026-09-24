/*
 * Ctrl K / Cmd K: one field that reaches every page, every agent action and
 * any listing by address. Arrow keys move, Enter runs, Escape closes.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { usePauseResume, useProperties, useSourceMutations, useSources, useStatus } from '../api/hooks';
import { eur, fullAddress } from '../lib/format';
import { ALL_NAV } from '../lib/nav';
import { isDarkNow, useTheme } from '../lib/theme';
import { apiToken } from '../env';
import { useFeedback } from './Feedback';
import { Icon, type IconName } from './Icon';
import { copyText, useUi } from './state';
import { Kbd } from './ui';
import { mcpSnippet } from '../pages/Settings';

interface Command {
  id: string;
  group: 'Actions' | 'Go to' | 'Listings';
  label: string;
  hint?: string;
  icon: IconName;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const ui = useUi();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const status = useStatus();
  const sources = useSources();
  const pause = usePauseResume();
  const sourceMutations = useSourceMutations();
  const { toast } = useFeedback();
  const { toggle } = useTheme();
  const properties = useProperties({ limit: 200 });
  const open = ui.paletteOpen;
  const close = () => ui.setPaletteOpen(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    // Hand focus back to whatever opened the palette.
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const paused = Boolean(status.data?.paused);
    const go = (path: string) => () => navigate(path);
    const actions: Command[] = [
      {
        id: 'pause',
        group: 'Actions',
        label: paused ? 'Resume agent' : 'Pause agent',
        hint: paused ? 'Start sending again' : 'Keep reading sources, send nothing',
        icon: paused ? 'play' : 'pause',
        run: () => pause.mutate(!paused, { onSuccess: () => toast(paused ? 'The agent is running again.' : 'The agent is paused.') }),
      },
      {
        id: 'check',
        group: 'Actions',
        label: 'Check all sources now',
        icon: 'refresh',
        keywords: 'poll refresh',
        run: () => {
          const enabled = (sources.data ?? []).filter((s) => s.enabled);
          enabled.forEach((s) => sourceMutations.poll.mutate(s.sourceId));
          toast(`Checking ${enabled.length} sources now.`);
        },
      },
      { id: 'inbox', group: 'Actions', label: 'Open inbox', icon: 'inbox', run: go('/') },
      { id: 'area', group: 'Actions', label: 'Add search area', icon: 'map', keywords: 'region polygon postcode', run: go('/search?new=1') },
      { id: 'found', group: 'Actions', label: 'I found a place', hint: 'Withdraw every open application', icon: 'check', keywords: 'withdraw stop', run: () => ui.setFoundOpen(true) },
      { id: 'theme', group: 'Actions', label: isDarkNow() ? 'Switch to light mode' : 'Switch to dark mode', icon: 'moon', keywords: 'theme dark light', run: toggle },
      {
        id: 'token',
        group: 'Actions',
        label: 'Copy API token',
        icon: 'key',
        run: () => void copyText(apiToken()).then((ok) => toast(ok ? 'API token copied.' : 'Could not copy the token.', ok ? 'info' : 'error')),
      },
      {
        id: 'mcp',
        group: 'Actions',
        label: 'Copy MCP config for Claude',
        icon: 'copy',
        run: () => void copyText(mcpSnippet()).then((ok) => toast(ok ? 'MCP config copied.' : 'Could not copy.', ok ? 'info' : 'error')),
      },
    ];
    const pages: Command[] = ALL_NAV.map((item) => ({ id: `go-${item.path}`, group: 'Go to', label: item.label, icon: item.icon, run: go(item.path) }));
    const listings: Command[] = (properties.data ?? []).map((view) => ({
      id: `p-${view.property.id}`,
      group: 'Listings',
      label: fullAddress(view.property.address, view.property.title),
      hint: [eur(view.property.priceEur), view.property.address.postcode].filter(Boolean).join(' · '),
      icon: 'home',
      keywords: `${view.property.address.postcode ?? ''} ${view.listings.map((l) => l.sourceId).join(' ')}`,
      run: go(`/properties/${view.property.id}`),
    }));
    return [...actions, ...pages, ...listings];
  }, [status.data?.paused, sources.data, properties.data, navigate, pause, sourceMutations.poll, toast, toggle, ui]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((c) => c.group !== 'Listings').concat(commands.filter((c) => c.group === 'Listings').slice(0, 4));
    const words = q.split(/\s+/);
    return commands
      .filter((c) => {
        const hay = `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 12);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const runAt = (i: number) => {
    const command = results[i];
    if (!command) return;
    close();
    command.run();
  };

  let lastGroup = '';
  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-field">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label="Search listings or run a command"
            placeholder="Search listings or run a command"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runAt(active);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              } else if (e.key === 'Tab') {
                // The field is the only stop in the palette; Tab stays in it.
                e.preventDefault();
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="palette-list" role="listbox" id={listId} aria-label="Commands">
          {results.length === 0 ? <li className="palette-empty">No command or listing matches "{query}".</li> : null}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header ? (
                  <p className="palette-group label" aria-hidden="true">
                    {header}
                  </p>
                ) : null}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item${i === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runAt(i)}
                >
                  <Icon name={c.icon} />
                  <span className="palette-label">{c.label}</span>
                  {c.hint ? <span className="palette-hint">{c.hint}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

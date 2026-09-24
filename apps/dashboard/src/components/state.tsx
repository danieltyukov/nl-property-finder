/*
 * App-wide UI state that is not server state: which overlays are open, and a
 * clock that ticks once a second for countdowns and "40 s ago" labels.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFeedback } from './Feedback';
import { Icon } from './Icon';

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  foundOpen: boolean;
  setFoundOpen: (open: boolean) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

const UiContext = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [foundOpen, setFoundOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const value = useMemo(
    () => ({ paletteOpen, setPaletteOpen, foundOpen, setFoundOpen, navOpen, setNavOpen }),
    [paletteOpen, foundOpen, navOpen],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const value = useContext(UiContext);
  if (!value) throw new Error('useUi needs a <UiProvider>');
  return value;
}

/** Current time, refreshed every `ms` milliseconds. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API refused (insecure origin or no permission): fall back to a hidden textarea.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = 'Copy', what }: { text: string; label?: string; what: string }) {
  const { toast } = useFeedback();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        const ok = await copyText(text);
        setDone(ok);
        toast(ok ? `${what} copied.` : `Could not copy the ${what.toLowerCase()}. Select it and copy by hand.`, ok ? 'info' : 'error');
        if (ok) setTimeout(() => setDone(false), 1600);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={14} />
      <span className="btn-label">{done ? 'Copied' : label}</span>
    </button>
  );
}

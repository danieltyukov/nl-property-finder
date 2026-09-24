/*
 * The theme, same rules as the owner's sites: the head script applies a stored
 * choice before first paint; this keeps React in step with it. A click stores
 * "light" or "dark" under nlpf-theme. "System" is what you get with nothing
 * stored, and the system flipping only moves the button while nothing is.
 */
import { useCallback, useEffect, useState } from 'react';

export const THEME_KEY = 'nlpf-theme';

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

export function isDarkNow(): boolean {
  const choice = document.documentElement.dataset.theme;
  return choice === 'dark' || (choice === undefined && Boolean(media()?.matches));
}

export function useTheme() {
  const [dark, setDark] = useState(isDarkNow);

  useEffect(() => {
    const mq = media();
    if (!mq) return;
    const sync = () => setDark(isDarkNow());
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const toggle = useCallback(() => {
    const next = isDarkNow() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage refused. The choice still applies to this page view.
    }
    setDark(next === 'dark');
  }, []);

  return { dark, toggle };
}

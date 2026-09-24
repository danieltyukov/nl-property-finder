/*
 * Toasts, undo and the one polite live region.
 *
 * Inbox actions contact real people, so they are deferred: the item leaves the
 * list at once, a toast offers Undo for five seconds, and only then does the
 * request go to the daemon. Leaving the page commits what is pending (the
 * transport uses keepalive), so an action is never silently lost.
 *
 * The page has exactly one aria-live region. It announces new inbox items and
 * the result of an action, never feed lines.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isPlainKey, isTypingTarget } from '../lib/keys';
import { Icon } from './Icon';
import { Kbd } from './ui';

type Tone = 'info' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
  undoable: boolean;
  duration: number;
}

interface Pending {
  commit: () => Promise<unknown>;
  hide: string[];
  timer: ReturnType<typeof setTimeout>;
}

export interface FeedbackApi {
  /** Run `commit` after the undo window unless the person presses Undo. */
  defer(opts: { message: string; commit: () => Promise<unknown>; hide?: string[] }): void;
  toast(message: string, tone?: Tone): void;
  announce(message: string): void;
  /** Ids of items hidden while their action waits out the undo window. */
  hidden: ReadonlySet<string>;
  undoMs: number;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

let seq = 0;

export function FeedbackProvider({ children, undoMs = 5000 }: { children: ReactNode; undoMs?: number }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [liveText, setLiveText] = useState('');
  const pending = useRef(new Map<number, Pending>());
  const toastTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const removeToast = useCallback((id: number) => {
    clearTimeout(toastTimers.current.get(id));
    toastTimers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const unhide = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setHidden((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const announce = useCallback((message: string) => {
    // Clearing first makes a repeated sentence announce again.
    setLiveText('');
    setTimeout(() => setLiveText(message), 60);
  }, []);

  const toast = useCallback(
    (message: string, tone: Tone = 'info') => {
      const id = ++seq;
      const duration = tone === 'error' ? 8000 : 4000;
      setToasts((list) => [...list.slice(-3), { id, message, tone, undoable: false, duration }]);
      toastTimers.current.set(id, setTimeout(() => removeToast(id), duration));
      if (tone === 'error') announce(message);
    },
    [announce, removeToast],
  );

  const run = useCallback(
    async (id: number) => {
      const item = pending.current.get(id);
      if (!item) return;
      pending.current.delete(id);
      clearTimeout(item.timer);
      removeToast(id);
      try {
        await item.commit();
      } catch (error) {
        toast(`That did not go through: ${error instanceof Error ? error.message : 'unknown error'}.`, 'error');
      } finally {
        unhide(item.hide);
      }
    },
    [removeToast, toast, unhide],
  );

  const defer = useCallback<FeedbackApi['defer']>(
    ({ message, commit, hide = [] }) => {
      const id = ++seq;
      if (hide.length) setHidden((current) => new Set([...current, ...hide]));
      const timer = setTimeout(() => void run(id), undoMs);
      pending.current.set(id, { commit, hide, timer });
      setToasts((list) => [...list.slice(-3), { id, message, tone: 'info', undoable: true, duration: undoMs }]);
      announce(`${message}. Press U to undo.`);
    },
    [announce, run, undoMs],
  );

  const undo = useCallback(
    (id?: number) => {
      const target = id ?? [...pending.current.keys()].pop();
      if (target === undefined) return;
      const item = pending.current.get(target);
      if (!item) return;
      clearTimeout(item.timer);
      pending.current.delete(target);
      removeToast(target);
      unhide(item.hide);
      announce('Undone.');
    },
    [announce, removeToast, unhide],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!pending.current.size || isTypingTarget(event.target)) return;
      const ctrlZ = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
      if (ctrlZ || (isPlainKey(event) && event.key.toLowerCase() === 'u')) {
        event.preventDefault();
        undo();
      }
    };
    const flush = () => {
      for (const id of [...pending.current.keys()]) void run(id);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pagehide', flush);
    };
  }, [run, undo]);

  const api = useMemo<FeedbackApi>(() => ({ defer, toast, announce, hidden, undoMs }), [defer, toast, announce, hidden, undoMs]);

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="live-region">
        {liveText}
      </div>
      <section className="toasts" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <p className="toast-text">{t.message}</p>
            {t.undoable ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => undo(t.id)}>
                <span className="btn-label">Undo</span>
                <Kbd>U</Kbd>
              </button>
            ) : (
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => removeToast(t.id)}>
                <Icon name="close" size={14} />
              </button>
            )}
            <span className="toast-timer" style={{ animationDuration: `${t.duration}ms` }} aria-hidden="true" />
          </div>
        ))}
      </section>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext);
  if (!api) throw new Error('useFeedback needs a <FeedbackProvider>');
  return api;
}

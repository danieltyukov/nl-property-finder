/*
 * The app: providers, the shell, the routes, and the first-run gate.
 *
 * The onboarding wizard takes over the whole window while the profile has no
 * first name, and stays until the person finishes it, even though its first
 * step already writes a name. A reload in the middle resumes it.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Router, Switch, useLocation, type BaseLocationHook } from 'wouter';
import { ApiContext, type Api } from './api/client';
import { useConfig, useTasks } from './api/hooks';
import { EventStreamProvider, useOnEvent, type EventSourceFactory } from './api/sse';
import { CommandPalette } from './components/CommandPalette';
import { FeedbackProvider, useFeedback } from './components/Feedback';
import { FoundPlaceDialog } from './components/FoundPlace';
import { Mark } from './components/Mark';
import { Sidebar, TopBar } from './components/Shell';
import { UiProvider, useUi } from './components/state';
import { EmptyState } from './components/ui';
import { ActivityPage } from './pages/Activity';
import { ApplicationsPage } from './pages/Applications';
import { AutomationPage } from './pages/Automation';
import { ConversationsPage } from './pages/Conversations';
import { InboxPage } from './pages/Inbox';
import { OnboardingPage } from './pages/Onboarding';
import { OverviewPage } from './pages/Overview';
import { ProfilePage } from './pages/Profile';
import { PropertiesPage } from './pages/Properties';
import { SearchPage } from './pages/Search';
import { SettingsPage } from './pages/Settings';
import { SourcesPage } from './pages/Sources';
import { ViewingsPage } from './pages/Viewings';

export const ONBOARDING_KEY = 'nlpf-onboarding';

function readFlag(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'active';
  } catch {
    return false;
  }
}

function writeFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(ONBOARDING_KEY, 'active');
    else localStorage.removeItem(ONBOARDING_KEY);
  } catch {
    // Storage refused; the gate still works for this page view.
  }
}

export function Root({
  api,
  eventSource,
  undoMs,
  location,
  client,
}: {
  api: Api;
  eventSource?: EventSourceFactory;
  undoMs?: number;
  location?: BaseLocationHook;
  client?: QueryClient;
}) {
  const queryClient = useMemo(
    () =>
      client ??
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
          mutations: { retry: 0 },
        },
      }),
    [client],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <EventStreamProvider factory={eventSource}>
          <FeedbackProvider undoMs={undoMs}>
            <UiProvider>
              <Router hook={location}>
                <App />
              </Router>
            </UiProvider>
          </FeedbackProvider>
        </EventStreamProvider>
      </ApiContext.Provider>
    </QueryClientProvider>
  );
}

function useAnnounceNewTasks() {
  const { announce } = useFeedback();
  useOnEvent((event) => {
    if (event.type === 'task.created') announce(`New in the inbox: ${event.summary.replace(/^Needs you:\s*/i, '')}`);
  });
}

function useGlobalShortcuts() {
  const ui = useUi();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui]);
}

export function App() {
  const config = useConfig();
  const tasks = useTasks();
  const [location, navigate] = useLocation();
  const [onboarding, setOnboarding] = useState(readFlag);
  useAnnounceNewTasks();
  useGlobalShortcuts();

  useEffect(() => {
    if (config.data && !config.data.profile.firstName && !onboarding) {
      writeFlag(true);
      setOnboarding(true);
    }
  }, [config.data, onboarding]);

  if (config.isLoading) {
    return (
      <div className="splash">
        <Mark size={40} light="running" />
        <p>Connecting to the agent</p>
      </div>
    );
  }
  if (config.error && !config.data) {
    return (
      <div className="splash">
        <Mark size={40} light="error" />
        <p>The dashboard cannot reach the agent: {config.error.message}</p>
        <p className="splash-hint">Check that it is running with <code>nlpf status</code>, then reload this page.</p>
      </div>
    );
  }
  if (onboarding || location === '/welcome') {
    return (
      <OnboardingPage
        onFinish={() => {
          writeFlag(false);
          setOnboarding(false);
          navigate('/');
        }}
      />
    );
  }

  const openTasks = tasks.data?.length ?? 0;
  return (
    <Shell openTasks={openTasks}>
      <Switch>
        <Route path="/" component={InboxPage} />
        <Route path="/overview" component={OverviewPage} />
        <Route path="/properties" component={PropertiesPage} />
        <Route path="/properties/:id" component={PropertiesPage} />
        <Route path="/applications" component={ApplicationsPage} />
        <Route path="/conversations" component={ConversationsPage} />
        <Route path="/conversations/:id" component={ConversationsPage} />
        <Route path="/viewings" component={ViewingsPage} />
        <Route path="/sources" component={SourcesPage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/automation" component={AutomationPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/activity" component={ActivityPage} />
        <Route>
          <NotFound />
        </Route>
      </Switch>
    </Shell>
  );
}

function Shell({ openTasks, children }: { openTasks: number; children: ReactNode }) {
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Sidebar openTasks={openTasks} />
      <div className="main-col">
        <TopBar />
        {/* tabindex="-1" so the skip link moves keyboard focus, not only the viewport. */}
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <CommandPalette />
      <FoundPlaceDialog />
    </div>
  );
}

function NotFound() {
  return (
    <div className="page">
      <EmptyState title="There is no page here.">
        <p>
          The address does not match a page of the dashboard. <Link href="/">Go to the inbox</Link>.
        </p>
      </EmptyState>
    </div>
  );
}

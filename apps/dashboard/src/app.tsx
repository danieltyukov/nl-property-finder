/*
 * The app: providers, the shell, the routes, and the first-run gate.
 *
 * The onboarding wizard takes over the whole window while the profile has no
 * first name, and stays until the person finishes it, even though its first
 * step already writes a name. A reload in the middle resumes it.
 */
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { EmptyState, Loading } from './components/ui';
import { InboxPage } from './pages/Inbox';

/*
 * Home loads with the shell; every other page is its own chunk, fetched in
 * the background once the inbox is on screen so navigation stays instant.
 */
const pages = {
  overview: () => import('./pages/Overview').then((m) => ({ default: m.OverviewPage })),
  properties: () => import('./pages/Properties').then((m) => ({ default: m.PropertiesPage })),
  applications: () => import('./pages/Applications').then((m) => ({ default: m.ApplicationsPage })),
  conversations: () => import('./pages/Conversations').then((m) => ({ default: m.ConversationsPage })),
  viewings: () => import('./pages/Viewings').then((m) => ({ default: m.ViewingsPage })),
  sources: () => import('./pages/Sources').then((m) => ({ default: m.SourcesPage })),
  search: () => import('./pages/Search').then((m) => ({ default: m.SearchPage })),
  profile: () => import('./pages/Profile').then((m) => ({ default: m.ProfilePage })),
  automation: () => import('./pages/Automation').then((m) => ({ default: m.AutomationPage })),
  settings: () => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })),
  activity: () => import('./pages/Activity').then((m) => ({ default: m.ActivityPage })),
  onboarding: () => import('./pages/Onboarding').then((m) => ({ default: m.OnboardingPage })),
};
const OverviewPage = lazy(pages.overview);
const PropertiesPage = lazy(pages.properties);
const ApplicationsPage = lazy(pages.applications);
const ConversationsPage = lazy(pages.conversations);
const ViewingsPage = lazy(pages.viewings);
const SourcesPage = lazy(pages.sources);
const SearchPage = lazy(pages.search);
const ProfilePage = lazy(pages.profile);
const AutomationPage = lazy(pages.automation);
const SettingsPage = lazy(pages.settings);
const ActivityPage = lazy(pages.activity);
const OnboardingPage = lazy(pages.onboarding);

function usePrefetchPages() {
  useEffect(() => {
    const timer = setTimeout(() => Object.values(pages).forEach((load) => void load().catch(() => undefined)), 1200);
    return () => clearTimeout(timer);
  }, []);
}

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
  usePrefetchPages();

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
      <Suspense fallback={<Loading label="Loading the setup" />}>
        <OnboardingPage
          onFinish={() => {
            writeFlag(false);
            setOnboarding(false);
            navigate('/');
          }}
        />
      </Suspense>
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
        {/* tabindex="-1" so the skip link moves keyboard focus as well as the viewport. */}
        <main id="main" tabIndex={-1}>
          <Suspense fallback={<Loading label="Loading the page" />}>{children}</Suspense>
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

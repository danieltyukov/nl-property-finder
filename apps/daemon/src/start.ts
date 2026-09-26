import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import {
  ConfigSchema,
  createEventBus,
  createLogger,
  loadConfig,
  loadSecrets,
  openStore,
  patchConfig,
  resolvePaths,
  saveConfig,
  watchConfig,
  writeJsonSchema,
  type Config,
  type InboundMessage,
  type Logger,
  type Mailbox,
  type Paths,
  type SourceAdapter,
} from '@nlpf/core';
import { createGeocoder, type FetchJson } from '@nlpf/agent';
import { createAiProvider, createBudgetGuard, type NlpfAiProvider } from '@nlpf/ai';
import { createMailboxFromConfig, createMemoryMailbox, parseAlertEmail, type ImapMailbox, type MemoryMailbox } from '@nlpf/mail';
import { createNotifyDispatcher, createNotifySetup, generateActionSecret } from '@nlpf/notify';
import {
  builtinAdapters,
  connectSource,
  createBrowserPool,
  createPoliteFetch,
  createRegistry,
  createSourceContext,
  loadAgencyAdapters,
} from '@nlpf/sources';
import { createActions } from './actions.js';
import { createApp } from './api/app.js';
import type { DaemonContext } from './context.js';
import { createRunner } from './runner.js';
import { createScheduler, initialState } from './scheduler.js';
import { handleContact } from './pipelines/contact.js';
import { handleEvaluate } from './pipelines/evaluate.js';
import { handleInbound } from './pipelines/inbound.js';
import { handlePoll, handleSyncInbox } from './pipelines/ingest.js';
import { startNotifications } from './pipelines/notify.js';
import { handleDaily, handleFollowups, syncInboxes, tickPeriodic } from './pipelines/periodic.js';
import { openTask, type Runtime } from './runtime.js';
import { ensureToken } from './token.js';
import { adaptiveInterval } from '@nlpf/agent';

export const VERSION = '0.1.0';

export interface StartDaemonOptions {
  paths: Paths;
  demo?: boolean;
  port?: number;
  sandboxPort?: number;
  log?: Logger;
  /** Replaces the built-in sources and agency files. For tests, which must never reach a live site. */
  adapters?: SourceAdapter[];
}

export interface DaemonHandle {
  url: string;
  token: string;
  stop(): Promise<void>;
  /** The sandbox's base URL in demo mode, for tests and `nlpf demo`. */
  sandboxUrl?: string;
}

type SandboxHandle = import('@nlpf/sandbox').Sandbox;

/** Where the built dashboard lives, whether we run from source or from the bundled CLI. */
function findDashboardDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.NLPF_DASHBOARD_DIR,
    resolve(here, '../../dashboard/dist'), // apps/daemon/src -> apps/dashboard/dist
    resolve(here, '../dashboard'), // apps/cli/dist/chunks -> apps/cli/dist/dashboard
    resolve(here, 'dashboard'), // apps/cli/dist -> apps/cli/dist/dashboard
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(join(p, 'index.html')));
}

function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
  }
  return undefined;
}

/** The demo profile: a TU Delft student searching in Delft, Rotterdam and The Hague. */
export function demoConfig(base: Config): Config {
  return ConfigSchema.parse({
    ...base,
    // NLPF_DEMO_BLANK=1 starts with an empty profile, so the onboarding wizard shows (used by the walkthrough).
    profile: base.profile.firstName || process.env.NLPF_DEMO_BLANK === '1'
      ? base.profile
      : {
          firstName: 'Sam', lastName: 'de Vries', email: 'sam.huur@nlpf.localhost', phone: '+31 6 1234 5678',
          occupation: 'student', organisation: 'TU Delft', guarantor: { relation: 'parent', incomeMonthlyGrossEur: 5200, country: 'NL' },
          moveInFrom: '2026-11-01', languages: ['en', 'nl'], messageLanguage: 'auto',
          about: 'I am a second-year MSc student at TU Delft. I am quiet and tidy, I do not smoke, and my parents are my guarantors.',
          facts: { pets: 'No pets.', smoking: 'I do not smoke.' },
        },
    searches: base.searches.some((s) => s.regions.length)
      ? base.searches
      : [{ id: 'main', name: 'Delft, Rotterdam and The Hague', priceMaxEur: 1400, types: ['room', 'studio', 'apartment'], regions: [
          { name: 'Delft', municipalities: ['delft'] },
          { name: 'Rotterdam', municipalities: ['rotterdam'] },
          { name: 'Den Haag', municipalities: ['den haag', "'s-gravenhage"] },
        ] }],
    automation: { ...base.automation, sendWindow: { start: '00:00', end: '23:59' }, dailyCap: 1000 },
    rentCheck: { ...base.rentCheck, enabled: false },
    mail: { ...base.mail, provider: 'memory', address: 'sam.huur@nlpf.localhost' },
    notify: { ...base.notify, desktop: false, ntfy: undefined, telegram: undefined, email: undefined },
    ai: { ...base.ai, provider: 'demo' },
    sources: { ...base.sources },
  });
}

export async function startDaemon(opts: StartDaemonOptions): Promise<DaemonHandle> {
  const paths = opts.paths ?? resolvePaths();
  const demo = !!opts.demo;
  let secrets = loadSecrets(paths);
  const log = opts.log ?? createLogger({ file: join(paths.logsDir, 'daemon.log'), secrets: () => Object.values(secrets) });
  const startedAt = new Date().toISOString();

  // Configuration: a bad file never stops the agent; the last good one is used and a task explains.
  const loaded = loadConfig(paths);
  let config: Config = demo ? demoConfig(loaded.config) : loaded.config;
  if (demo && !existsSync(paths.configFile)) saveConfig(paths, config);
  writeJsonSchema(paths);

  const store = openStore(paths.dbFile);
  const bus = createEventBus(store);
  const token = ensureToken(paths);
  const now = () => new Date();

  if (loaded.errors.length) {
    store.tasks.open({ kind: 'config_invalid', title: 'config.yaml has a mistake', reason: `The agent kept your last working settings. ${loaded.errors.join('; ')}`, priority: 1 }, now().toISOString(), `config_invalid:${loaded.errors.join('|')}`);
  }
  for (const job of store.jobs.recover(now().toISOString())) {
    const propertyId = String(job.payload.propertyId ?? '');
    const title = store.properties.get(propertyId)?.title ?? 'a home';
    store.tasks.open({
      kind: 'send_uncertain', title: `Check whether a message went out: ${title}`,
      reason: 'The agent stopped while it was sending. The message may or may not have arrived, so it will not send it again by itself.',
      priority: 2, propertyId,
    }, now().toISOString(), `send_uncertain:${job.key}`);
  }

  // Sources.
  // Both sandbox sources share one local host, so demo mode needs no politeness gap.
  const politeFetch = createPoliteFetch({ log: log.child({ scope: 'fetch' }), ...(demo ? { minGapMs: 20 } : {}) });
  const pool = createBrowserPool({ dir: paths.browserDir, log: log.child({ scope: 'browser' }) });
  let sandbox: SandboxHandle | undefined;
  let demoAdapters: SourceAdapter[] = [];
  let memoryMailbox: MemoryMailbox | undefined;
  if (demo) {
    const sb = await import('@nlpf/sandbox');
    memoryMailbox = createMemoryMailbox(config.mail.address);
    const mm = memoryMailbox;
    // Five homes online at once so the dashboard is alive, the rest of the catalogue trickles in.
    sandbox = await sb.startSandbox({
      port: opts.sandboxPort ?? 0,
      seed: 7,
      speed: Number(process.env.NLPF_DEMO_SPEED ?? 10),
      listings: sb.demoSeed(),
      drip: process.env.NLPF_DEMO_DRIP !== '0',
      mail: { deliver: (m: InboundMessage) => mm.deliver(m), onSend: (fn: (m: never) => void) => mm.onSend(fn as never), address: config.mail.address },
    } as never);
    const { parseAgencyYaml, createAgencyAdapter } = await import('@nlpf/sources');
    demoAdapters = [
      sb.huisjeAdapter(sandbox.url, { attachmentsDir: join(paths.documentsDir, '.received') }),
      createAgencyAdapter(parseAgencyYaml(sb.grachtAgencyYaml(sandbox.url)), { confirmTimeoutMs: 5000 }),
    ];
  }
  const agencyErrors: string[] = [];
  const buildRegistry = () =>
    createRegistry(
      opts.adapters
        ? opts.adapters
        : demo
        ? demoAdapters
        : [
            ...builtinAdapters(),
            ...loadAgencyAdapters(config.agencies, paths.configDir, { onError: (file, err) => agencyErrors.push(`${file}: ${err.message}`) }),
          ],
    );
  let registry = buildRegistry();
  for (const e of agencyErrors) store.tasks.open({ kind: 'config_invalid', title: 'An agency file has a mistake', reason: e, priority: 2 }, now().toISOString(), `agency:${e}`);

  // AI, rebuilt when the AI settings or the profile change.
  const budget = () => createBudgetGuard(store, config.ai.monthlyTokenBudget);
  const buildAi = (): NlpfAiProvider => createAiProvider(config.ai, secrets, { log: log.child({ scope: 'ai' }), budget: budget(), profile: config.profile });
  let ai = buildAi();

  // Geocoding and the rent check read public registers; demo mode never leaves the machine.
  const fetchJson: FetchJson = async (url, init) => {
    if (demo) throw Object.assign(new Error('offline in demo mode'), { status: 0 });
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'nl-property-finder (+https://github.com/danieltyukov/nl-property-finder)', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} from ${new URL(url).host}`), { status: res.status });
    return res.json();
  };
  const geocoder = createGeocoder(store, fetchJson);

  // Mail.
  let mailbox: Mailbox | undefined;
  const mailStatus = { connected: false, address: config.mail.address as string | undefined, error: undefined as string | undefined, lastIdleAt: undefined as string | undefined };
  try {
    if (memoryMailbox) mailbox = memoryMailbox;
    else {
      const mb = createMailboxFromConfig(config.mail, secrets, log, {
        fromName: `${config.profile.firstName} ${config.profile.lastName}`.trim() || undefined,
        attachmentsDir: join(paths.documentsDir, '.received'),
        onWatermark: (uid, validity) => store.kv.set('mail-watermark', JSON.stringify({ uid, validity })),
        onStatus: (s) => {
          Object.assign(mailStatus, s);
          bus.emit('mail.status', s.connected ? 'Mailbox connected' : `Mailbox disconnected${s.error ? `: ${s.error}` : ''}`, { ...s });
        },
      });
      if (mb) {
        const saved = store.kv.get('mail-watermark');
        if (saved) {
          const { uid, validity } = JSON.parse(saved) as { uid: number; validity?: string };
          (mb as ImapMailbox).setWatermark?.(uid, validity);
        }
        mailbox = mb;
      }
    }
  } catch (e) {
    mailStatus.error = (e as Error).message;
    store.tasks.open({ kind: 'config_invalid', title: 'The mailbox is not set up', reason: `${(e as Error).message}. Run nlpf init or set it in Settings.`, priority: 2 }, now().toISOString(), 'mailbox_setup');
  }

  // Notifications.
  let actionSecret = store.kv.get('action-secret');
  if (!actionSecret) {
    actionSecret = generateActionSecret();
    store.kv.set('action-secret', actionSecret);
  }
  const notifySetup = createNotifySetup(config.notify, { secrets, actionSecret, mailbox: mailbox ?? null, log });
  const dispatcher = createNotifyDispatcher(notifySetup.notifiers, () => config.notify, now, { log: log.child({ scope: 'notify' }) });

  // Built below, after the runtime it reads from; the runtime reaches it through this holder.
  const late: { scheduler?: ReturnType<typeof createScheduler>; appFetch?: (req: Request) => Response | Promise<Response> } = {};
  const rt: Runtime = {
    paths, store, bus, log, demo, now,
    config: () => config,
    secrets: () => secrets,
    adapters: () => registry.enabled(config),
    adapter: (id) => registry.get(id),
    sourceContext: (adapter, signal) =>
      createSourceContext({ fetch: politeFetch, pool, log: log.child({ scope: adapter.id }), config, sourceId: adapter.id, signal: signal ?? new AbortController().signal }),
    get scheduler() {
      return late.scheduler!;
    },
    ai: () => ai,
    mailbox: () => mailbox,
    geocode: (addr) => (demo ? Promise.resolve(addr) : geocoder.geocode(addr)),
    fetchJson,
    notify: async (n) => {
      await dispatcher.notify(n);
    },
    openOnScreen: demo
      ? undefined
      : (url) =>
          new Promise<void>((res) => {
            const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
            execFile(cmd, [url], () => res());
          }),
  };

  // Adaptive polling: learn when each source publishes from our own listing.new events.
  const histograms = new Map<string, number[]>();
  const histogramFor = (sourceId: string) => {
    if (!histograms.has(sourceId)) {
      const h = new Array(168).fill(0) as number[];
      const since = new Date(Date.now() - 28 * 86_400_000).toISOString();
      const rows = store.raw.prepare('SELECT first_seen_at AS t FROM listings WHERE source_id = ? AND first_seen_at >= ?').all(sourceId, since) as { t: string }[];
      for (const r of rows) {
        const d = new Date(r.t);
        h[((d.getUTCDay() + 6) % 7) * 24 + d.getUTCHours()]! += 1;
      }
      histograms.set(sourceId, h);
      setTimeout(() => histograms.delete(sourceId), 3_600_000).unref();
    }
    return histograms.get(sourceId)!;
  };
  const scheduler = createScheduler({
    store, log, now,
    // The sandbox is local, so demo checks can be quick.
    floors: demo ? { json: 3, html: 3, browser: 3, 'email-alert': 3 } : undefined,
    config: () => config,
    adapters: () => registry.enabled(config),
    intervalFor: (a, base, at) =>
      demo ? 5 : adaptiveInterval(base, histogramFor(a.id), at, { floorSec: a.capabilities.search === 'browser' ? 120 : 60 }),
  });
  late.scheduler = scheduler;

  const inbound = (m: InboundMessage) => handleInbound(rt, m, { parseAlert: (msg) => parseAlertEmail(msg) });
  const runner = createRunner({
    store, log: log.child({ scope: 'runner' }), now, concurrency: 6, pollConcurrency: 3,
    handlers: {
      poll: (job) => handlePoll(rt, job),
      evaluate: (job) => handleEvaluate(rt, job),
      contact: (job) => handleContact(rt, job),
      sync_inbox: (job) => handleSyncInbox(rt, job, inbound),
      followup: () => handleFollowups(rt),
      daily: () => handleDaily(rt),
    },
  });

  const setPaused = (paused: boolean) => {
    config = patchConfig(paths, 'automation', { ...config.automation, paused }).config;
    if (demo) config = demoConfig(config);
    // Messages that waited out the pause go now, not at their next retry.
    if (!paused) store.raw.prepare("UPDATE jobs SET run_at = ? WHERE state = 'pending' AND kind = 'contact'").run(new Date().toISOString());
    bus.emit(paused ? 'automation.paused' : 'automation.resumed', paused ? 'Paused: reading sources, sending nothing' : 'Resumed', {});
  };
  const actions = createActions({
    rt,
    connect: (adapter) => connectSource(adapter, pool, log, 600_000, { fetch: politeFetch, config }),
    setPaused,
    notifyTest: async () => {
      const r = await dispatcher.notify({ title: 'nl-property-finder test', body: 'Notifications reach this device.', priority: 5, key: `test:${Date.now()}` });
      return { sent: true, channels: notifySetup.notifiers.map((n) => n.id), problems: notifySetup.problems, result: r } as never;
    },
    patchSourceConfig: (id, patch) => {
      const current = config.sources[id] ?? {};
      config = patchConfig(paths, 'sources', { ...config.sources, [id]: { ...current, ...patch } }).config;
      if (demo) config = demoConfig(config);
      registry = buildRegistry();
      bus.emit('config.updated', `Settings for ${id} changed`, { section: 'sources', sourceId: id });
    },
  });

  // Reload when config.yaml or the secrets change on disk.
  const reload = (next: Config) => {
    const aiChanged = JSON.stringify(next.ai) !== JSON.stringify(config.ai) || JSON.stringify(next.profile) !== JSON.stringify(config.profile);
    config = demo ? demoConfig(next) : next;
    registry = buildRegistry();
    if (aiChanged) ai = buildAi();
  };
  const unwatch = watchConfig(paths, (c) => {
    if (c.errors.length) {
      store.tasks.open({ kind: 'config_invalid', title: 'config.yaml has a mistake', reason: `The agent kept your last working settings. ${c.errors.join('; ')}`, priority: 1 }, now().toISOString(), `config_invalid:${c.errors.join('|')}`);
      return;
    }
    reload(c.config);
    secrets = loadSecrets(paths);
    bus.emit('config.updated', 'Settings changed', {});
  });

  // HTTP.
  const port = opts.port ?? config.server.port;
  const lanHost = config.server.lan ? lanAddress() : undefined;
  const ctx: DaemonContext = {
    version: VERSION, startedAt, demo, paths, port, token, lanHost, store, bus, log,
    config: () => config,
    secrets: () => secrets,
    updateConfig: (section, value) => {
      const next = patchConfig(paths, section, value).config;
      reload(next);
      // Messages that waited for a profile go now.
      if (section === 'profile') store.raw.prepare("UPDATE jobs SET run_at = ? WHERE state = 'pending' AND kind = 'contact'").run(new Date().toISOString());
      bus.emit('config.updated', `Settings changed: ${String(section)}`, { section });
      return config;
    },
    mailStatus: () => ({ ...(mailbox?.status() ?? {}), connected: mailbox?.status().connected ?? false, address: config.mail.address, error: mailStatus.error }),
    ai: () => ({ provider: ai.id, usageThisMonth: ai.usage(), budget: config.ai.monthlyTokenBudget }),
    nextPollAt: () => scheduler.nextRunAt(),
    sources: () => {
      const enabled = new Set(registry.enabled(config).map((a) => a.id));
      return registry.all().map((a) => {
        const state = store.sources.get(a.id) ?? initialState(a, config);
        const own = config.sources[a.id];
        const contactMode = own?.contact ?? (a.capabilities.terms === 'forbids' ? 'watch_only' : 'auto');
        return {
          ...state,
          name: a.name,
          enabled: enabled.has(a.id),
          health: enabled.has(a.id) ? state.health : 'disabled',
          homepage: a.homepage,
          capabilities: a.capabilities,
          regions: a.regions,
          intervalSec: own?.intervalSec ?? a.defaultIntervalSec,
          contactMode,
          canConnect: Boolean(a.checkSession),
          config: own,
          termsNote: a.capabilities.terms === 'forbids'
            ? `${a.name}'s terms forbid automated access. Switching on automatic messages risks your ${a.name} account.`
            : undefined,
        };
      });
    },
    actions,
    dashboardDir: findDashboardDir(),
  };
  // Bind first, then build the app: the guard's Host allow-list needs the real port (port 0 means any free port).
  const servers: Server[] = [];
  const listen = (hostname: string, p: number) =>
    new Promise<number>((res, rej) => {
      const s = serve({ fetch: (req: Request) => (late.appFetch ? late.appFetch(req) : new Response('starting', { status: 503 })), port: p, hostname }, (info) => res(info.port)) as unknown as Server;
      s.once('error', rej);
      servers.push(s);
    });
  const boundPort = await listen('127.0.0.1', port);
  ctx.port = boundPort;
  if (lanHost) await listen(lanHost, boundPort).catch((e) => log.warn('LAN listen failed', { error: (e as Error).message }));
  const app = createApp(ctx);
  late.appFetch = (req) => app.fetch(req);

  // Go.
  const stopNotifications = startNotifications(rt);
  for (const ch of notifySetup.channels) {
    void ch
      .start(async (a) => {
        bus.emit('action.received', `Button pressed: ${a.action}`, { taskId: a.taskId, action: a.action, channel: a.channel });
        const body = a.action === 'send_draft' && a.text ? { action: 'send_draft' as const, draft: a.text } : { action: a.action as 'approve' };
        await actions.resolveTask(a.taskId, body).catch((e) => log.warn('phone action failed', { error: (e as Error).message }));
      })
      .catch((e) => log.warn('action channel failed', { channel: ch.id, error: (e as Error).message }));
  }
  if (mailbox) await mailbox.start(inbound).catch((e) => {
    mailStatus.error = (e as Error).message;
    log.warn('mailbox did not start', { error: mailStatus.error });
  });
  runner.start();
  const tick = setInterval(() => {
    try {
      scheduler.tick();
    } catch (e) {
      log.error('scheduler tick', { error: e });
    }
  }, demo ? 500 : 1000);
  const minute = setInterval(() => {
    try {
      tickPeriodic(rt);
      void dispatcher.tick?.();
    } catch (e) {
      log.error('periodic tick', { error: e });
    }
  }, 60_000);
  tickPeriodic(rt);
  scheduler.tick();
  // Platform inboxes (Kamernet, HousingAnywhere, the sandbox's Huisje): every two minutes, every few seconds in demo mode.
  const inboxEvery = demo ? 3000 : 120_000;
  const inboxTick = setInterval(() => syncInboxes(rt, inboxEvery), inboxEvery);
  bus.emit('daemon.started', demo ? 'Demo started: the sandbox stands in for the rental market' : 'The agent started', { version: VERSION, demo });
  void openTask;

  const url = `http://127.0.0.1:${boundPort}`;
  log.info('listening', { url, demo, sandbox: sandbox?.url });

  let stopped = false;
  return {
    url,
    token,
    sandboxUrl: sandbox?.url,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(tick);
      clearInterval(minute);
      clearInterval(inboxTick);
      unwatch();
      stopNotifications();
      await runner.stop();
      for (const ch of notifySetup.channels) await ch.stop().catch(() => undefined);
      if (mailbox) await mailbox.stop().catch(() => undefined);
      await pool.closeAll().catch(() => undefined);
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
      if (sandbox) await sandbox.stop().catch(() => undefined);
      store.close();
    },
  };
}

/** A throwaway NLPF_HOME for demo mode. */
export function demoPaths(): Paths {
  return resolvePaths({ NLPF_HOME: mkdtempSync(join(tmpdir(), 'nlpf-demo-')) });
}

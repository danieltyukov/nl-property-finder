import type { Command } from 'commander';
import {
  loadConfig,
  patchConfig as patchConfigFile,
  type Page,
  type Paths,
  type PropertyView,
  type SourceConfig,
  type SourceState,
  type Task,
} from '@nlpf/core';
import { DaemonNotRunningError, type NlpfClient } from '../client.js';
import { UsageError, localTime, run, table, type CliDeps } from './context.js';

/* Commands that act through the running agent: pause, resume, sources, tasks, listings, send, connect. */

const json = { flags: '--json', description: 'print JSON' } as const;

function listData<T>(page: Page<T>): unknown {
  return page.next ? page : page.items;
}

/** A source as GET /sources reports it. Terms are read when the agent includes them. */
type SourceInfo = SourceState & { terms?: string; capabilities?: { terms?: string } };

/** The agent's source list, or null when the agent is not running. */
async function agentSources(client: NlpfClient): Promise<SourceInfo[] | null> {
  try {
    return (await client.sources()).items as SourceInfo[];
  } catch (e) {
    if (e instanceof DaemonNotRunningError) return null;
    throw e;
  }
}

interface SourceChange {
  enabled?: boolean;
  contact?: 'auto' | 'watch_only';
  termsAcknowledgedAt?: string;
}

/**
 * Applies a source setting through the running agent (PATCH /sources/:id), or
 * straight to config.yaml when it is off. The terms acknowledgement is not part
 * of the source route, so it goes into the sources section of the config.
 */
async function applySourceChange(
  paths: Paths,
  client: NlpfClient,
  running: boolean,
  id: string,
  change: SourceChange,
): Promise<'daemon' | 'config'> {
  const { termsAcknowledgedAt, ...patch } = change;
  if (running) {
    if (termsAcknowledgedAt) {
      const sources = (await client.config()).sources;
      const next = { ...sources, [id]: { ...(sources[id] ?? {}), ...patch, termsAcknowledgedAt } };
      await client.patchConfig({ section: 'sources', value: next });
    }
    await client.patchSource(id, patch);
    return 'daemon';
  }
  const loaded = loadConfig(paths);
  if (loaded.errors.length) {
    throw new UsageError(
      `config.yaml has errors, fix them first with nlpf config edit: ${loaded.errors.join('; ')}`,
    );
  }
  const sources = loaded.config.sources;
  const current: Partial<SourceConfig> = sources[id] ?? {};
  patchConfigFile(paths, 'sources', {
    ...sources,
    [id]: { ...current, ...patch, ...(termsAcknowledgedAt ? { termsAcknowledgedAt } : {}) },
  });
  return 'config';
}

function describeTestResult(r: unknown): string {
  const listings = Array.isArray(r)
    ? r
    : r && typeof r === 'object' && Array.isArray((r as { listings?: unknown }).listings)
      ? (r as { listings: unknown[] }).listings
      : null;
  if (!listings) return JSON.stringify(r, null, 2);
  const rows = listings.slice(0, 15).map((l) => {
    const x = l as { title?: string; priceEur?: number; url?: string };
    return [`  ${x.title ?? ''}`, x.priceEur ? `EUR ${x.priceEur}` : '', x.url ?? ''];
  });
  return [`Found ${listings.length} listings.`, table(rows)].join('\n');
}

function address(v: PropertyView): string {
  const a = v.property.address;
  const street = [a.street, [a.houseNumber, a.addition].filter(Boolean).join('')].filter(Boolean).join(' ');
  return [street, a.city].filter(Boolean).join(', ') || v.property.title;
}

export function registerApi(program: Command, deps: CliDeps): void {
  const client = () => deps.client(deps.paths());

  program
    .command('pause')
    .description('Stop sending: the agent keeps reading every source but contacts nobody until nlpf resume')
    .option(json.flags, json.description)
    .action((o: { json?: boolean }) =>
      run(deps, o.json, async () => ({
        data: (await client().pause()) ?? { paused: true },
        text: 'Paused. The agent keeps reading every source but sends nothing until nlpf resume.',
      })),
    );

  program
    .command('resume')
    .description('Start sending again after a pause')
    .option(json.flags, json.description)
    .action((o: { json?: boolean }) =>
      run(deps, o.json, async () => ({
        data: (await client().resume()) ?? { paused: false },
        text: 'Resumed. The agent contacts new matches and answers routine replies again.',
      })),
    );

  /* tasks */
  const tasks = program.command('tasks').description('The Action inbox: things that need you');
  tasks
    .command('list', { isDefault: true })
    .description('List tasks (open ones unless --state says otherwise)')
    .option('--state <state>', 'open, snoozed, done or dismissed', 'open')
    .option(json.flags, json.description)
    .action((o: { state: Task['state']; json?: boolean }) =>
      run(deps, o.json, async () => {
        const page = await client().tasks({ state: o.state });
        const rows = page.items.map((t) => [
          `P${t.priority}`,
          t.kind,
          t.title,
          t.dueAt ? `due ${localTime(t.dueAt)}` : '',
          t.id,
        ]);
        return {
          data: listData(page),
          text: page.items.length
            ? table(rows)
            : o.state === 'open'
              ? 'Nothing needs you right now.'
              : `No ${o.state} tasks.`,
        };
      }),
    );
  for (const [name, action, done] of [
    ['done', 'done', 'Marked done.'],
    ['dismiss', 'dismiss', 'Dismissed.'],
  ] as const) {
    tasks
      .command(`${name} <id>`)
      .description(name === 'done' ? 'Mark a task done' : 'Dismiss a task without acting on it')
      .option(json.flags, json.description)
      .action((id: string, o: { json?: boolean }) =>
        run(deps, o.json, async () => ({
          data: (await client().resolveTask(id, { action })) ?? { id, action },
          text: done,
        })),
      );
  }

  /* listings and messages */
  program
    .command('listings')
    .description('Homes the agent has found, newest first')
    .option('--status <status>', 'only this application status, for example contacted or viewing_booked')
    .option('--q <text>', 'free text on address and title')
    .option('--limit <n>', 'how many to show', '20')
    .option(json.flags, json.description)
    .action((o: { status?: string; q?: string; limit: string; json?: boolean }) =>
      run(deps, o.json, async () => {
        const limit = Number(o.limit);
        if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit takes a whole number.');
        const page = await client().properties({
          ...(o.status ? { status: o.status } : {}),
          ...(o.q ? { q: o.q } : {}),
          limit,
        });
        const rows = page.items.map((v) => [
          v.application?.status ?? (v.match && !v.match.passed ? 'filtered' : 'new'),
          v.property.priceEur ? `EUR ${v.property.priceEur}` : '',
          v.property.sizeM2 ? `${v.property.sizeM2} m2` : '',
          address(v),
          v.match ? `score ${v.match.score}` : '',
          v.property.id,
        ]);
        return { data: listData(page), text: rows.length ? table(rows) : 'No homes match.' };
      }),
    );

  program
    .command('send <conversationId> <text...>')
    .description('Send a message in a conversation. This reaches a real landlord or agent')
    .option(json.flags, json.description)
    .action((conversationId: string, words: string[], o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const r = (await client().sendMessage(conversationId, { body: words.join(' ') })) as
          { status?: string } | undefined;
        return {
          data: r ?? { sent: true },
          text: !r?.status || r.status === 'sent' ? 'Sent.' : `The message is ${r.status}.`,
        };
      }),
    );

  /* sources */
  program
    .command('connect <source>')
    .description('Log in to a platform once, in a browser window the agent opens')
    .option(json.flags, json.description)
    .action((source: string, o: { json?: boolean }) =>
      run(deps, o.json, async () => ({
        data: (await client().connectSource(source)) ?? { source, started: true },
        text: `A browser window is opening on the ${source} login page. Log in there and solve any captcha; the window closes by itself once you are logged in.`,
      })),
    );

  const sources = program
    .command('sources')
    .description('The rental sites the agent reads')
    .addHelpText(
      'after',
      [
        '',
        'enable and disable switch reading a source on or off.',
        'enable-contact lets the agent message landlords on a source by itself; disable-contact makes it watch only.',
        "When a platform's terms forbid automated access, enable-contact says so and asks first.",
      ].join('\n'),
    );

  sources
    .command('list', { isDefault: true })
    .description('Every source with its health and last run')
    .option(json.flags, json.description)
    .action((o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const page = await client().sources();
        const rows = page.items.map((s) => [
          s.sourceId,
          s.name,
          s.enabled ? s.health : 'disabled',
          s.lastRunAt ? localTime(s.lastRunAt) : 'not run yet',
          s.lastCount !== undefined ? `${s.lastCount} listings` : '',
          s.lastError ?? '',
        ]);
        return { data: listData(page), text: rows.length ? table(rows) : 'No sources yet.' };
      }),
    );

  sources
    .command('test <id>')
    .description('Run one search on the live site now and show what came back. Sends nothing')
    .option(json.flags, json.description)
    .action((id: string, o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const r = await client().testSource(id);
        return { data: r, text: describeTestResult(r) };
      }),
    );

  for (const enabled of [true, false]) {
    sources
      .command(`${enabled ? 'enable' : 'disable'} <id>`)
      .description(enabled ? 'Start reading a source' : 'Stop reading a source')
      .option(json.flags, json.description)
      .action((id: string, o: { json?: boolean }) =>
        run(deps, o.json, async () => {
          const paths = deps.paths();
          const c = deps.client(paths);
          const list = await agentSources(c);
          const via = await applySourceChange(paths, c, list !== null, id, { enabled });
          return {
            data: { sourceId: id, enabled, via },
            text: `${id} is ${enabled ? 'enabled' : 'disabled'}${via === 'config' ? ' in config.yaml' : ''}.`,
          };
        }),
      );
  }

  sources
    .command('enable-contact <id>')
    .description('Let the agent message landlords on this source by itself')
    .option('-y, --yes', 'do not ask for confirmation')
    .option(json.flags, json.description)
    .action((id: string, o: { yes?: boolean; json?: boolean }) =>
      run(deps, o.json, async () => {
        const paths = deps.paths();
        const c = deps.client(paths);
        const list = await agentSources(c);
        const info = list?.find((s) => s.sourceId === id);
        const name = info?.name ?? id;
        const terms = info?.terms ?? info?.capabilities?.terms;
        const note = o.json ? deps.io.err : deps.io.out;
        let termsAcknowledgedAt: string | undefined;
        if (terms === 'forbids') {
          const warning = `${name}'s terms forbid automated access. If you switch on automatic messages there, the risk is that ${name} suspends your account.`;
          if (o.yes) {
            note(warning);
          } else {
            const p = deps.prompter({ json: Boolean(o.json) });
            let ok = false;
            try {
              p.say(warning);
              ok = await p.confirm(`Switch on automatic messages on ${name}?`, false);
            } finally {
              p.close();
            }
            if (!ok) return { data: { sourceId: id, changed: false }, text: 'Nothing changed.' };
          }
          termsAcknowledgedAt = deps.now().toISOString();
        } else if (terms === undefined) {
          deps.io.err(
            `Could not check ${name}'s terms of use${list ? '' : ' because the agent is not running'}. docs/SOURCES.md lists the platforms whose terms forbid automated access.`,
          );
        }
        const via = await applySourceChange(paths, c, list !== null, id, {
          contact: 'auto',
          termsAcknowledgedAt,
        });
        return {
          data: {
            sourceId: id,
            changed: true,
            contact: 'auto',
            ...(termsAcknowledgedAt ? { termsAcknowledgedAt } : {}),
            termsChecked: terms !== undefined,
            via,
          },
          text: `Automatic messages are on for ${name}.`,
        };
      }),
    );

  sources
    .command('disable-contact <id>')
    .description('Make a source watch only: the agent reads it but messages nobody there')
    .option(json.flags, json.description)
    .action((id: string, o: { json?: boolean }) =>
      run(deps, o.json, async () => {
        const paths = deps.paths();
        const c = deps.client(paths);
        const list = await agentSources(c);
        const name = list?.find((s) => s.sourceId === id)?.name ?? id;
        const via = await applySourceChange(paths, c, list !== null, id, { contact: 'watch_only' });
        return {
          data: { sourceId: id, changed: true, contact: 'watch_only', via },
          text: `${name} is watch only now: the agent still reads its listings but does not message landlords there.`,
        };
      }),
    );
}

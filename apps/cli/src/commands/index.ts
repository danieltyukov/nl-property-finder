import { Command } from 'commander';
import { buildServiceSpec, type ServiceSpec } from '../service/index.js';
import { registerApi } from './api.js';
import { registerConfig } from './config.js';
import { run, type CliDeps } from './context.js';
import { registerDaemon } from './daemon.js';
import { runDoctor } from './doctor.js';
import { runInit, type InitFlags, type Prompter } from './init.js';
import { registerLifecycle } from './service.js';

/* The nlpf program: every command, each with --json. */

/** In --yes mode init asks nothing; this prints its notes and refuses any question. */
function quietPrompter(say: (t: string) => void): Prompter {
  const refuse = async (): Promise<never> => {
    throw new Error('A question came up in --yes mode.');
  };
  return { say, ask: refuse, secret: refuse, confirm: refuse, close: () => {} };
}

function registerInit(program: Command, deps: CliDeps): void {
  program
    .command('init')
    .description('Set up your profile, search, mailbox, phone alerts and AI key')
    .option('-y, --yes', 'ask nothing: use the flags below and keep everything else')
    .option('--first-name <name>')
    .option('--last-name <name>')
    .option('--birth-year <year>')
    .option('--occupation <kind>', 'student, phd, employed, self_employed, starting_job or other')
    .option('--organisation <name>', 'university or employer')
    .option('--income <euros>', 'gross monthly income')
    .option('--guarantor-relation <relation>', 'for example parent')
    .option('--guarantor-income <euros>', "guarantor's gross monthly income")
    .option('--phone <number>')
    .option('--move-in <date>', 'earliest move-in date, YYYY-MM-DD')
    .option('--move-in-latest <date>', 'latest move-in date, YYYY-MM-DD')
    .option('--adults <n>')
    .option('--children <n>')
    .option('--pets')
    .option('--no-pets')
    .option('--smoker')
    .option('--no-smoker')
    .option('--language <lang>', 'message language: auto, nl or en')
    .option('--about <text>', 'a few sentences about you for landlords')
    .option('--regions <list>', 'cities, municipalities or postcode ranges, separated by commas')
    .option('--budget <euros>', 'maximum rent per month')
    .option('--min-size <m2>')
    .option('--types <list>', 'room, studio, apartment, house')
    .option('--furnishing <list>', 'unfurnished, upholstered, furnished, unknown')
    .option('--availability <windows>', 'viewing times, for example "mon-fri 17:00-21:00; sat 10:00-16:00"')
    .option('--mail-address <address>', 'the dedicated Gmail address')
    .option('--ntfy-topic <topic>', 'ntfy topic for phone alerts, or none')
    .option('--ntfy-server <url>')
    .option('--ai <provider>', 'claude or rules')
    .option('--dry-run', 'draft messages but send nothing')
    .option('--no-dry-run')
    .option(
      '--secrets-from-env',
      'copy ANTHROPIC_API_KEY and NLPF_MAIL_PASSWORD from the environment into secrets.env',
    )
    .option('--json', 'print the result as JSON; questions go to stderr')
    .addHelpText(
      'after',
      '\nPasswords and keys are never taken as flags, so they stay out of your shell history.\nType them when asked, or pass --secrets-from-env.',
    )
    .action((o: InitFlags & { json?: boolean }) =>
      run(deps, o.json, async () => {
        const say = (t: string) => (o.json ? deps.io.err(t) : deps.io.out(t));
        const prompter = o.yes ? quietPrompter(say) : deps.prompter({ json: Boolean(o.json) });
        try {
          const result = await runInit({ paths: deps.paths(), prompter, flags: o, env: deps.env });
          return { data: result, text: '' };
        } finally {
          prompter.close();
        }
      }),
    );
}

function registerDoctor(program: Command, deps: CliDeps): void {
  program
    .command('doctor')
    .description('Check that everything the agent needs is in place, and say what to fix')
    .option('--no-push', 'do not send a test notification to your phone')
    .option('--json', 'print JSON')
    .action((o: { push: boolean; json?: boolean }) =>
      run(deps, o.json, async () => {
        const paths = deps.paths();
        let serviceSpec: ServiceSpec | undefined;
        try {
          serviceSpec = buildServiceSpec(paths, deps.env, deps.cliEntry());
        } catch {
          serviceSpec = undefined;
        }
        const checks = await runDoctor({
          paths,
          env: deps.env,
          platform: deps.platform,
          home: deps.home,
          nodeVersion: deps.nodeVersion,
          fileExists: deps.fileExists,
          listDir: deps.listDir,
          fetch: deps.fetch,
          imapLogin: deps.imapLogin,
          client: deps.client(paths),
          service: deps.service(),
          serviceSpec,
          push: o.push !== false,
        });
        const failed = checks.some((c) => c.status === 'fail');
        return {
          data: checks,
          text: checks.map((c) => `${c.status.padEnd(4)}  ${c.label.padEnd(8)}  ${c.detail}`),
          exitCode: failed ? 1 : 0,
        };
      }),
    );
}

export function buildProgram(deps: CliDeps): Command {
  const program = new Command('nlpf')
    .description('NL Property Finder: a local agent that looks for a rental home in the Netherlands for you.')
    .version(deps.version, '-v, --version')
    // Set before the subcommands exist, because commander copies it to each one when it is created.
    .configureOutput({ writeOut: (s) => deps.io.out(s.trimEnd()), writeErr: (s) => deps.io.err(s.trimEnd()) })
    .showHelpAfterError()
    .addHelpText(
      'after',
      '\nEvery command accepts --json for scripts and agents.\nNew here? Run nlpf init, then nlpf on. To look around first: nlpf demo.',
    );

  registerInit(program, deps);
  registerLifecycle(program, deps);
  registerApi(program, deps);
  registerConfig(program, deps);
  registerDoctor(program, deps);
  registerDaemon(program, deps);
  return program;
}

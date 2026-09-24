import pkg from '../package.json' with { type: 'json' };
import { buildProgram } from './commands/index.js';
import { defaultDeps } from './commands/context.js';

/* The nlpf entry point. The bundle (dist/nlpf.mjs) starts here. */

await buildProgram(defaultDeps(pkg.version)).parseAsync(process.argv);

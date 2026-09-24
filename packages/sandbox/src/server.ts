import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createAdaptorServer } from '@hono/node-server';
import { memoryLogger } from '@nlpf/core';
import { Hono } from 'hono';
import { grachtRoutes } from './agency.js';
import { controlRoutes, createControl, type Control } from './control.js';
import { SandboxCore } from './core.js';
import { facadeSvg, page } from './pages/layout.js';
import { huisjeRoutes } from './platform.js';
import type { SandboxOptions } from './types.js';
import type { World } from './world.js';

export interface Sandbox {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  url: string;
  world: World;
  control: Control;
  stop(): Promise<void>;
}

/**
 * Starts the fake Netherlands on 127.0.0.1: Huisje under `/huisje`, De
 * Gracht under `/gracht`, the controls under `/_control`, listing pictures
 * under `/media`. Landlords answer submissions on their own unless
 * `autoReply` is false.
 */
export async function startSandbox(opts: SandboxOptions): Promise<Sandbox> {
  const log = (opts.log ?? memoryLogger()).child({ scope: 'sandbox' });
  const ownDir = opts.dataDir === undefined;
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), 'nlpf-sandbox-'));
  const core = new SandboxCore(opts, dataDir, log);
  const control = createControl(core);

  const app = new Hono({ strict: false });
  app.route('/_control', controlRoutes(core, control));
  app.route('/huisje', huisjeRoutes(core));
  app.route('/gracht', grachtRoutes(core));
  app.get('/media/:id/:file', (c) => {
    const n = Number(/^(\d+)\.svg$/.exec(c.req.param('file'))?.[1] ?? NaN);
    if (!core.world.listing(c.req.param('id')) || !Number.isInteger(n)) return c.notFound();
    return c.body(facadeSvg(c.req.param('id'), n), 200, {
      'content-type': 'image/svg+xml',
      'cache-control': 'max-age=3600',
    });
  });
  app.get('/', (c) =>
    c.html(
      page({
        title: 'Sandbox',
        brand: 'nl-property-finder sandbox',
        home: '/',
        body: `<h1>De nep-Nederland sandbox</h1>
<ul>
<li><a href="/huisje/">Huisje</a>, een verzonnen huurplatform</li>
<li><a href="/gracht/">Makelaardij De Gracht</a>, een verzonnen makelaar</li>
<li><a href="/_control">/_control</a>, de bediening voor tests</li>
</ul>`,
      }),
    ),
  );
  app.onError((err, c) => {
    log.error('sandbox request failed', { path: c.req.path, error: err.message });
    return c.json({ error: 'internal', message: err.message }, 500);
  });

  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  core.url = `http://127.0.0.1:${port}`;
  core.setDrip(Boolean(opts.drip));
  // Landlords read what the agent writes back: confirmations, documents, withdrawals.
  const unsubscribe =
    'deliver' in opts.mail && opts.mail.onSend
      ? opts.mail.onSend((m) => {
          core.receiveMail(m);
        })
      : undefined;
  log.info('sandbox started', { url: core.url, seed: core.seed, speed: core.speed });

  let stopped = false;
  return {
    url: core.url,
    world: core.world,
    control,
    async stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe?.();
      core.stop();
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
      if (ownDir) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

import { Hono } from 'hono';
import type { SandboxCore } from './core.js';
import {
  grachtBooking,
  grachtContactDone,
  grachtContactFailed,
  grachtDetail,
  grachtHome,
  grachtIdFromSlug,
  grachtList,
  grachtNotFound,
} from './pages/gracht.js';
import { GRACHT_EMAIL } from './world.js';

/*
 * Makelaardij De Gracht: a fake estate agent whose pages follow
 * examples/agencies/_template.yaml, so the generic agency adapter reads it
 * with nothing but a YAML file.
 */

/**
 * The agency file for De Gracht, pointing at a running sandbox. It is the
 * template with the sandbox's URLs, plus `detail.status` so a rented listing
 * counts as gone right before contact. `contact: 'email'` gives a variant
 * without the web form, for machines without Chromium.
 *
 * ```ts
 * createAgencyAdapter(parseAgencyYaml(grachtAgencyYaml(sandbox.url)), { confirmTimeoutMs: 5_000 })
 * ```
 */
export function grachtAgencyYaml(baseUrl: string, opts: { contact?: 'form' | 'email' } = {}): string {
  const base = baseUrl.replace(/\/+$/, '');
  const contact =
    opts.contact === 'email'
      ? `contact:
  kind: email
  email: ${GRACHT_EMAIL}`
      : `contact:
  kind: form
  url: "{url}#contact"
  form:
    name: "input[name=naam]"
    email: "input[name=email]"
    phone: "input[name=telefoon]"
    message: "textarea[name=bericht]"
    submit: "button[type=submit]"
    success: "text=/bedankt|verzonden|thank you/i"
  email: ${GRACHT_EMAIL}`;
  return `# Makelaardij De Gracht, the sandbox's fake estate agent (packages/sandbox).
id: de-gracht
name: Makelaardij De Gracht
homepage: ${base}/gracht/
regions: [delft, rotterdam, den haag, "'s-gravenhage"]
preset: none
list:
  url: ${base}/gracht/aanbod/woningaanbod/huur/
  item: ".object"
  fields:
    url: { selector: "a", attr: href }
    title: { selector: ".object-street" }
    price: { selector: ".object-price" }
    size: { selector: ".object-feature-woonoppervlakte" }
    city: { selector: ".object-place" }
    status: { selector: ".object-status", exclude: ["verhuurd", "onder optie"] }
detail:
  description: ".object-description"
  images: { selector: ".object-media img", attr: src }
  status: { selector: ".object-status", exclude: ["verhuurd", "onder optie"] }
${contact}
terms: allows
`;
}

export function grachtRoutes(core: SandboxCore): Hono {
  const app = new Hono({ strict: false });

  app.use('*', async (c, next) => {
    const b = core.state.blocked.gracht;
    if (b.on) {
      if (b.retryAfterSec !== undefined) c.header('Retry-After', String(b.retryAfterSec));
      return c.text('Too many requests. Please try again later.', 429);
    }
    await next();
  });

  app.get('/', (c) => c.html(grachtHome()));

  app.get('/aanbod/woningaanbod/huur', (c) => c.html(grachtList(core.world.listings({ source: 'gracht' }))));

  app.get('/aanbod/woningaanbod/:city/huur/:slug', (c) => {
    const id = grachtIdFromSlug(c.req.param('slug'));
    const l = id ? core.world.listing(id) : undefined;
    if (!l || l.removed || l.source !== 'gracht') return c.html(grachtNotFound(), 404);
    return c.html(grachtDetail(l));
  });

  app.post('/contact', async (c) => {
    const body = await c.req.parseBody();
    const field = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');
    const l = core.world.listing(field('object'));
    if (!l || l.removed || l.source !== 'gracht')
      return c.html(grachtContactFailed('Deze woning staat niet meer in ons aanbod.'), 404);
    if (l.status !== 'available')
      return c.html(grachtContactFailed('Op deze woning kunt u niet meer reageren.'), 409);
    const message = field('bericht');
    if (!message || !field('email'))
      return c.html(grachtContactFailed('Vul uw e-mailadres en een bericht in.'), 400);
    core.submit({
      source: 'gracht',
      listing: l,
      channel: 'form',
      name: field('naam'),
      email: field('email'),
      phone: field('telefoon') || undefined,
      message,
    });
    return c.html(grachtContactDone(l));
  });

  /** The optional booking page linked from De Gracht's viewing emails. */
  app.get('/bezichtiging/:id', (c) => {
    const sub = core.world.submission(c.req.param('id'));
    if (!sub || sub.source !== 'gracht') return c.html(grachtNotFound(), 404);
    const slots = [...sub.messages].reverse().find((m) => m.slots?.length)?.slots ?? [];
    const address = (sub.listingId && core.world.listing(sub.listingId)?.addressText) || 'de woning';
    return c.html(grachtBooking(sub, address, slots, sub.booking?.slot));
  });

  app.post('/bezichtiging/:id', async (c) => {
    const sub = core.world.submission(c.req.param('id'));
    if (!sub || sub.source !== 'gracht') return c.html(grachtNotFound(), 404);
    const slots = [...sub.messages].reverse().find((m) => m.slots?.length)?.slots ?? [];
    const body = await c.req.parseBody();
    const slot = slots[Number(body.slot ?? 0)];
    const address = (sub.listingId && core.world.listing(sub.listingId)?.addressText) || 'de woning';
    if (!slot) return c.html(grachtBooking(sub, address, slots), 400);
    sub.booking = { slot, at: core.now().toISOString() };
    core.log.info('sandbox viewing booked', { submission: sub.id, slot: slot.start });
    return c.html(grachtBooking(sub, address, slots, slot));
  });

  return app;
}

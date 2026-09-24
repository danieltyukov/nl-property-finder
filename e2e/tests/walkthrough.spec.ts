import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/demo.js';

/**
 * The walkthrough: one person's first hour with the agent, against the fake
 * rental market. Serial on purpose; each step builds on the last.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
const shots = process.env.NLPF_SHOTS;

async function shot(name: string) {
  if (!shots) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/${name}.png` });
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});

test('1. onboarding: profile, search, mail, notifications, sources, review', async ({ demo }) => {
  await page.goto(`${demo.url}/?t=${demo.token}`);
  await expect(page.getByRole('heading', { name: 'Who is looking?' })).toBeVisible();
  await shot('01-onboarding-profile');
  await page.getByLabel('First name').fill('Sam');
  await page.getByLabel('Last name').fill('de Vries');
  await page.getByLabel('Email address').fill('sam.huur@nlpf.localhost');
  await page.getByLabel('University or employer').fill('TU Delft');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Search
  await expect(page.locator('#wizard-title')).toBeVisible();
  await shot('02-onboarding-search');
  for (const city of ['Delft', 'Rotterdam']) {
    const box = page.getByRole('checkbox', { name: city });
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByLabel(/maximum rent/i).fill('1400');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Mail, notifications, sources: defaults in demo mode
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('#wizard-title')).toBeVisible();
    await shot(`0${3 + i}-onboarding-step`);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  // Review
  await expect(page.getByRole('button', { name: 'Finish' })).toBeVisible();
  await shot('06-onboarding-review');
  await page.getByRole('button', { name: 'Finish' }).click();
  const config = await demo.api<{ profile: { firstName: string }; searches: { regions: { name: string }[] }[] }>('/config');
  expect(config.profile.firstName).toBe('Sam');
});

test('2. the agent finds listings and contacts matches within seconds', async ({ demo }) => {
  const contacted = await demo.until(async () => {
    const s = await demo.api<{ counts: { contactedToday: number } }>('/status');
    return s.counts.contactedToday >= 2 ? s.counts.contactedToday : undefined;
  }, 'the first messages', 60_000);
  expect(contacted).toBeGreaterThanOrEqual(2);
  await page.goto(`${demo.url}/`);
  await shot('07-inbox');
});

/* ---------- helpers over the sandbox and the API ---------- */

interface SbListing { id: string; title: string; street: string; houseNumber: string }
interface SbSubmission { id: string; listingId: string | null; messages: { from?: string; author?: string; text?: string; body?: string; attachments?: unknown[] }[]; viewingConfirmed?: boolean }
interface Task { id: string; kind: string; title: string; state: string; priority: number; propertyId?: string; payload?: Record<string, unknown> }

type D = import('../fixtures/demo.js').Demo;

const addListing = (demo: D, input: Record<string, unknown> = {}) => demo.control<SbListing>('/listings', { body: input });
const submissions = async (demo: D) => (await demo.control<{ submissions: SbSubmission[] }>('/submissions')).submissions;
const submissionFor = (demo: D, listingId: string, ms = 30_000) =>
  demo.until(async () => (await submissions(demo)).find((s) => s.listingId === listingId), `a message about ${listingId}`, ms);
const tasks = async (demo: D) => (await demo.api<{ items: Task[] }>('/tasks')).items;
const taskOf = (demo: D, kind: string, ms = 30_000) => demo.until(async () => (await tasks(demo)).find((t) => t.kind === kind && t.state === 'open'), `an open ${kind} task`, ms);
const agentMessages = (s: SbSubmission) => s.messages.filter((m) => (m.from ?? m.author) === 'agent');

async function pressInboxAction(demo: D, task: Task, button: string) {
  await page.goto(`${demo.url}/`);
  const item = page.locator(`article[data-task="${task.id}"]`);
  await expect(item).toBeVisible();
  await item.click();
  await item.getByRole('button', { name: button, exact: true }).click();
  // Actions wait behind a five-second undo toast before they are sent.
  await demo.until(async () => (await tasks(demo)).every((t) => t.id !== task.id), `task ${task.kind} to be resolved`, 20_000);
}

test('3. the same home on two sites is contacted once', async ({ demo }) => {
  await demo.control('/auto-reply', { body: { enabled: false } });
  const a = await addListing(demo, {});
  await submissionFor(demo, a.id);
  const dup = await addListing(demo, { duplicateOf: a.id });
  await demo.until(async () => {
    const props = await demo.api<{ items: { listings: { sourceId: string; title: string; url: string; address: { street?: string } }[] }[] }>('/properties?limit=200');
    return props.items.find(
      (p) => new Set(p.listings.map((l) => l.sourceId)).size === 2 && p.listings.every((l) => (l.address.street ?? l.title).toLowerCase().includes(a.street.toLowerCase())),
    );
  }, `the duplicate of ${a.street} ${a.houseNumber} to join the first listing`, 30_000);
  await page.waitForTimeout(3000);
  expect((await submissions(demo)).filter((s) => s.listingId === dup.id)).toHaveLength(0);
});

test('4. a scam listing is never contacted', async ({ demo }) => {
  const scam = await addListing(demo, { scenario: 'scam' });
  await demo.until(async () => {
    const events = await demo.api<{ items: { type: string; summary: string }[] }>('/activity?limit=200');
    return events.items.find((e) => e.type === 'property.scam');
  }, 'the scam to be flagged');
  await page.waitForTimeout(3000);
  expect((await submissions(demo)).filter((s) => s.listingId === scam.id)).toHaveLength(0);
});

let viewingHome: SbListing;
let viewingSub: SbSubmission;

test('5. viewing slots from the landlord become a booked viewing, confirmed in the inbox and in the calendar', async ({ demo }) => {
  viewingHome = await addListing(demo, {});
  viewingSub = await submissionFor(demo, viewingHome.id);
  await demo.control(`/submissions/${viewingSub.id}/reply`, { body: { kind: 'viewing_slots' } });
  const viewing = await demo.until(async () => (await demo.api<{ items: { id: string; startsAt: string; state: string }[] }>('/viewings')).items.find((v) => v.state === 'booked' && !viewingIds.has(v.id)), 'a booked viewing', 40_000);
  viewingIds.add(viewing.id);
  await demo.until(async () => (await demo.control<SbSubmission>(`/submissions/${viewingSub.id}`)).viewingConfirmed, 'the confirmation to reach the landlord', 20_000);
  const task = await taskOf(demo, 'viewing_booked');
  await shot('08-inbox-viewing');
  await pressInboxAction(demo, task, 'Confirm');
  const ics = await (await fetch(`${demo.url}/calendar.ics?token=${demo.token}`)).text();
  expect(ics).toContain(`UID:${viewing.id}@nl-property-finder`);
});
const viewingIds = new Set<string>();

test('6. documents: a private document waits for approval, then goes out', async ({ demo }) => {
  const res = await page.request.post(`${demo.url}/api/v1/documents`, {
    headers: { 'x-nlpf-token': demo.token },
    multipart: { file: { name: 'loonstrook-augustus.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% payslip\n') }, sensitivity: 'private', kind: 'payslip' },
  });
  expect(res.ok()).toBe(true);
  const home = await addListing(demo, {});
  const sub = await submissionFor(demo, home.id);
  const before = agentMessages(sub).length;
  await demo.control(`/submissions/${sub.id}/reply`, { body: { kind: 'documents_request' } });
  const task = await taskOf(demo, 'documents_approval', 40_000);
  await shot('09-inbox-documents');
  await pressInboxAction(demo, task, 'Approve and send');
  const after = await demo.until(async () => {
    const s = await demo.control<SbSubmission>(`/submissions/${sub.id}`);
    return agentMessages(s).length > before ? s : undefined;
  }, 'the documents to reach the landlord', 20_000);
  expect(JSON.stringify(after)).toContain('loonstrook-augustus');
});

test('7. a deposit asked before any viewing is a warning, and nothing is answered', async ({ demo }) => {
  const home = await addListing(demo, {});
  const sub = await submissionFor(demo, home.id);
  const before = agentMessages(sub).length;
  await demo.control(`/submissions/${sub.id}/reply`, { body: { kind: 'payment_request' } });
  const task = await taskOf(demo, 'payment_warning', 40_000);
  expect(task.priority).toBe(1);
  await page.waitForTimeout(3000);
  expect(agentMessages(await demo.control<SbSubmission>(`/submissions/${sub.id}`)).length).toBe(before);
  await page.goto(`${demo.url}/`);
  await expect(page.locator(`article[data-task="${task.id}"]`)).toContainText('Warning');
  await shot('10-inbox-warning');
});

test('8. pause keeps reading but sends nothing; resume sends', async ({ demo }) => {
  await page.goto(`${demo.url}/`);
  await page.getByRole('button', { name: 'Pause' }).first().click();
  await demo.until(async () => (await demo.api<{ paused: boolean }>('/status')).paused, 'the agent to pause');
  const home = await addListing(demo, {});
  await demo.until(async () => {
    const events = await demo.api<{ items: { type: string; data: { listingId?: string } }[] }>('/activity?limit=100');
    return events.items.find((e) => e.type === 'listing.new' && String(e.data.listingId ?? '').endsWith(home.id));
  }, 'the new listing to be seen while paused', 30_000);
  await page.waitForTimeout(4000);
  expect((await submissions(demo)).filter((s) => s.listingId === home.id)).toHaveLength(0);
  await page.getByRole('button', { name: 'Resume' }).first().click();
  await submissionFor(demo, home.id, 30_000);
});

test('9. a site that blocks the agent is shown, and recovers', async ({ demo }) => {
  await demo.control('/blocked', { body: { source: 'huisje', blocked: true } });
  await demo.api('/sources/huisje/poll', { method: 'POST' });
  await demo.until(async () => {
    const s = await demo.api<{ items: { sourceId: string; lastError?: string }[] }>('/sources');
    return s.items.find((x) => x.sourceId === 'huisje' && /blocked/i.test(x.lastError ?? ''));
  }, 'the block to show', 30_000);
  await page.goto(`${demo.url}/sources`);
  await expect(page.getByText(/blocked/i).first()).toBeVisible();
  await shot('11-sources-blocked');
  await demo.control('/blocked', { body: { source: 'huisje', blocked: false } });
  await demo.api('/sources/huisje/poll', { method: 'POST' });
  await demo.until(async () => {
    const s = await demo.api<{ items: { sourceId: string; health: string; lastError?: string }[] }>('/sources');
    return s.items.find((x) => x.sourceId === 'huisje' && x.health === 'ok' && !x.lastError);
  }, 'the source to recover', 30_000);
});

test('10. approve mode asks first, and one click sends', async ({ demo }) => {
  const cfg = await demo.api<{ automation: Record<string, unknown> }>('/config');
  await demo.api('/config', { method: 'PATCH', body: { section: 'automation', value: { ...cfg.automation, mode: 'approve' } } });
  const home = await addListing(demo, {});
  const task = await taskOf(demo, 'approve_outreach', 40_000);
  expect((await submissions(demo)).filter((s) => s.listingId === home.id)).toHaveLength(0);
  await pressInboxAction(demo, task, 'Approve and send');
  await submissionFor(demo, home.id, 30_000);
  await demo.api('/config', { method: 'PATCH', body: { section: 'automation', value: { ...cfg.automation, mode: 'auto' } } });
});

test('11. an offer with a three-month deposit shows the contract review', async ({ demo }) => {
  await demo.control(`/submissions/${viewingSub.id}/reply`, { body: { kind: 'offer' } });
  const task = await taskOf(demo, 'offer_or_contract', 40_000);
  await page.goto(`${demo.url}/`);
  const item = page.locator(`article[data-task="${task.id}"]`);
  await expect(item).toBeVisible();
  await item.click();
  await expect(item).toContainText(/deposit|waarborg/i);
  await shot('12-inbox-offer');
});

test('12. I found a place withdraws the open applications and pauses', async ({ demo }) => {
  const before = await submissions(demo);
  await page.goto(`${demo.url}/applications`);
  await shot('13-applications');
  await page.getByRole('button', { name: 'I found a place' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'I found a place' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Its address (optional)').fill(`${viewingHome.street} ${viewingHome.houseNumber}`);
  await dialog.getByRole('button', { name: /^Withdraw \d+ application/ }).click();
  await demo.until(async () => (await demo.api<{ paused: boolean }>('/status')).paused, 'the agent to pause after withdrawing', 20_000);
  await demo.until(async () => {
    const now = await submissions(demo);
    return now.some((s) => agentMessages(s).length > agentMessages(before.find((b) => b.id === s.id) ?? { messages: [] } as never).length && /withdraw|intrek|andere woning|another home/i.test(JSON.stringify(agentMessages(s).at(-1))));
  }, 'a withdrawal to reach a landlord', 20_000);
  const kept = await demo.control<SbSubmission>(`/submissions/${viewingSub.id}`);
  expect(/another home|andere woning/i.test(JSON.stringify(agentMessages(kept).at(-1)))).toBe(false);
});

test('13. every page in both themes', async ({ demo }) => {
  test.skip(!shots, 'screenshots only when NLPF_SHOTS is set');
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [path, name] of [['/', 'inbox'], ['/overview', 'overview'], ['/properties', 'properties'], ['/applications', 'applications'], ['/conversations', 'conversations'], ['/viewings', 'viewings'], ['/sources', 'sources'], ['/search', 'search'], ['/profile', 'profile'], ['/automation', 'automation'], ['/settings', 'settings']] as const) {
      await page.goto(`${demo.url}${path}`);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${shots}/page-${name}-${theme}.png` });
    }
  }
});

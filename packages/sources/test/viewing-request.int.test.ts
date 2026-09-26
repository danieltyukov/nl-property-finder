import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ConfigSchema, memoryLogger, type Listing, type OutboundMessage } from '@nlpf/core';
import { checkPortalSession, requestViewing, type ViewingRequestPortal } from '../src/generic/viewing-request.js';
import { NeedsLoginError } from '../src/runtime/errors.js';
import { createBrowserPool, createPoliteFetch, createSourceContext, resolveChromium, type BrowserPool } from '../src/index.js';
import { startFixtureServer, type FixtureServer } from '../src/testing.js';

const config = ConfigSchema.parse({
  profile: {
    firstName: 'Sam', lastName: 'de Vries', email: 'sam+huur@nlpf.test', phone: '+31 6 1234 5678', salutation: 'dhr',
    birthDate: '2001-03-09', occupation: 'employed', incomeMonthlyGrossEur: 3200, moveInFrom: '2026-01-01',
    address: { street: 'Oude Delft', houseNumber: '12', addition: 'A', postcode: '2611 BC', city: 'Delft' },
  },
});

/*
 * A stand-in for the MVGM and Vesteda viewing-request portal, modelled on the
 * live form read on 2026-09-26: one form, one visible step at a time, "Opslaan
 * en volgende" checks the step's required fields and shows the next step,
 * "Verstuur formulier" posts and opens /mijnwoning/. The portal remembers a
 * previous application: roepnaam, achternaam, e-mail and (on "known") the
 * savings answer come prefilled. On "fresh" nobody answered the savings
 * question yet, which the profile does not know either.
 */
function portalPage(opts: { savingsKnown: boolean }): string {
  const radio = (name: string, values: string[], checked?: string) =>
    values.map((v) => `<label><input type="radio" name="${name}" value="${v}"${v === checked ? ' checked' : ''}> ${v}</label>`).join('');
  return `<!doctype html><html lang="nl"><head><title>Aanvraag bezichtigingsafspraak</title></head><body>
<a href="/logout/">Uitloggen</a>
<h1>Aanvraag bezichtigingsafspraak: Oude Delft 12A</h1>
<form id="f" onsubmit="return false">
<div role="tabpanel" id="naw" data-required="a_achternaam a_geboortedatum a_postcode a_huisnummer a_straat a_woonplaats a_telefoon a_wanneerhuren a_samenhuren">
  ${radio('a_geslacht', ['M', 'V', 'O'])}
  <input name="a_roepnaam" value="Sam"><input name="a_voorletters"><input name="a_achternaam" value="de Vries">
  <input name="a_geboortedatum"><input name="a_postcode"><input name="a_huisnummer"><input name="a_huisnummertoevoeging">
  <input name="a_straat"><input name="a_woonplaats"><input name="a_telefoon"><input name="a_email" value="account@nlpf.test">
  <select name="a_wanneerhuren"><option value="">-Selecteer-</option><option value="direct">Per direct</option><option value="2026-10">oktober 2026</option></select>
  ${radio('a_samenhuren', ['Alleen', 'Samen'])}
  <button type="button" class="next">Opslaan en volgende</button>
</div>
<div role="tabpanel" id="woonwerk" hidden data-required="gez_pers a_werksituatie a_spaargeld_jn a_maandinkomen">
  <select name="gez_pers"><option value="">-</option><option value="1">1</option><option value="2">2</option></select>
  <select name="gez_kind"><option value="0">0</option><option value="1">1</option></select>
  ${radio('a_werksituatie', ['Loondienst', 'Zelfstandig', 'Geen'])}
  ${radio('a_spaargeld_jn', ['Ja', 'Nee'], opts.savingsKnown ? 'Ja' : undefined)}
  <input name="a_maandinkomen">
  <button type="button" class="next">Opslaan en volgende</button>
</div>
<div role="tabpanel" id="documenten" hidden data-required="">
  <input type="file" name="ident_a"><button type="button" class="next">Opslaan en volgende</button>
</div>
<div role="tabpanel" id="verklaring" hidden>
  <textarea name="AlgemeneOpmerking"></textarea>
  <label><input type="checkbox" name="akkoord_a"> Ik ga akkoord</label>
  <button type="button" class="send">Verstuur formulier</button>
</div>
</form>
<script>
const form = document.getElementById('f');
const value = (n) => { const els = form.querySelectorAll('[name="' + n + '"]'); if (!els.length) return ''; if (els[0].type === 'radio') { const c = [...els].find((e) => e.checked); return c ? c.value : ''; } return els[0].value; };
for (const b of form.querySelectorAll('.next')) b.addEventListener('click', () => {
  const panel = b.closest('[role=tabpanel]');
  panel.querySelectorAll('.invalid-feedback').forEach((e) => e.remove());
  const missing = (panel.dataset.required || '').split(' ').filter(Boolean).filter((n) => !value(n));
  if (missing.length) { for (const n of missing) { const d = document.createElement('div'); d.className = 'invalid-feedback'; d.textContent = 'Vul ' + n + ' in'; panel.append(d); } return; }
  const next = panel.nextElementSibling; panel.hidden = true; next.hidden = false; location.hash = next.id;
});
form.querySelector('.send').addEventListener('click', async () => {
  const data = {}; for (const el of form.elements) { if (!el.name || el.type === 'file') continue; if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) continue; data[el.name] = el.value; }
  await fetch('/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  location.href = '/mijnwoning/';
});
</script></body></html>`;
}

describe.skipIf(!resolveChromium())('viewing request portal in a real browser', () => {
  let server: FixtureServer;
  let pool: BrowserPool;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'nlpf-portal-'));
    pool = createBrowserPool({ dir, log: memoryLogger() });
    server = await startFixtureServer({
      '/bezichtigingsaanvraag/known/': { body: portalPage({ savingsKnown: true }) },
      '/bezichtigingsaanvraag/fresh/': { body: portalPage({ savingsKnown: false }) },
      '/bezichtigingsaanvraag/loggedout/': { status: 302, headers: { location: '/inloggen/' } },
      '/loggedout-portal/mijnwoning/': { status: 302, headers: { location: '/inloggen/' } },
      '/inloggen/': { body: '<!doctype html><title>Inloggen</title><form><input name="email"><input type="password" name="pw"></form>' },
      '/mijnwoning/': { body: '<!doctype html><title>Mijn reacties</title><a href="/logout/">Uitloggen</a><p>Oude Delft 12A. Uw interesse staat genoteerd.</p>' },
      'POST /submit': { body: { ok: true } },
    });
  });

  afterAll(async () => {
    await pool.closeAll();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const portal = (): ViewingRequestPortal => ({ name: 'MVGM', base: server.url, requestPath: (l) => `/bezichtigingsaanvraag/${l.externalId}/` });
  function setup(id: string) {
    const ctx = createSourceContext({
      fetch: createPoliteFetch({ minGapMs: 0, log: memoryLogger() }),
      pool,
      log: memoryLogger(),
      config,
      sourceId: 'mvgm',
      signal: new AbortController().signal,
    });
    const listing = { id: `mvgm:${id}`, sourceId: 'mvgm', externalId: id, url: `${server.url}/object/${id}/`, title: 'Oude Delft 12A', address: { city: 'Delft' }, contact: 'form' } as unknown as Listing;
    const message = (dryRun: boolean): OutboundMessage => ({ body: 'Beste verhuurder, graag kom ik kijken.', language: 'nl', profile: config.profile, dryRun });
    return { ctx, listing, message };
  }
  const posts = () => server.requests.filter((r) => r.method === 'POST' && r.path === '/submit');

  test('fills the empty fields from the profile, keeps what the portal remembered, agrees and sends', async () => {
    const { ctx, listing, message } = setup('known');
    const result = await requestViewing(portal(), listing, message(false), ctx);
    expect(result).toMatchObject({ ok: true, channel: 'form' });
    expect(result.evidence).toMatch(/genoteerd|mijnwoning/);
    const sent = JSON.parse(posts().at(-1)?.body ?? '{}') as Record<string, string>;
    expect(sent).toMatchObject({
      a_geslacht: 'M', a_voorletters: 'S.', a_geboortedatum: '09-03-2001', a_postcode: '2611BC', a_huisnummer: '12',
      a_huisnummertoevoeging: 'A', a_straat: 'Oude Delft', a_woonplaats: 'Delft', a_telefoon: '0612345678',
      a_wanneerhuren: 'direct', a_samenhuren: 'Alleen', gez_pers: '1', a_werksituatie: 'Loondienst', a_maandinkomen: '3200',
      AlgemeneOpmerking: 'Beste verhuurder, graag kom ik kijken.', akkoord_a: 'on',
    });
    // Answers the portal remembered stay as the person left them.
    expect(sent).toMatchObject({ a_roepnaam: 'Sam', a_achternaam: 'de Vries', a_email: 'account@nlpf.test', a_spaargeld_jn: 'Ja' });
  });

  test('a question neither the profile nor the portal answers goes to the person, with what was asked', async () => {
    const { ctx, listing, message } = setup('fresh');
    const before = posts().length;
    const result = await requestViewing(portal(), listing, message(false), ctx);
    expect(result).toMatchObject({ ok: false, channel: 'form', needs: 'human' });
    expect(result.error).toContain('a_spaargeld_jn');
    expect(posts().length).toBe(before);
  });

  test('a dry run fills the first step and saves nothing', async () => {
    const { ctx, listing, message } = setup('known');
    const before = posts().length;
    expect(await requestViewing(portal(), listing, message(true), ctx)).toMatchObject({ ok: true, evidence: expect.stringContaining('dry run') });
    expect(posts().length).toBe(before);
  });

  test('a login redirect is NeedsLoginError, and the session check tells logged in from logged out', async () => {
    const { ctx, listing, message } = setup('loggedout');
    await expect(requestViewing(portal(), listing, message(false), ctx)).rejects.toBeInstanceOf(NeedsLoginError);
    const session = await ctx.browser();
    try {
      expect(await checkPortalSession(session.page, portal())).toBe('ok');
      expect(await checkPortalSession(session.page, { ...portal(), base: `${server.url}/loggedout-portal` })).toBe('none');
    } finally {
      await session.close();
    }
  });
});

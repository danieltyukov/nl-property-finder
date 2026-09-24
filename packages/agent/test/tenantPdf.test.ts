import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from 'vitest';
import { renderTenantProfilePdf } from '../src/tenantPdf.js';
import { pdfText, png, profile } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'nlpf-profile-'));

const sam = profile({
  occupation: 'phd', organisation: 'TU Delft', moveInFrom: '2026-11-01', stayMonths: 24, languages: ['en', 'nl'],
  about: 'I am a quiet PhD researcher in aerospace engineering. I cook, cycle and keep a tidy home.',
  guarantor: { relation: 'parent', incomeMonthlyGrossEur: 6000 }, incomeMonthlyGrossEur: 3100,
});

test('renders one A4 page with the person and the plan', async () => {
  const out = join(dir, 'sam.pdf');
  await renderTenantProfilePdf(sam, out);
  const bytes = readFileSync(out);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  const { width, height } = doc.getPage(0).getSize();
  expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  const [page] = await pdfText(bytes);
  for (const s of ['Sam de Vries', 'TU Delft', 'PhD', '1 November 2026', '24 months', 'quiet PhD researcher']) expect(page).toContain(s);
  // Income figures are private documents; the public profile does not print them.
  expect(page).not.toContain('3100');
  expect(page).not.toContain('6000');
});

test('Dutch labels when the profile writes in Dutch', async () => {
  const out = join(dir, 'sam-nl.pdf');
  await renderTenantProfilePdf({ ...sam, messageLanguage: 'nl' }, out);
  const [page] = await pdfText(readFileSync(out));
  expect(page).toContain('HUURDERSPROFIEL');
  expect(page).toContain('Promovendus (PhD)');
  expect(page).toContain('1 november 2026');
});

test('a very long introduction still fits on one page', async () => {
  const out = join(dir, 'long.pdf');
  await renderTenantProfilePdf({ ...sam, about: 'Rustige huurder. '.repeat(600) }, out);
  expect((await PDFDocument.load(readFileSync(out))).getPageCount()).toBe(1);
});

test('a photo is used only when the file exists', async () => {
  const missing = join(dir, 'nophoto.pdf');
  await renderTenantProfilePdf({ ...sam, facts: { photo: join(dir, 'does-not-exist.jpg') } }, missing);
  expect(readFileSync(missing).includes(Buffer.from('/Subtype /Image'))).toBe(false);

  writeFileSync(join(dir, 'me.png'), png(80, 100));
  const withPhoto = join(dir, 'photo.pdf');
  await renderTenantProfilePdf({ ...sam, facts: { photo: join(dir, 'me.png') } }, withPhoto);
  expect(readFileSync(withPhoto).includes(Buffer.from('/Subtype /Image'))).toBe(true);
});

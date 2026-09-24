import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, expect, test } from 'vitest';
import { stampLine, watermarkDocument } from '../src/watermark.js';
import { pdfText } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'nlpf-watermark-'));
const input = { recipient: 'Delft Rentals', address: 'Oude Delft 12A, Delft', date: '2026-09-24' };
const STAMP = 'Alleen voor huuraanvraag Oude Delft 12A, Delft, Delft Rentals, 2026-09-24';

/** A small grey RGB PNG, written by hand so the test needs no image library. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xc8)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText('Loonstrook augustus', { x: 50, y: 700, size: 14, font });
  writeFileSync(join(dir, 'payslip.pdf'), await doc.save());

  const two = await PDFDocument.create();
  two.addPage();
  two.addPage([400, 300]);
  writeFileSync(join(dir, 'two.pdf'), await two.save());

  writeFileSync(join(dir, 'passport.png'), png(60, 40));
});

test('the stamp line names address, recipient and date', () => {
  expect(stampLine(input)).toBe(STAMP);
  expect(stampLine({ recipient: 'Jan', date: '2026-09-24' })).toBe('Alleen voor huuraanvraag, Jan, 2026-09-24');
});

test('a one-page PDF gets the stamp in its text layer', async () => {
  const out = join(dir, 'payslip.stamped.pdf');
  await watermarkDocument({ path: join(dir, 'payslip.pdf'), ...input }, out);
  const pages = await pdfText(readFileSync(out));
  expect(pages).toHaveLength(1);
  expect(pages[0]).toContain(STAMP);
  expect(pages[0]).toContain('Loonstrook augustus');
});

test('every page of a longer PDF is stamped', async () => {
  const out = join(dir, 'two.stamped.pdf');
  await watermarkDocument({ path: join(dir, 'two.pdf'), ...input }, out);
  const pages = await pdfText(readFileSync(out));
  expect(pages).toHaveLength(2);
  for (const p of pages) expect(p).toContain(STAMP);
});

test('a PNG is placed on an A4 page and stamped', async () => {
  const out = join(dir, 'passport.stamped.pdf');
  await watermarkDocument({ path: join(dir, 'passport.png'), ...input }, out);
  const bytes = readFileSync(out);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  const { width, height } = doc.getPage(0).getSize();
  expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  expect(bytes.includes(Buffer.from('/Subtype /Image'))).toBe(true);
  expect((await pdfText(bytes))[0]).toContain(STAMP);
});

test('characters outside the standard font are replaced, not fatal', async () => {
  const out = join(dir, 'unicode.pdf');
  await watermarkDocument({ path: join(dir, 'payslip.pdf'), recipient: 'Łukasz 李', address: 'Café Straße 1', date: '2026-09-24' }, out);
  expect((await pdfText(readFileSync(out)))[0]).toContain('Alleen voor huuraanvraag Café Straße 1, Lukasz ?, 2026-09-24');
});

test('other file types are refused', async () => {
  writeFileSync(join(dir, 'notes.txt'), 'hello');
  await expect(watermarkDocument({ path: join(dir, 'notes.txt'), ...input }, join(dir, 'x.pdf'))).rejects.toThrow(/PDF, PNG or JPEG/);
});

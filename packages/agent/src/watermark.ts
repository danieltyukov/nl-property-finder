import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees, grayscale, type PDFFont, type PDFPage } from 'pdf-lib';

export interface WatermarkInput {
  path: string;
  recipient: string;
  address?: string;
  date: string;
}

/** "Alleen voor huuraanvraag <address>, <recipient>, <date>" ("only for a rental application ..."). */
export function stampLine(input: Omit<WatermarkInput, 'path'>): string {
  const head = input.address ? `Alleen voor huuraanvraag ${input.address}` : 'Alleen voor huuraanvraag';
  return `${head}, ${input.recipient}, ${input.date}`.replace(/\s+/g, ' ').trim();
}

const A4: [number, number] = [595.28, 841.89];
const LETTERS: Record<string, string> = { Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', ı: 'i', Ħ: 'H', ħ: 'h' };

/** Keeps what the standard Helvetica can encode (WinAnsi); folds or replaces the rest. */
function encodable(text: string, font: PDFFont): string {
  let out = '';
  for (const ch of text) {
    const candidates = [ch, LETTERS[ch] ?? '', ch.normalize('NFD').replace(/[̀-ͯ]/g, '')];
    const ok = candidates.find((c) => {
      if (!c) return false;
      try {
        font.encodeText(c);
        return true;
      } catch {
        return false;
      }
    });
    out += ok ?? '?';
  }
  return out;
}

function stampPage(page: PDFPage, text: string, font: PDFFont): void {
  const { width, height } = page.getSize();
  const diagonal = Math.hypot(width, height);
  const size = Math.max(8, Math.min(32, (0.8 * diagonal * 12) / font.widthOfTextAtSize(text, 12)));
  const textWidth = font.widthOfTextAtSize(text, size);
  const angle = Math.atan2(height, width);
  const [cx, cy] = [width / 2, height / 2];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const half = font.heightAtSize(size) / 2;
  page.drawText(text, {
    x: cx - (textWidth / 2) * cos + half * sin,
    y: cy - (textWidth / 2) * sin - half * cos,
    size,
    font,
    rotate: degrees((angle * 180) / Math.PI),
    color: grayscale(0.35),
    opacity: 0.35,
  });
  // A small upright copy along the bottom edge stays readable when the page is cropped.
  const footSize = Math.max(6, Math.min(9, ((width - 40) * 9) / font.widthOfTextAtSize(text, 9)));
  page.drawText(text, { x: 20, y: 12, size: footSize, font, color: grayscale(0.25), opacity: 0.8 });
}

/**
 * Stamps "Alleen voor huuraanvraag <address>, <recipient>, <date>" across
 * every page, diagonally and once more along the bottom edge, so a copy of
 * an identity or income document is useless for anything but this one
 * application. A PNG or JPEG is first placed on an A4 page.
 */
export async function watermarkDocument(input: WatermarkInput, out: string): Promise<void> {
  const bytes = await readFile(input.path);
  const isPdf = bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  const isPng = bytes[0] === 0x89 && bytes.subarray(1, 4).toString('latin1') === 'PNG';
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;

  let doc: PDFDocument;
  if (isPdf) {
    doc = await PDFDocument.load(bytes);
  } else if (isPng || isJpeg) {
    doc = await PDFDocument.create();
    const image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = doc.addPage(A4);
    const margin = 40;
    const scale = Math.min((A4[0] - 2 * margin) / image.width, (A4[1] - 2 * margin) / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
  } else {
    throw new Error(`cannot watermark ${input.path}: expected a PDF, PNG or JPEG file`);
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = encodable(stampLine(input), font);
  for (const page of doc.getPages()) stampPage(page, text, font);
  await writeFile(out, await doc.save());
}

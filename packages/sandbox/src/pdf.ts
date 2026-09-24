/**
 * A small PDF writer for the contracts landlords attach to an offer. It
 * writes an uncompressed PDF 1.4 with the standard Helvetica fonts, one text
 * line per `Tj`, so any PDF reader (and the rules contract check, after a
 * plain text extraction) can read every sentence. The file is pure ASCII:
 * characters outside ASCII are written as WinAnsi octal escapes.
 */

export interface PdfLine {
  text: string;
  bold?: boolean;
  /** Font size in points. Default 10. */
  size?: number;
  /** Extra space above the line, in points. */
  gap?: number;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;

/** WinAnsi codes for the few characters above Latin-1 that Dutch contracts use. */
const WIN_ANSI: Record<string, number> = {
  '\u20ac': 0x80,
  '\u2018': 0x91,
  '\u2019': 0x92,
  '\u201c': 0x93,
  '\u201d': 0x94,
};

function escapeText(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`;
    else if (code >= 32 && code < 127) out += ch;
    else {
      const win = WIN_ANSI[ch] ?? (code >= 0xa0 && code <= 0xff ? code : 63);
      out += `\\${win.toString(8).padStart(3, '0')}`;
    }
  }
  return out;
}

/** Splits a paragraph into lines of at most `max` characters, at spaces. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** Builds the PDF. Long lines are wrapped; pages are added as needed. */
export function makePdf(title: string, lines: PdfLine[]): Buffer {
  type Placed = { text: string; font: 'F1' | 'F2'; size: number; y: number };
  const pages: Placed[][] = [[]];
  let y = PAGE_H - MARGIN;
  for (const l of lines) {
    const size = l.size ?? 10;
    const lead = size * 1.45;
    const max = Math.floor((PAGE_W - 2 * MARGIN) / (size * 0.52));
    y -= l.gap ?? 0;
    for (const part of wrap(l.text, max)) {
      if (y - lead < MARGIN) {
        pages.push([]);
        y = PAGE_H - MARGIN;
      }
      y -= lead;
      pages[pages.length - 1]!.push({ text: part, font: l.bold ? 'F2' : 'F1', size, y: Math.round(y) });
    }
  }

  // Objects: 1 catalog, 2 page tree, 3 and 4 fonts, 5 info, then a page and its content per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = `<< /Title (${escapeText(title)}) /Producer (nl-property-finder sandbox) >>`;
  pages.forEach((placed, i) => {
    const content = placed
      .map((p) => `BT /${p.font} ${p.size} Tf ${MARGIN} ${p.y} Td (${escapeText(p.text)}) Tj ET`)
      .join('\n');
    const pageId = pageIds[i]!;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const WIN_ANSI_BACK = Object.fromEntries(Object.entries(WIN_ANSI).map(([ch, code]) => [code, ch]));

/** The text of a PDF written by `makePdf`, one line per `Tj`. Enough for this sandbox's own files. */
export function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const lines: string[] = [];
  for (const m of raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    lines.push(
      (m[1] ?? '').replace(/\\([0-7]{3}|.)/g, (_, esc: string) => {
        if (esc.length === 3) {
          const code = parseInt(esc, 8);
          return WIN_ANSI_BACK[code] ?? String.fromCharCode(code);
        }
        return esc;
      }),
    );
  }
  return lines.join('\n');
}

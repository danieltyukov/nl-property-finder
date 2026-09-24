/*
 * Shared page furniture for the two fake sites. They stand in for other
 * people's websites, so they do not use the product's design tokens; they
 * use CSS system colours only, which keeps colour literals out of the code
 * and follows the viewer's light or dark setting.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const esc = (s: string | number | undefined): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/** Paragraphs from plain text with blank lines between them. */
export const paragraphs = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

const BASE_CSS = `
:root { color-scheme: light dark; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
body { margin: 0; background: Canvas; color: CanvasText; }
header, footer { padding: 14px 24px; border-bottom: 1px solid GrayText; }
footer { border-bottom: 0; border-top: 1px solid GrayText; color: GrayText; font-size: 0.85rem; }
header a.brand { font-weight: 700; font-size: 1.2rem; text-decoration: none; color: CanvasText; }
header nav { display: inline-flex; gap: 16px; margin-left: 24px; }
main { max-width: 960px; margin: 0 auto; padding: 24px; }
a { color: LinkText; }
img { max-width: 100%; height: auto; color: CanvasText; }
.muted { color: GrayText; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.card { border: 1px solid GrayText; border-radius: 8px; padding: 12px; }
.card img { display: block; width: 100%; aspect-ratio: 4 / 3; margin-bottom: 8px; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
form.stack { display: grid; gap: 10px; max-width: 520px; }
form.stack label { display: grid; gap: 4px; }
input, textarea, select, button { font: inherit; padding: 8px 10px; }
textarea { min-height: 140px; }
.notice { border: 1px solid GrayText; border-radius: 8px; padding: 12px 16px; }
`;

export function page(opts: {
  title: string;
  brand: string;
  home: string;
  nav?: string;
  body: string;
  lang?: string;
  css?: string;
}): string {
  return `<!doctype html>
<html lang="${esc(opts.lang ?? 'nl')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>${BASE_CSS}${opts.css ?? ''}</style>
</head>
<body>
<header><a class="brand" href="${esc(opts.home)}">${esc(opts.brand)}</a>${opts.nav ? `<nav>${opts.nav}</nav>` : ''}</header>
<main>
${opts.body}
</main>
<footer>Fictieve website in de sandbox van nl-property-finder. Alle woningen, adressen en personen zijn verzonnen.</footer>
</body>
</html>`;
}

/**
 * A line drawing of a Dutch gable for listing photos, in `currentColor` with
 * opacities only. The gable shape and the number of windows follow from the
 * listing id, so every listing keeps its own picture.
 */
export function facadeSvg(id: string, n: number): string {
  let h = n * 7919;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const floors = 2 + (h % 3);
  const cols = 2 + ((h >> 3) % 2);
  const stepped = ((h >> 5) & 1) === 1;
  const w = 240;
  const top = 60;
  const floorH = 50;
  const bottom = top + floors * floorH;
  const roof = stepped
    ? `M40 ${top} L40 ${top - 15} L60 ${top - 15} L60 ${top - 30} L90 ${top - 30} L90 ${top - 45} L150 ${top - 45} L150 ${top - 30} L180 ${top - 30} L180 ${top - 15} L200 ${top - 15} L200 ${top} Z`
    : `M40 ${top} Q120 ${top - 70} 200 ${top} Z`;
  const windows: string[] = [];
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const cw = 120 / cols;
      const x = 60 + c * cw + cw * 0.2;
      const y = top + f * floorH + 10;
      const lit = ((h >> (f * 3 + c)) & 3) === 0;
      windows.push(
        `<rect x="${x.toFixed(1)}" y="${y}" width="${(cw * 0.6).toFixed(1)}" height="30" rx="2" fill="currentColor" fill-opacity="${lit ? 0.12 : 0.45}"/>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${bottom + 20}" width="${w * 2}" height="${(bottom + 20) * 2}" role="img" aria-label="Tekening van de gevel">
<rect width="100%" height="100%" fill="currentColor" fill-opacity="0.06"/>
<path d="${roof}" fill="currentColor" fill-opacity="0.7"/>
<rect x="40" y="${top}" width="160" height="${floors * floorH}" fill="currentColor" fill-opacity="0.25"/>
${windows.join('\n')}
<rect x="${w / 2 - 12}" y="${bottom - 36}" width="24" height="36" fill="currentColor" fill-opacity="0.6"/>
<rect x="0" y="${bottom}" width="${w}" height="20" fill="currentColor" fill-opacity="0.35"/>
</svg>`;
}

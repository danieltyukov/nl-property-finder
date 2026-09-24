/**
 * A small, forgiving HTML reader for email bodies. Mail HTML is table soup,
 * often malformed, and always untrusted, so this does not build a DOM: it
 * walks tags and text once and produces lines of visible text together with
 * the links that appear on each line. Alert parsers work on those lines, and
 * `htmlToText` joins them for messages that arrive without a text part.
 */

export interface DocLink {
  href: string;
  text: string;
  images: string[];
}

export interface DocLine {
  text: string;
  /** Indexes into `Doc.links` for every link that has visible content on this line. */
  links: number[];
}

export interface Doc {
  lines: DocLine[];
  links: DocLink[];
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', copy: '©', reg: '®',
  trade: '™', hellip: '...', ndash: '-', mdash: '-', lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"',
  rdquo: '"', bdquo: '"', laquo: '"', raquo: '"', middot: '·', bull: '·', deg: '°', sup2: '²',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï', oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ', szlig: 'ß',
  Eacute: 'É', Euml: 'Ë', Ouml: 'Ö', Uuml: 'Ü', Auml: 'Ä', zwnj: '', zwj: '', shy: '', times: 'x',
};

/** Decodes named and numeric character references. Unknown names are left as they are. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      if (code === 0xa0) return ' ';
      return String.fromCodePoint(code);
    }
    const named = NAMED[ref];
    return named === undefined ? whole : named;
  });
}

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'center', 'dd', 'div', 'dl', 'dt', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const SKIP_CONTENT = new Set(['script', 'style', 'head', 'title', 'noscript', 'template', 'svg', 'xml']);
const TAG = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(raw))) {
    const name = m[1]?.toLowerCase();
    if (!name) continue;
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

const clean = (s: string): string => s.replace(/[\s ​‌‍﻿]+/g, ' ').trim();

export interface ReadHtmlOptions {
  /** Append ` [url]` after a link whose text is not the URL itself, as html-to-text does. */
  linkUrls?: boolean;
}

/** Reads HTML into lines of visible text and the links on each line. */
export function readHtml(html: string, opts: ReadHtmlOptions = {}): Doc {
  const links: DocLink[] = [];
  const lines: DocLine[] = [];
  let buf = '';
  let lineLinks = new Set<number>();
  let current = -1; // index of the open <a>, or -1

  const flush = () => {
    const text = clean(buf);
    if (text || lineLinks.size) lines.push({ text, links: [...lineLinks] });
    buf = '';
    lineLinks = new Set();
  };
  const addText = (raw: string) => {
    const text = decodeEntities(raw);
    if (!text) return;
    buf += text;
    if (current >= 0 && clean(text)) {
      const link = links[current];
      if (link) link.text = clean(`${link.text} ${text}`);
      lineLinks.add(current);
    }
  };

  let pos = 0;
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(html))) {
    if (m.index > pos) addText(html.slice(pos, m.index));
    pos = TAG.lastIndex;
    const name = m[2]?.toLowerCase();
    if (!name) continue; // comment, doctype, CDATA
    const closing = m[1] === '/';
    if (!closing && SKIP_CONTENT.has(name)) {
      // A missing </head> ends at <body>, as browsers do; other skipped elements run to the end.
      const end = new RegExp(name === 'head' ? '</head\\s*>|(?=<body\\b)' : `</${name}\\s*>`, 'ig');
      end.lastIndex = pos;
      const close = end.exec(html);
      pos = close ? close.index + close[0].length : html.length;
      TAG.lastIndex = pos;
      continue;
    }
    if (name === 'a') {
      if (closing) {
        const link = links[current];
        if (opts.linkUrls && link && /^https?:\/\//i.test(link.href) && link.text && link.text !== link.href) {
          buf += ` [${link.href}]`;
        }
        current = -1;
      } else {
        const href = attrs(m[3] ?? '').href?.trim();
        if (href) {
          links.push({ href, text: '', images: [] });
          current = links.length - 1;
        } else {
          current = -1;
        }
      }
      continue;
    }
    if (name === 'img' && current >= 0) {
      const src = attrs(m[3] ?? '').src?.trim();
      if (src) links[current]?.images.push(src);
      lineLinks.add(current);
      continue;
    }
    if (BLOCK.has(name)) flush();
  }
  if (pos < html.length) addText(html.slice(pos));
  flush();
  return { lines, links };
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'()[\]{}]+[^\s<>"'()[\]{}.,;:!?]/g;

/** Reads plain text into the same shape, taking bare URLs as links. */
export function readText(text: string): Doc {
  const links: DocLink[] = [];
  const lines: DocLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line: DocLine = { text: clean(raw), links: [] };
    for (const m of raw.matchAll(URL_IN_TEXT)) {
      links.push({ href: m[0], text: '', images: [] });
      line.links.push(links.length - 1);
    }
    if (line.text || line.links.length) lines.push(line);
  }
  return { lines, links };
}

/** Visible text of an HTML document, one block per line. */
export function htmlToText(html: string): string {
  return readHtml(html, { linkUrls: true })
    .lines.map((l) => l.text)
    .filter(Boolean)
    .join('\n');
}

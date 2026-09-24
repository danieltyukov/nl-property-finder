import { expect, test } from 'vitest';
import { decodeEntities, htmlToText, readHtml, readText } from '../src/html.js';

test('entities, skipped elements and a missing </head> are handled', () => {
  const html = '<html><head><title>x</title><style>p{}</style><body><p>Huur&nbsp;&euro;&#160;950 &amp; borg&#x20AC;</p><script>evil()</script><p>Tot&nbsp;ziens</p></body>';
  expect(htmlToText(html)).toBe('Huur € 950 & borg€\nTot ziens');
  expect(decodeEntities('&unknown; &#0; &#x110000;')).toBe('&unknown; &#0; &#x110000;');
});

test('links keep their text, images and the lines they appear on', () => {
  const doc = readHtml('<div><a href="https://x.test/1"><img src="https://x.test/1.jpg"></a></div><div><a href="https://x.test/1">Kamer</a> te huur</div>');
  expect(doc.links).toEqual([
    { href: 'https://x.test/1', text: '', images: ['https://x.test/1.jpg'] },
    { href: 'https://x.test/1', text: 'Kamer', images: [] },
  ]);
  expect(doc.lines.map((l) => [l.text, l.links])).toEqual([
    ['', [0]],
    ['Kamer te huur', [1]],
  ]);
});

test('plain text splits into paragraphs at blank lines', () => {
  const doc = readText('a\nhttps://x.test/1\n\n\nb\n');
  expect(doc.lines.map((l) => [l.text, l.para, l.links.length])).toEqual([
    ['a', 0, 0],
    ['https://x.test/1', 0, 1],
    ['b', 1, 0],
  ]);
});

test.each([
  ['unclosed declarations', '<!'.repeat(100_000)],
  ['unclosed quoted attributes', '<a href="x'.repeat(50_000)],
  ['unclosed comments', '<!--'.repeat(50_000)],
  ['a link around a huge amount of text', `<a href="https://x.test/">${'<b>woord</b> '.repeat(50_000)}</a>`],
])('hostile HTML (%s) is read in linear time', (_name, html) => {
  const t0 = performance.now();
  readHtml(html);
  expect(performance.now() - t0).toBeLessThan(1000);
});

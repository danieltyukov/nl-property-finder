import type { Notification } from '@nlpf/core';
import { afterEach, expect, test } from 'vitest';
import { callbackData } from '../src/sign.js';
import { createTelegramNotifier, escapeHtml } from '../src/telegram.js';
import { startStub } from './http-stub.js';

const SECRET = 'per-install-secret-for-tests';
const TOKEN = '123456789:AAtesttokenvalueforunittests0000000';
const cfg = { chatId: '987654321', tokenEnv: 'NLPF_TELEGRAM_TOKEN', actions: true };

let stub: Awaited<ReturnType<typeof startStub>> | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const okStub = () =>
  startStub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"result":{"message_id":7}}');
  });

const note = (over: Partial<Notification> = {}): Notification => ({
  title: 'Reply needed <urgent> & quick',
  body: 'Landlord asks: "Do you smoke?" <b>not bold</b>',
  priority: 4,
  ...over,
});

test('sendMessage goes to the bot API with parse_mode HTML and every piece of text escaped', async () => {
  stub = await okStub();
  const tg = createTelegramNotifier(cfg, TOKEN, { apiBase: stub.url });
  expect(tg.id).toBe('telegram');
  await tg.send(note({ url: 'https://example.test/listing?a=1&b="2"' }));
  const req = stub.requests[0]!;
  expect(req.method).toBe('POST');
  expect(req.path).toBe(`/bot${TOKEN}/sendMessage`);
  expect(req.headers['content-type']).toMatch(/^application\/json/);
  expect(JSON.parse(req.body)).toEqual({
    chat_id: '987654321',
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text:
      '<b>Reply needed &lt;urgent&gt; &amp; quick</b>\n' +
      'Landlord asks: &quot;Do you smoke?&quot; &lt;b&gt;not bold&lt;/b&gt;\n' +
      '<a href="https://example.test/listing?a=1&amp;b=&quot;2&quot;">Open</a>',
  });
});

test('task actions become inline buttons with signed callback data; the phone number goes in the text', async () => {
  stub = await okStub();
  const tg = createTelegramNotifier(cfg, TOKEN, { apiBase: stub.url, secret: SECRET });
  await tg.send(
    note({
      title: 'Call now',
      body: 'Strong match',
      taskId: 't_42',
      call: '+31 6 1234 5678',
      actions: [
        { id: 'approve', label: 'Approve' },
        { id: 'dismiss', label: 'Dismiss' },
      ],
    }),
  );
  const payload = JSON.parse(stub.requests[0]!.body);
  // Telegram only allows http(s) and tg:// links on inline buttons, so the number is in the
  // text, where Telegram apps make it tappable.
  expect(payload.text).toBe('<b>Call now</b>\nStrong match\nCall +31 6 1234 5678\n<i>ref t_42</i>');
  expect(payload.reply_markup).toEqual({
    inline_keyboard: [
      [
        { text: 'Approve', callback_data: callbackData(SECRET, 't_42', 'approve') },
        { text: 'Dismiss', callback_data: callbackData(SECRET, 't_42', 'dismiss') },
      ],
    ],
  });
});

test('no buttons without a secret or with actions off; callback data over 64 bytes is dropped', async () => {
  stub = await okStub();
  const withActions = note({ taskId: 't_42', actions: [{ id: 'approve', label: 'Approve' }] });
  await createTelegramNotifier(cfg, TOKEN, { apiBase: stub.url }).send(withActions);
  await createTelegramNotifier({ ...cfg, actions: false }, TOKEN, { apiBase: stub.url, secret: SECRET }).send(withActions);
  await createTelegramNotifier(cfg, TOKEN, { apiBase: stub.url, secret: SECRET }).send(
    note({ taskId: `t_${'x'.repeat(40)}`, actions: [{ id: 'approve', label: 'Approve' }] }),
  );
  expect(stub.requests.map((r) => JSON.parse(r.body).reply_markup)).toEqual([undefined, undefined, undefined]);
});

test('an API error rejects with the description and never with the token', async () => {
  stub = await startStub((_req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' }).end('{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}');
  });
  const tg = createTelegramNotifier(cfg, TOKEN, { apiBase: stub.url });
  const err = await tg.send(note()).catch((e: Error) => e);
  expect(String(err)).toMatch(/chat not found/);
  expect(String(err)).not.toContain(TOKEN);
});

test('escapeHtml covers the characters Telegram HTML needs', () => {
  expect(escapeHtml(`a & b < c > d " e`)).toBe('a &amp; b &lt; c &gt; d &quot; e');
});

import type { ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { memoryLogger, type ActionEvent } from '@nlpf/core';
import { afterEach, describe, expect, test } from 'vitest';
import { createNtfyActionChannel } from '../src/ntfy.js';
import { callbackData, signAction } from '../src/sign.js';
import { createTelegramActionChannel } from '../src/telegram.js';
import { startStub, type Recorded } from './http-stub.js';

const SECRET = 'per-install-secret-for-tests';
const TOKEN = '123456789:AAtesttokenvalueforunittests0000000';

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('condition not met in time');
    await sleep(10);
  }
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe('ntfy action channel', () => {
  async function ntfyStandIn() {
    const streams: ServerResponse[] = [];
    const stub = await startStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ id: `open${streams.length}`, time: 1790000000, event: 'open', topic: 'nlpf-k3x9-actions' })}\n`);
      streams.push(res);
    });
    cleanups.push(stub.close);
    const push = (event: Record<string, unknown>) => streams.at(-1)?.write(`${JSON.stringify(event)}\n`);
    return { stub, streams, push };
  }

  const press = (id: string, body: unknown) => ({
    id,
    time: 1790000123,
    event: 'message',
    topic: 'nlpf-k3x9-actions',
    message: typeof body === 'string' ? body : JSON.stringify(body),
  });

  test('a correctly signed press yields one ActionEvent; forged, malformed and repeated ones yield none', async () => {
    const { stub, streams, push } = await ntfyStandIn();
    const log = memoryLogger();
    const channel = createNtfyActionChannel({ server: stub.url, topic: 'nlpf-k3x9', actions: true }, SECRET, log, {
      backoff: { minMs: 10, maxMs: 50 },
    });
    cleanups.push(() => channel.stop());
    expect(channel.id).toBe('ntfy');
    const events: ActionEvent[] = [];
    await channel.start(async (a) => {
      events.push(a);
    });
    await waitFor(() => streams.length === 1);
    expect(stub.requests[0]!.path).toBe('/nlpf-k3x9-actions/json');

    push(press('m1', { taskId: 't_1', action: 'approve', sig: signAction(SECRET, 't_1', 'approve') }));
    push(press('m1', { taskId: 't_1', action: 'approve', sig: signAction(SECRET, 't_1', 'approve') }));
    push(press('m2', { taskId: 't_1', action: 'dismiss', sig: signAction(SECRET, 't_1', 'approve') }));
    push(press('m3', { taskId: 't_2', action: 'approve', sig: signAction('someone-elses-secret', 't_2', 'approve') }));
    push(press('m4', 'not json at all'));
    push({ id: 'k1', time: 1790000200, event: 'keepalive', topic: 'nlpf-k3x9-actions' });
    await waitFor(() => events.length >= 1);
    await sleep(100);
    expect(events).toEqual([{ taskId: 't_1', action: 'approve', channel: 'ntfy', at: new Date(1790000123 * 1000).toISOString() }]);

    // The stream drops: the channel reconnects and asks for what it missed since the last message.
    streams[0]!.end();
    await waitFor(() => streams.length === 2);
    expect(stub.requests[1]!.path).toBe('/nlpf-k3x9-actions/json?since=m4');
    push(press('m5', { taskId: 't_3', action: 'snooze', sig: signAction(SECRET, 't_3', 'snooze') }));
    await waitFor(() => events.length === 2);
    expect(events[1]).toMatchObject({ taskId: 't_3', action: 'snooze', channel: 'ntfy' });
  });

  test('stop ends the stream and no more events arrive', async () => {
    const { stub, streams, push } = await ntfyStandIn();
    const channel = createNtfyActionChannel({ server: stub.url, topic: 'nlpf-k3x9', actions: true }, SECRET, memoryLogger());
    const events: ActionEvent[] = [];
    await channel.start(async (a) => {
      events.push(a);
    });
    await waitFor(() => streams.length === 1);
    await channel.stop();
    push(press('m1', { taskId: 't_1', action: 'approve', sig: signAction(SECRET, 't_1', 'approve') }));
    await sleep(50);
    expect(events).toEqual([]);
  });
});

describe('Telegram action channel', () => {
  const chat = { id: 987654321, type: 'private' };
  const botMessage = (over: Record<string, unknown> = {}) => ({
    message_id: 7,
    date: 1790000000,
    chat,
    from: { id: 111, is_bot: true, first_name: 'nlpf' },
    text: 'Reply needed\nLandlord asks if you smoke\nref t_7',
    ...over,
  });

  const firstBatch = [
    { update_id: 1, callback_query: { id: 'cq1', from: { id: 987654321 }, message: botMessage(), data: callbackData(SECRET, 't_7', 'approve') } },
    { update_id: 2, callback_query: { id: 'cq2', from: { id: 987654321 }, message: botMessage(), data: `t_7:send_draft:${signAction(SECRET, 't_7', 'approve')}` } },
    { update_id: 3, callback_query: { id: 'cq3', from: { id: 5 }, message: botMessage({ chat: { id: 5, type: 'private' } }), data: callbackData(SECRET, 't_7', 'approve') } },
    {
      update_id: 4,
      message: {
        message_id: 12,
        date: 1790000100,
        chat,
        text: 'Nee, ik rook niet.',
        reply_to_message: botMessage({ reply_markup: { inline_keyboard: [[{ text: 'Approve', callback_data: callbackData(SECRET, 't_7', 'approve') }]] } }),
      },
    },
    { update_id: 5, message: { message_id: 13, date: 1790000200, chat, text: 'Ja, donderdag past.', reply_to_message: botMessage({ text: 'Viewing choice\nref t_8' }) } },
    { update_id: 6, message: { message_id: 14, date: 1790000300, chat, text: 'hello bot' } },
    { update_id: 7, message: { message_id: 15, date: 1790000400, chat: { id: 5, type: 'private' }, text: 'let me in', reply_to_message: botMessage() } },
  ];

  async function telegramStandIn() {
    let polls = 0;
    const stub = await startStub(async (req: Recorded, res) => {
      const reply = (result: unknown): void => {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }));
      };
      if (req.path.endsWith('/getUpdates')) {
        polls++;
        if (polls === 1) return reply(firstBatch);
        await sleep(150); // long polling with nothing new
        return reply([]);
      }
      return reply(true);
    });
    cleanups.push(stub.close);
    return stub;
  }

  test('a signed button press becomes an ActionEvent and is acknowledged; replies to task messages carry the text', async () => {
    const stub = await telegramStandIn();
    const channel = createTelegramActionChannel(
      { chatId: '987654321', tokenEnv: 'NLPF_TELEGRAM_TOKEN', actions: true },
      TOKEN,
      SECRET,
      memoryLogger(),
      { apiBase: stub.url, backoff: { minMs: 10, maxMs: 50 } },
    );
    cleanups.push(() => channel.stop());
    expect(channel.id).toBe('telegram');
    const events: ActionEvent[] = [];
    await channel.start(async (a) => {
      events.push(a);
    });
    await waitFor(() => stub.requests.filter((r) => r.path.endsWith('/getUpdates')).length >= 2);
    await waitFor(() => events.length >= 3);
    await sleep(50);

    expect(events).toEqual([
      { taskId: 't_7', action: 'approve', channel: 'telegram', at: expect.any(String) },
      { taskId: 't_7', action: 'send_draft', text: 'Nee, ik rook niet.', channel: 'telegram', at: new Date(1790000100 * 1000).toISOString() },
      { taskId: 't_8', action: 'send_draft', text: 'Ja, donderdag past.', channel: 'telegram', at: new Date(1790000200 * 1000).toISOString() },
    ]);

    const answers = stub.requests.filter((r) => r.path === `/bot${TOKEN}/answerCallbackQuery`).map((r) => JSON.parse(r.body));
    expect(answers).toEqual([
      { callback_query_id: 'cq1', text: 'Received' },
      { callback_query_id: 'cq2', text: 'Not accepted' },
      { callback_query_id: 'cq3', text: 'Not accepted' },
    ]);

    const polls = stub.requests.filter((r) => r.path === `/bot${TOKEN}/getUpdates`).map((r) => JSON.parse(r.body));
    expect(polls[0]).toEqual({ timeout: 50, allowed_updates: ['message', 'callback_query'] });
    expect(polls[1]).toEqual({ offset: 8, timeout: 50, allowed_updates: ['message', 'callback_query'] });
  });

  test('stop aborts the long poll promptly', async () => {
    const stub = await telegramStandIn();
    const channel = createTelegramActionChannel(
      { chatId: '987654321', tokenEnv: 'NLPF_TELEGRAM_TOKEN', actions: true },
      TOKEN,
      SECRET,
      memoryLogger(),
      { apiBase: stub.url },
    );
    await channel.start(async () => {});
    await waitFor(() => stub.requests.length >= 2);
    const t0 = Date.now();
    await channel.stop();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

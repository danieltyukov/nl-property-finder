import type { Notification } from '@nlpf/core';
import { afterEach, expect, test } from 'vitest';
import { createNtfyNotifier } from '../src/ntfy.js';
import { signAction } from '../src/sign.js';
import { startStub } from './http-stub.js';

const SECRET = 'per-install-secret-for-tests';
let stub: Awaited<ReturnType<typeof startStub>> | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

const note = (over: Partial<Notification> = {}): Notification => ({
  title: 'Viewing booked',
  body: 'Thursday 24 September 18:30',
  priority: 4,
  tags: ['house', 'calendar'],
  url: 'http://127.0.0.1:7431/inbox/t_1',
  ...over,
});

test('posts the body to <server>/<topic> with Title, Priority, Tags and Click headers', async () => {
  stub = await startStub();
  const ntfy = createNtfyNotifier({ server: stub.url, topic: 'nlpf-k3x9q2m7ab', actions: true });
  expect(ntfy.id).toBe('ntfy');
  await ntfy.send(note());
  expect(stub.requests).toHaveLength(1);
  const req = stub.requests[0]!;
  expect(req.method).toBe('POST');
  expect(req.path).toBe('/nlpf-k3x9q2m7ab');
  expect(req.body).toBe('Thursday 24 September 18:30');
  expect(req.headers.title).toBe('Viewing booked');
  expect(req.headers.priority).toBe('4');
  expect(req.headers.tags).toBe('house,calendar');
  expect(req.headers.click).toBe('http://127.0.0.1:7431/inbox/t_1');
  expect(req.headers.actions).toBeUndefined();
});

test('task actions become signed http buttons on <topic>-actions, and a phone number a tel: view button', async () => {
  stub = await startStub();
  const ntfy = createNtfyNotifier({ server: `${stub.url}/`, topic: 'nlpf-k3x9q2m7ab', actions: true }, { secret: SECRET });
  await ntfy.send(
    note({
      taskId: 't_1',
      call: '+31 6 1234 5678',
      actions: [
        { id: 'approve', label: 'Approve' },
        { id: 'dismiss', label: 'Dismiss' },
        { id: 'snooze', label: 'Snooze' },
      ],
    }),
  );
  const target = `${stub.url}/nlpf-k3x9q2m7ab-actions`;
  const body = (action: string) => `{"taskId":"t_1","action":"${action}","sig":"${signAction(SECRET, 't_1', action)}"}`;
  // ntfy shows at most three buttons: the call button first, then the task's first two actions.
  expect(stub.requests[0]!.headers.actions).toBe(
    [
      'view, Call, tel:+31612345678',
      `http, Approve, ${target}, method=POST, body='${body('approve')}', clear=true`,
      `http, Dismiss, ${target}, method=POST, body='${body('dismiss')}', clear=true`,
    ].join('; '),
  );
});

test('without a secret, or with actions turned off, only the call button is added', async () => {
  stub = await startStub();
  const withActions = note({ taskId: 't_1', call: '0612345678', actions: [{ id: 'approve', label: 'Approve' }] });
  await createNtfyNotifier({ server: stub.url, topic: 't1', actions: true }).send(withActions);
  await createNtfyNotifier({ server: stub.url, topic: 't1', actions: false }, { secret: SECRET }).send(withActions);
  expect(stub.requests.map((r) => r.headers.actions)).toEqual(['view, Call, tel:0612345678', 'view, Call, tel:0612345678']);
});

test('labels cannot break the Actions header', async () => {
  stub = await startStub();
  const ntfy = createNtfyNotifier({ server: stub.url, topic: 't1', actions: true }, { secret: SECRET });
  await ntfy.send(note({ taskId: 't_1', actions: [{ id: 'approve', label: "Yes, 'send'; now" }] }));
  expect(stub.requests[0]!.headers.actions).toMatch(/^http, Yes send now, /);
});

test('non-ASCII header values are sent RFC 2047 encoded and the body as UTF-8', async () => {
  stub = await startStub();
  const ntfy = createNtfyNotifier({ server: stub.url, topic: 't1', actions: true });
  await ntfy.send(note({ title: 'Huur € 1.495 in Delft', body: 'Één bezichtiging' }));
  const req = stub.requests[0]!;
  expect(req.headers.title).toBe(`=?UTF-8?B?${Buffer.from('Huur € 1.495 in Delft').toString('base64')}?=`);
  expect(req.body).toBe('Één bezichtiging');
});

test('a server error rejects with the status', async () => {
  stub = await startStub((_req, res) => {
    res.writeHead(429).end('{"error":"limit reached"}');
  });
  const ntfy = createNtfyNotifier({ server: stub.url, topic: 't1', actions: true });
  await expect(ntfy.send(note())).rejects.toThrow(/429/);
});

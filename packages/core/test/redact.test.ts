import { expect, test } from 'vitest';
import { redact, createEventBus, openStore } from '../src/index.js';

test('redact removes known secrets and key-shaped strings deep inside values', () => {
  const out = redact(
    { url: 'https://api.test/?key=supersecretvalue', nested: [{ msg: 'using sk-ant-api03-abcDEF_123-xyz now' }], n: 3 },
    ['supersecretvalue'],
  );
  expect(JSON.stringify(out)).not.toContain('supersecretvalue');
  expect(JSON.stringify(out)).not.toContain('sk-ant-api03');
  expect(out.n).toBe(3);
});

test('the event bus stores then notifies, and a throwing subscriber does not block others', () => {
  const store = openStore(':memory:');
  const bus = createEventBus(store, () => 't');
  const seen: string[] = [];
  bus.subscribe(() => {
    throw new Error('closed socket');
  });
  bus.subscribe((e) => seen.push(e.type));
  bus.emit('daemon.started', 'Started');
  expect(seen).toEqual(['daemon.started']);
  expect(store.events.latest(1)[0]?.summary).toBe('Started');
});

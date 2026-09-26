import { expect, test } from 'vitest';
import type { Task } from '@nlpf/core';
import { taskActions } from './tasks';

const task = (kind: Task['kind'], payload: Record<string, unknown> = {}) =>
  ({ id: 't1', kind, state: 'open', priority: 2, title: 'Send yourself: Oude Delft 12', reason: '', payload, createdAt: '', updatedAt: '' }) as unknown as Task;

test('a captcha item opens the listing to send it by hand, not a login window the source may not have', () => {
  const actions = taskActions(task('captcha', { url: 'https://www.verra.nl/huur/1', draft: 'Beste Verra,' }));
  expect(actions.primary).toMatchObject({ label: 'Mark as sent' });
  expect(actions.link).toEqual({ label: 'Open listing', href: 'https://www.verra.nl/huur/1' });
});

test('a source with nothing sent says why, instead of calling every one watch only', async () => {
  const { noReactionLabel } = await import('./labels');
  const src = (over: Record<string, unknown>) => ({ sourceId: 's', name: 'S', enabled: true, health: 'ok', contactMode: 'auto', capabilities: { contact: 'form' }, ...over }) as never;
  expect(noReactionLabel(src({ enabled: false }))).toBe('switched off');
  expect(noReactionLabel(src({ contactMode: 'watch_only' }))).toBe('watch only');
  expect(noReactionLabel(src({ capabilities: { contact: 'message', paid: { plan: 'x-premium' } } }))).toBe('needs a paid plan');
  expect(noReactionLabel(src({ capabilities: { contact: 'none' } }))).toBe('no automatic contact');
  expect(noReactionLabel(src({}))).toBe('none sent yet');
  expect(noReactionLabel(undefined)).toBe('none sent yet');
});

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

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

test('a question the agent could not draft an answer to starts with writing one, not with sending nothing', () => {
  const actions = taskActions(task('reply_needed', { summary: 'Asks for a viewing time' }));
  expect(actions.primary).toMatchObject({ kind: 'edit', label: 'Write reply' });
  expect(actions.secondary).toEqual([expect.objectContaining({ action: 'done', label: 'Mark answered' })]);
  expect(taskActions(task('reply_needed', { draft: 'Beste,' })).primary).toMatchObject({ action: 'send_draft', label: 'Send reply' });
});

test('a request to confirm the email address offers its link', () => {
  const actions = taskActions(task('confirm_email', { url: 'https://u1.ct.sendgrid.net/ls/click?upn=confirm' }));
  expect(actions.primary).toMatchObject({ action: 'done', label: 'Mark confirmed' });
  expect(actions.link).toEqual({ label: 'Open confirmation link', href: 'https://u1.ct.sendgrid.net/ls/click?upn=confirm' });
  expect(taskActions(task('confirm_email', { url: 'javascript:alert(1)' })).link).toBeUndefined();
});

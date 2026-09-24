import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildWorld } from '../mock/fixtures';
import { makeApi, renderApp } from '../test/helpers';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

test('renders the open tasks from the mock, most pressing first', async () => {
  renderApp();
  await screen.findByRole('heading', { name: /^Viewing booked,/ });
  const titles = screen.getAllByRole('heading', { level: 3 });
  expect(titles[0]?.textContent).toMatch(/^Viewing booked/);
  expect(screen.getByText(/Offer and contract for Kralingse Plaslaan 20/)).toBeTruthy();
  expect(screen.getByText(/Deposit asked before a viewing/)).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nine things need you.');
});

test('pressing A on the first item calls resolveTask with approve and shows the undo toast', async () => {
  const user = userEvent.setup();
  const { api } = renderApp({ undoMs: 80 });
  await screen.findByRole('heading', { name: /^Viewing booked,/ });

  await user.keyboard('a');

  const toasts = screen.getByRole('region', { name: 'Notifications' });
  expect(within(toasts).getByText(/Viewing confirmed: Viewing booked/)).toBeTruthy();
  expect(within(toasts).getByRole('button', { name: 'Undo' })).toBeTruthy();
  await waitFor(() => expect(api.resolveTask).toHaveBeenCalledWith('t_viewing_oudedelft', { action: 'approve' }));
});

test('U undoes the action before it is sent', async () => {
  const user = userEvent.setup();
  const { api } = renderApp({ undoMs: 300 });
  await screen.findByRole('heading', { name: /^Viewing booked,/ });

  await user.keyboard('a');
  expect(screen.queryByRole('heading', { name: /^Viewing booked,/ })).toBeNull();
  await user.keyboard('u');

  expect(await screen.findByRole('heading', { name: /^Viewing booked,/ })).toBeTruthy();
  await new Promise((r) => setTimeout(r, 400));
  expect(api.resolveTask).not.toHaveBeenCalled();
});

test('J moves to the next item and X dismisses it', async () => {
  const user = userEvent.setup();
  const { api } = renderApp({ undoMs: 20 });
  await screen.findByRole('heading', { name: /^Viewing booked,/ });

  await user.keyboard('j');
  await user.keyboard('x');

  await waitFor(() => expect(api.resolveTask).toHaveBeenCalledWith('t_offer_plaslaan', { action: 'dismiss' }));
});

test('every shortcut has a visible button', async () => {
  renderApp();
  await screen.findByRole('heading', { name: /^Viewing booked,/ });
  const first = screen.getAllByRole('article')[0]!;
  for (const [name, key] of [['Confirm', 'A'], ['Dismiss', 'X'], ['Snooze 3 h', 'S'], ['More', 'Enter']] as const) {
    expect(within(first).getByRole('button', { name }).getAttribute('aria-keyshortcuts')).toBe(key);
  }
  expect(screen.getByRole('button', { name: 'Next item' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Previous item' })).toBeTruthy();
});

test('E opens the draft for editing and sending it resolves with send_draft', async () => {
  const user = userEvent.setup();
  const world = buildWorld();
  // Only the reply task, so it is the first item.
  world.tasks = world.tasks.filter((t) => t.kind === 'reply_needed');
  const api = makeApi(world);
  renderApp({ api, undoMs: 20 });
  await screen.findByText(/Can you start on 1 November/);

  await user.keyboard('e');
  const box = screen.getByLabelText('Your reply');
  await user.clear(box);
  await user.type(box, 'Ja, 1 november is goed.');
  await user.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() =>
    expect(api.resolveTask).toHaveBeenCalledWith('t_reply_phoenix', { action: 'send_draft', draft: 'Ja, 1 november is goed.' }),
  );
});

test('an empty inbox says what the agent is doing', async () => {
  const world = buildWorld();
  world.tasks = [];
  renderApp({ api: makeApi(world) });
  expect(await screen.findByText(/Nothing needs you\. Last check .* on 10 sources\./)).toBeTruthy();
  vi.restoreAllMocks();
});

import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildWorld } from '../mock/fixtures';
import { makeApi, renderApp } from '../test/helpers';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(cleanup);

test('the pause switch calls pause and the status pill reads "Paused"', async () => {
  const user = userEvent.setup();
  const world = buildWorld();
  world.sources = world.sources.map((s) => (s.health === 'needs_login' || s.health === 'down' ? { ...s, health: 'ok' } : s));
  const { api } = renderApp({ api: makeApi(world) });
  const banner = await screen.findByRole('banner');
  await waitFor(() => expect(within(banner).getByTestId('agent-status').textContent).toMatch(/^Running/));

  await user.click(within(banner).getByRole('button', { name: 'Pause' }));

  expect(api.pause).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(within(banner).getByTestId('agent-status').textContent).toBe('Paused'));
  expect(within(banner).getByRole('button', { name: 'Resume' })).toBeTruthy();

  await user.click(within(banner).getByRole('button', { name: 'Resume' }));
  expect(api.resume).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(within(banner).getByTestId('agent-status').textContent).toMatch(/^Running/));
});

test('the status pill names a source that needs a login', async () => {
  renderApp();
  await waitFor(() => expect(screen.getByTestId('agent-status').textContent).toBe('Error: Pararius login expired'));
});

test('the theme toggle is a pressed button whose word is its name, stored under nlpf-theme', async () => {
  const user = userEvent.setup();
  renderApp();
  const toggle = await screen.findByRole('button', { name: 'Dark mode' });
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  await user.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('nlpf-theme')).toBe('dark');
  await user.click(toggle);
  expect(localStorage.getItem('nlpf-theme')).toBe('light');
});

test('Ctrl K opens the command palette and runs a command', async () => {
  const user = userEvent.setup();
  const { api } = renderApp();
  await screen.findByRole('heading', { name: /^Viewing booked,/ });

  await user.keyboard('{Control>}k{/Control}');
  const palette = await screen.findByRole('dialog', { name: 'Command palette' });
  await user.type(within(palette).getByRole('combobox'), 'pause');
  expect(within(palette).getByRole('option', { name: /Pause agent/ }).getAttribute('aria-selected')).toBe('true');
  await user.keyboard('{Enter}');

  expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  await waitFor(() => expect(api.pause).toHaveBeenCalled());
});

test('the palette finds a listing by street and opens it', async () => {
  const user = userEvent.setup();
  const { api } = renderApp();
  await screen.findByRole('heading', { name: /^Viewing booked,/ });
  await user.click(screen.getByRole('button', { name: 'Search listings or run a command' }));
  const palette = await screen.findByRole('dialog', { name: 'Command palette' });
  await user.type(within(palette).getByRole('combobox'), 'zwaanshals');
  await user.keyboard('{Enter}');
  await waitFor(() => expect(api.property).toHaveBeenCalledWith('p_zwaanshals88'));
  expect(await screen.findByRole('dialog', { name: 'Property details' })).toBeTruthy();
});

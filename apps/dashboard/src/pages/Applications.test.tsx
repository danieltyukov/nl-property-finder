import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isOpen } from '../components/FoundPlace';
import { applicationsOf, buildWorld } from '../mock/fixtures';
import { makeApi, renderApp } from '../test/helpers';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

test('the board groups applications by status with reaction time and channel', async () => {
  renderApp({ path: '/applications' });
  const viewing = await screen.findByRole('region', { name: 'Viewing' });
  expect(within(viewing).getByRole('link', { name: 'Oude Delft 12A' })).toBeTruthy();
  expect(within(viewing).getByText('38 s')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Offer' })).getByText('Kralingse Plaslaan 20')).toBeTruthy();
});

test('"I found a place" shows one preview per open conversation and calls withdrawAll with pause: true', async () => {
  const user = userEvent.setup();
  const world = buildWorld();
  const open = applicationsOf(world).filter(isOpen);
  expect(open.length).toBeGreaterThan(3);
  const api = makeApi(world);
  renderApp({ path: '/applications', api });

  await user.click(await screen.findByRole('button', { name: 'I found a place' }));
  const dialog = await screen.findByRole('dialog', { name: 'I found a place' });
  const previews = within(dialog).getByRole('list', { name: 'Withdrawal previews' });
  await waitFor(() => expect(within(previews).getAllByRole('listitem')).toHaveLength(open.length));
  for (const view of open) {
    expect(within(previews).getByText(new RegExp(view.property!.address.street!))).toBeTruthy();
  }

  // Taking one of them leaves it out of the withdrawal.
  await user.selectOptions(within(dialog).getByLabelText('Which place did you get?'), 'p_oudedelft12a');
  expect(within(previews).getAllByRole('listitem')).toHaveLength(open.length - 1);

  await user.click(within(dialog).getByRole('button', { name: `Withdraw ${open.length - 1} applications` }));
  await waitFor(() => expect(api.withdrawAll).toHaveBeenCalledTimes(1));
  expect(api.withdrawAll).toHaveBeenCalledWith(
    expect.objectContaining({ pause: true, foundAddress: 'Oude Delft 12A, Delft', message: expect.stringContaining('andere woning') }),
  );
});

test('the board also reads PropertyViews, which is what the daemon returns today', async () => {
  const world = buildWorld();
  const api = makeApi(world);
  api.applications = async () => ({ items: world.properties.filter((p) => p.application) });
  renderApp({ path: '/applications', api });
  const offer = await screen.findByRole('region', { name: 'Offer' });
  expect(within(offer).getByRole('link', { name: 'Kralingse Plaslaan 20' })).toBeTruthy();
  expect(within(offer).getByRole('link', { name: 'Open conversation' }).getAttribute('href')).toBe('/conversations/c_plaslaan');
});

import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildWorld } from '../mock/fixtures';
import { makeApi, renderApp } from '../test/helpers';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function freshApp() {
  const world = buildWorld(Date.now(), { fresh: true });
  const api = makeApi(world);
  renderApp({ api });
  return { api, world };
}

test('the wizard appears when the profile has no first name', async () => {
  freshApp();
  expect(await screen.findByRole('heading', { level: 1, name: 'Who is looking?' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /things need you/ })).toBeNull();
});

test('the wizard writes the profile through patchConfig', async () => {
  const user = userEvent.setup();
  const { api } = freshApp();
  await screen.findByRole('heading', { name: 'Who is looking?' });

  await user.type(screen.getByLabelText('First name'), 'Sam');
  await user.type(screen.getByLabelText('Last name'), 'de Vries');
  await user.type(screen.getByLabelText('Email address'), 'sam.zoekt.huis@gmail.com');
  await user.selectOptions(screen.getByLabelText('Occupation'), 'phd');
  await user.type(screen.getByLabelText('Gross monthly income (EUR)'), '2950');
  await user.click(screen.getByRole('button', { name: 'Continue' }));

  await waitFor(() =>
    expect(api.patchConfig).toHaveBeenCalledWith(
      'profile',
      expect.objectContaining({ firstName: 'Sam', lastName: 'de Vries', email: 'sam.zoekt.huis@gmail.com', occupation: 'phd', incomeMonthlyGrossEur: 2950 }),
    ),
  );
  expect(await screen.findByRole('heading', { name: 'Where, and for how much?' })).toBeTruthy();
});

test('a first name is required before continuing', async () => {
  const user = userEvent.setup();
  const { api } = freshApp();
  await screen.findByRole('heading', { name: 'Who is looking?' });
  // The browser's own required check is bypassed by submitting through the button with an empty name set programmatically.
  const first = screen.getByLabelText('First name') as HTMLInputElement;
  first.removeAttribute('required');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(api.patchConfig).not.toHaveBeenCalled();
});

test('opting in to automatic contact on a platform that forbids it records termsAcknowledgedAt', async () => {
  const user = userEvent.setup();
  const { api } = freshApp();
  await screen.findByRole('heading', { name: 'Who is looking?' });

  await user.type(screen.getByLabelText('First name'), 'Sam');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Where, and for how much?' });
  await user.click(screen.getByRole('checkbox', { name: 'Delft' }));
  await user.click(screen.getByRole('checkbox', { name: 'Rotterdam' }));
  await user.type(screen.getByLabelText('Maximum rent (EUR)'), '1400');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(api.patchConfig).toHaveBeenCalledWith(
      'searches',
      [expect.objectContaining({ priceMaxEur: 1400, regions: [expect.objectContaining({ name: 'Delft' }), expect.objectContaining({ name: 'Rotterdam' })] })],
    ),
  );

  await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
  await screen.findByRole('heading', { name: 'How should it reach you?' });
  await user.click(screen.getByRole('button', { name: 'Skip for now' }));
  await screen.findByRole('heading', { name: 'Which sites, and how?' });

  const funda = screen.getByText('Funda', { selector: '.optin-name' }).closest('li')!;
  expect(within(funda).getByText(/can suspend that account/)).toBeTruthy();
  const optIn = within(funda).getByRole('checkbox', { name: /Let the agent contact landlords on Funda automatically/ });
  expect((optIn as HTMLInputElement).checked).toBe(false);
  await user.click(optIn);
  await user.click(screen.getByRole('button', { name: 'Continue' }));

  await waitFor(() =>
    expect(api.patchConfig).toHaveBeenCalledWith(
      'sources',
      expect.objectContaining({ funda: expect.objectContaining({ contact: 'auto', termsAcknowledgedAt: expect.any(String) }) }),
    ),
  );
  const sourcesCall = (api.patchConfig as unknown as { mock: { calls: [string, Record<string, { contact?: string }>][] } }).mock.calls.find(([s]) => s === 'sources')!;
  expect(sourcesCall[1].kamernet?.contact).not.toBe('auto');

  expect(await screen.findByRole('heading', { name: 'Ready to start.' })).toBeTruthy();
  expect(screen.getByText(/Funda/, { selector: 'dd' })).toBeTruthy();
});

test('platforms whose terms forbid automation still get the opt-in when /sources has no capabilities', async () => {
  const user = userEvent.setup();
  const world = buildWorld(Date.now(), { fresh: true });
  world.sources = world.sources.map((s) => ({
    sourceId: s.sourceId,
    name: s.name,
    enabled: s.enabled,
    health: s.health,
    consecutiveFailures: s.consecutiveFailures,
    consecutiveEmpty: s.consecutiveEmpty,
  }));
  renderApp({ api: makeApi(world) });
  await user.type(await screen.findByLabelText('First name'), 'Sam');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Delft' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
  await screen.findByRole('heading', { name: 'How should it reach you?' });
  await user.click(screen.getByRole('button', { name: 'Skip for now' }));
  await screen.findByRole('heading', { name: 'Which sites, and how?' });
  expect(screen.getByRole('checkbox', { name: /contact landlords on Pararius automatically/ })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: /contact landlords on RoomMatch automatically/ })).toBeNull();
});

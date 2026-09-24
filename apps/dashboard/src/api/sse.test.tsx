import { afterEach, expect, test } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveFeed } from '../components/LiveFeed';
import { FeedbackProvider } from '../components/Feedback';
import { buildWorld } from '../mock/fixtures';
import { FakeEventSource, fakeEventSource, makeApi, renderApp } from '../test/helpers';
import { ApiContext } from './client';
import { EventStreamProvider, invalidationsFor } from './sse';

afterEach(cleanup);

function renderFeed() {
  const world = buildWorld();
  world.events = [];
  const api = makeApi(world);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ApiContext.Provider value={api}>
        <EventStreamProvider factory={fakeEventSource}>
          <FeedbackProvider>
            <LiveFeed />
          </FeedbackProvider>
        </EventStreamProvider>
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
  return { api, client };
}

test('the event stream connects to /api/v1/events with the token in the query', async () => {
  window.__NLPF__ = { token: 'abc 123' };
  renderFeed();
  expect(FakeEventSource.latest().url).toBe('/api/v1/events?token=abc%20123');
  delete window.__NLPF__;
});

test('a listing.new event appends a row to the live feed', async () => {
  renderFeed();
  const list = await screen.findByText(/Nothing yet/);
  expect(list).toBeTruthy();

  act(() => {
    FakeEventSource.latest().emit('listing.new', 'Funda · Koornmarkt 58, Delft · €1,240 · 46 m²', { propertyId: 'p_x' }, 501);
  });

  const feed = await screen.findByRole('list', { name: 'Agent events, newest first' });
  const row = within(feed).getByText('Funda · Koornmarkt 58, Delft · €1,240 · 46 m²').closest('li')!;
  expect(row.getAttribute('data-type')).toBe('listing.new');
  expect(within(row).getByText('Found')).toBeTruthy();

  act(() => {
    FakeEventSource.latest().emit('message.sent', 'Sent to Koornmarkt 58 by Funda form, 3 s after it appeared', {}, 502);
  });
  const rows = within(feed).getAllByRole('listitem');
  expect(rows[0]!.textContent).toContain('Sent to Koornmarkt 58');
  expect(rows[1]!.textContent).toContain('Koornmarkt 58, Delft');
});

test('the same event id is shown once, and checks do not fill the feed', async () => {
  renderFeed();
  await screen.findByText(/Nothing yet/);
  act(() => {
    const source = FakeEventSource.latest();
    source.emit('listing.new', 'Funda · Hooikade 14, Delft', {}, 700);
    source.emit('listing.new', 'Funda · Hooikade 14, Delft', {}, 700);
    source.emit('source.polled', 'Checked Funda', {}, 701);
  });
  const feed = await screen.findByRole('list', { name: 'Agent events, newest first' });
  expect(within(feed).getAllByRole('listitem')).toHaveLength(1);
});

test('feed filters narrow the rows', async () => {
  const user = userEvent.setup();
  renderFeed();
  await screen.findByText(/Nothing yet/);
  act(() => {
    const source = FakeEventSource.latest();
    source.emit('listing.new', 'Found one', {}, 801);
    source.emit('message.received', 'A reply', {}, 802);
  });
  await user.click(screen.getByRole('button', { name: 'Replies' }));
  const feed = screen.getByRole('list', { name: 'Agent events, newest first' });
  expect(within(feed).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('A reply')]);
});

test('task.created is announced in the polite live region', async () => {
  renderApp();
  await screen.findByRole('heading', { name: /^Viewing booked,/ });
  act(() => {
    FakeEventSource.latest().emit('task.created', 'Needs you: viewing proposed for Oudegracht 112', {}, 990);
  });
  const region = screen.getByTestId('live-region');
  expect(region.getAttribute('aria-live')).toBe('polite');
  await screen.findByText('New in the inbox: viewing proposed for Oudegracht 112');
  expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
});

test('events invalidate the queries they affect', () => {
  expect(invalidationsFor('task.created')).toEqual(expect.arrayContaining([['tasks'], ['status']]));
  expect(invalidationsFor('listing.new')).toEqual(expect.arrayContaining([['properties']]));
  expect(invalidationsFor('source.health')).toEqual(expect.arrayContaining([['sources']]));
});

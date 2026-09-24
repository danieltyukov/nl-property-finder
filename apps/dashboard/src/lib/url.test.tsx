import { afterEach, expect, test } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { buildWorld } from '../mock/fixtures';
import { makeApi, renderApp } from '../test/helpers';
import { safeHref } from './url';

afterEach(cleanup);

test('only web, mail and phone links survive', () => {
  expect(safeHref('https://www.funda.nl/detail/huur/delft/1')).toBe('https://www.funda.nl/detail/huur/delft/1');
  expect(safeHref('tel:+31152124490')).toBe('tel:+31152124490');
  expect(safeHref('javascript:fetch("/api/v1/tasks")')).toBeUndefined();
  expect(safeHref(' JavaScript:alert(1)')).toBeUndefined();
  expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  expect(safeHref('/relative/path')).toBeUndefined();
  expect(safeHref(undefined)).toBeUndefined();
});

test('a listing with a script URL is shown without a link', async () => {
  const world = buildWorld();
  const view = world.properties.find((p) => p.property.id === 'p_kanaalweg5')!;
  view.listings[0]!.url = 'javascript:alert(document.cookie)';
  renderApp({ path: '/properties/p_kanaalweg5', api: makeApi(world) });
  const drawer = await screen.findByRole('dialog', { name: 'Property details' });
  await within(drawer).findByRole('heading', { name: 'Kanaalweg 5' });
  expect(within(drawer).queryByRole('link', { name: /Open on Funda/ })).toBeNull();
  for (const link of drawer.querySelectorAll('a')) expect(link.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
});

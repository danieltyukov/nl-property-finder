import { expect, test } from 'vitest';
import Database from 'better-sqlite3';

test('native sqlite loads', () => {
  const db = new Database(':memory:');
  expect(db.prepare('select 1 as one').get()).toEqual({ one: 1 });
});

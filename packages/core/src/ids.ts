import { randomBytes } from 'node:crypto';

/**
 * Short, sortable ids: a millisecond timestamp in base 36 followed by random
 * characters, with a prefix naming the kind ("p_", "app_", "t_" ...). Sorting
 * ids sorts by creation time, which keeps list queries simple.
 */
export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
  return `${prefix}_${time}${rand}`;
}

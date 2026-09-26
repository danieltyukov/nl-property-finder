const tails = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` after all earlier work for the same key has finished, whether it
 * succeeded or not. Work for other keys is not held up.
 */
export function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

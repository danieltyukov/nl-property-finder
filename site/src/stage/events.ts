/*
 * The feed event bus. main.ts emits the sample feed's events here whether or
 * not the Street is loaded, and the stage subscribes when it starts. This file
 * imports nothing, so the entry chunk can carry it without pulling three.js in.
 */

export type FeedEvent =
  /** A listing was found: a mote flies into the window, which then lights. */
  | { kind: 'found'; window: number }
  /** A reply needs the person: the window blinks twice in the needs-you colour. */
  | { kind: 'needs-you'; window: number }
  /** The feed was replayed: its windows go dark again. */
  | { kind: 'reset'; windows: number[] }
  /** A tool call in the terminal demo: the needs-you windows pulse. */
  | { kind: 'pulse'; windows: number[] }
  /** The seventh house (Contribute) is built, 0 to 1. */
  | { kind: 'build'; progress: number };

type Listener = (e: FeedEvent) => void;
const listeners = new Set<Listener>();

/** Windows the feed has lit so far, so a stage that loads late starts in step. */
export const feedState = { lit: new Set<number>(), needs: new Set<number>(), build: 0 };

export function emit(e: FeedEvent): void {
  if (e.kind === 'found') feedState.lit.add(e.window);
  else if (e.kind === 'needs-you') feedState.needs.add(e.window);
  else if (e.kind === 'build') feedState.build = e.progress;
  else if (e.kind === 'reset') {
    for (const w of e.windows) {
      feedState.lit.delete(w);
      feedState.needs.delete(w);
    }
  }
  for (const l of listeners) l(e);
}

export function on(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

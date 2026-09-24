import type { SourceAdapter } from '@nlpf/core';
import { funda } from '../adapters/funda.js';
import { housinganywhere } from '../adapters/housinganywhere.js';
import { kamernet } from '../adapters/kamernet.js';
import { marktplaats } from '../adapters/marktplaats.js';
import { ssh } from '../adapters/ssh.js';
import { vesteda } from '../adapters/vesteda.js';

/** Task 5a: Funda, Kamernet, HousingAnywhere, Marktplaats, Vesteda, SSH. Owned by that task; returns every adapter in the group. */
export function jsonAdapters(): SourceAdapter[] {
  return [funda, kamernet, housinganywhere, marktplaats, vesteda, ssh];
}

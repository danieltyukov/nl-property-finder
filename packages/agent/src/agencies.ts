import type { Agent } from '@nlpf/core';

/** An estate agent recognised by the website its listing photos are copied from. */
export interface KnownAgency {
  name: string;
  homepage: string;
  /** The address the agent publishes for rental questions, on its own website. */
  email: string;
}

/**
 * Agents whose listings on Huurwoningen and Pararius carry photos copied from
 * their own website (the `original_uri` of each photo). On a platform that
 * shows the agent only to paying members, the photo still names the agent,
 * so the home can be answered by email instead of a paid plan. Only an
 * address the agent publishes on its own website belongs here, never a guess.
 */
const AGENCIES: Record<string, KnownAgency> = {
  // https://citybird-rentals.com/contact; its selection procedure takes applications by email.
  'citybird-rentals.com': { name: 'CityBird Rentals', homepage: 'https://citybird-rentals.com', email: 'info@citybird-rentals.com' },
  // https://frisiamakelaars.nl/, "Wij helpen u graag!".
  'frisiamakelaars.nl': { name: 'Frisia Makelaars', homepage: 'https://frisiamakelaars.nl', email: 'info@frisiamakelaars.nl' },
  // https://www.minormakelaardij.nl/contact/: "Heeft u specifieke vragen over een woning of pand, mail/bel ons!"
  'minormakelaardij.nl': { name: 'Minor Makelaardij', homepage: 'https://www.minormakelaardij.nl', email: 'info@minormakelaardij.nl' },
  // Not listed on purpose: At Home Vastgoed and NRW Wonen take reactions on their own website
  // only, vb&t publishes no rental address, Magis allocates by lottery through its form, and
  // Gapph needs a paid account to react.
};

/** The agent behind a photo host: the host itself or a parent domain, so "www." and "media." match too. */
export function agencyByPhotoHost(host: string | undefined): KnownAgency | undefined {
  const parts = (host ?? '').trim().toLowerCase().split('.').filter(Boolean);
  for (let i = 0; i <= parts.length - 2; i++) {
    const hit = AGENCIES[parts.slice(i).join('.')];
    if (hit) return hit;
  }
  return undefined;
}

/** The agent for a listing whose source named none with an email, from where its photos come from. */
export function agentFromPhotos(agent: Agent | undefined, imageOrigin: unknown): Agent | undefined {
  if (agent?.email || typeof imageOrigin !== 'string') return agent;
  const known = agencyByPhotoHost(imageOrigin);
  if (!known) return agent;
  return { ...agent, name: agent?.name ?? known.name, url: agent?.url ?? known.homepage, email: known.email };
}

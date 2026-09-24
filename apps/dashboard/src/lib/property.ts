/*
 * Derived facts about a property that several pages show the same way.
 */
import type { PropertyView } from '@nlpf/core';
import { duration } from './format';
import { CHANNEL, sourceName } from './labels';

export function firstSeen(view: PropertyView): string {
  return view.listings.map((l) => l.firstSeenAt).sort()[0] ?? view.property.createdAt;
}

export function lastAction(view: PropertyView): string {
  const app = view.application;
  const match = view.match;
  if (app) {
    const via = app.channel ? (CHANNEL[app.channel.kind] ?? app.channel.kind).toLowerCase() : 'message';
    const where = app.channel?.sourceId ? ` on ${sourceName(app.channel.sourceId)}` : '';
    switch (app.status) {
      case 'queued':
        return 'Sending now';
      case 'contacted':
        return app.reactionMs ? `Sent by ${via}${where}, ${duration(app.reactionMs)} after it appeared` : `Sent by ${via}${where}`;
      case 'replied':
        return 'The landlord replied';
      case 'viewing_proposed':
        return 'Viewing times proposed';
      case 'viewing_booked':
        return 'Viewing booked';
      case 'viewed':
        return 'Viewed';
      case 'offer':
        return 'Offer received';
      case 'manual':
        return 'Waiting for you to react';
      case 'rejected':
        return app.note ?? 'Rejected by the landlord';
      case 'withdrawn':
        return 'Withdrawn';
      case 'gone':
        return 'Listing went offline before sending';
      case 'skipped':
        return 'Skipped by you';
    }
  }
  if (match?.scam.level === 'likely') return `Not contacted: ${match.scam.signals.length} scam signals`;
  if (match && !match.passed) return `Skipped: ${match.failedRule ?? 'did not pass the filters'}`;
  if (match) return 'Matched; the source is watch only';
  return 'Being evaluated';
}

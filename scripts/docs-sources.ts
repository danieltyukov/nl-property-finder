/**
 * Writes docs/SOURCES.md and the sources table in README.md from the adapters'
 * own declarations, so the documentation says exactly what the code does.
 * Run with `npm run docs:sources`. CI runs it with --check and fails when the
 * committed files are out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { builtinAdapters } from '@nlpf/sources';
import type { SourceAdapter } from '@nlpf/core';

const check = process.argv.includes('--check');

const contactLabel: Record<string, string> = {
  form: 'Contact form',
  message: 'Platform message',
  email: 'Email',
  booking: 'Online booking',
  lottery: 'Lottery or waiting list',
  none: 'None',
};

function defaultMode(a: SourceAdapter): string {
  const c = a.capabilities;
  if (c.contact === 'none' || c.contact === 'lottery') return 'Watch only';
  if (c.paid) return `With ${c.paid.plan}`;
  if (c.terms === 'forbids') return 'Opt-in';
  if (c.login === 'required') return 'After you connect';
  return 'Yes';
}

function why(a: SourceAdapter): string {
  const c = a.capabilities;
  const parts: string[] = [];
  if (c.terms === 'forbids') parts.push('its terms forbid automated access, so contact waits for your opt-in');
  if (c.paid) parts.push(`reacting needs a paid plan (${c.paid.plan}); without it the agent looks for a free copy of the same home`);
  if (c.login === 'required') parts.push('it needs one login with nlpf connect');
  if (c.browser === 'headed') parts.push(c.search === 'browser' || c.search === 'html' ? 'it is read in a real browser on a private display' : 'contacting runs in a real browser on a private display');
  if (c.contact === 'booking') parts.push('homes are booked first come, first served');
  return parts.length ? parts.join('; ') : 'nothing special';
}

const adapters = builtinAdapters();
const byId = [...adapters].sort((a, b) => a.name.localeCompare(b.name));

const table = [
  '| Source | Finds listings | Contacts automatically | How |',
  '| --- | --- | --- | --- |',
  ...byId.map((a) => `| [${a.name}](${a.homepage}) | ${a.capabilities.search === 'email-alert' ? 'From alert emails' : 'Yes'} | ${defaultMode(a)} | ${contactLabel[a.capabilities.contact] ?? a.capabilities.contact} |`),
].join('\n');

const detail = byId
  .map((a) => {
    const c = a.capabilities;
    const regions = a.regions === 'nl' ? 'The whole country' : a.regions.map((r) => r[0]!.toUpperCase() + r.slice(1)).join(', ');
    return [
      `## ${a.name}`,
      '',
      `Id \`${a.id}\`. ${a.homepage}`,
      '',
      `| | |`,
      `| --- | --- |`,
      `| Regions | ${regions} |`,
      `| Reads listings from | ${c.search === 'json' ? 'its JSON API' : c.search === 'html' ? 'its web pages' : c.search === 'browser' ? 'a real browser' : 'alert emails'} |`,
      `| Checked every | about ${a.defaultIntervalSec} seconds |`,
      `| Contact | ${contactLabel[c.contact] ?? c.contact} |`,
      `| Login | ${c.login} |`,
      `| Paid plan to react | ${c.paid ? c.paid.plan : 'no'} |`,
      `| Terms on automation | ${c.terms} |`,
      `| Default | ${defaultMode(a)}: ${why(a)} |`,
      '',
    ].join('\n');
  })
  .join('\n');

const doc = `# Sources

Generated from the adapters by \`npm run docs:sources\`. Do not edit by hand.

${adapters.length} built-in sources. Estate agents are added with one YAML
file each (see \`docs/ADAPTERS.md\`), and every platform's alert emails are
read from your dedicated mailbox as a second way in.

"Contacts automatically" is the default. Every source can be switched to
watch only, and on platforms whose terms forbid automated access you opt in
per platform with \`nlpf sources enable-contact <id>\` or in the dashboard.

${table}

${detail}`;

const readme = readFileSync('README.md', 'utf8');
const nextReadme = readme.replace(/<!-- sources:start -->[\s\S]*<!-- sources:end -->/, `<!-- sources:start -->\n${table}\n<!-- sources:end -->`);

if (check) {
  const current = (() => {
    try {
      return readFileSync('docs/SOURCES.md', 'utf8');
    } catch {
      return '';
    }
  })();
  if (current !== doc || readme !== nextReadme) {
    console.error('docs/SOURCES.md or the README sources table is out of date. Run npm run docs:sources.');
    process.exit(1);
  }
} else {
  writeFileSync('docs/SOURCES.md', doc);
  writeFileSync('README.md', nextReadme);
  console.log(`Wrote docs/SOURCES.md and the README table for ${adapters.length} sources.`);
}

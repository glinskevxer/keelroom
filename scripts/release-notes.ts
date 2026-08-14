/**
 * Print the changelog entry for the version being built.
 *
 * The release job pastes this into the tag, so the notes and the changelog
 * cannot drift: there is only one copy and this reads it. It exits non zero if
 * there is no entry, which is the same check the release gate makes, so a
 * release with nothing written about it stops here rather than at the tag.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

export interface Entry {
  readonly version: string;
  readonly date: string;
  readonly body: string;
}

const HEADING = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/gm;

/** Every entry in the changelog, newest first, in the order it is written. */
export function entries(text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')): Entry[] {
  const headings = [...text.matchAll(HEADING)];
  return headings.map((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? text.length;
    return {
      version: heading[1] ?? '',
      date: heading[2] ?? '',
      body: text.slice(start, end).trim(),
    };
  });
}

export function entryFor(version: string, text?: string): Entry | undefined {
  return entries(text).find((entry) => entry.version === version);
}

function main(): void {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  const asked = process.argv[2] ?? manifest.version;
  const entry = entryFor(asked);
  if (entry === undefined) {
    console.error(`the changelog has no entry for ${asked}`);
    process.exit(1);
  }
  console.log(`${manifest.name} ${entry.version} (${entry.date})`);
  console.log('');
  console.log(entry.body);
}

if (require.main === module) {
  main();
}

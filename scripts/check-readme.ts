/**
 * Check the README's table of directories against the tree.
 *
 * The table is the first thing anybody reads and it is the first thing to go
 * stale: a module gets added and the table does not know about it. This says so
 * rather than leaving it to be noticed by somebody looking for a directory that
 * the README says exists and does not.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

/** Every directory the README ought to name, one level below src. */
export function directories(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, 'src'))) {
    const full = join(root, 'src', entry);
    if (!statSync(full).isDirectory()) {
      continue;
    }
    const children = readdirSync(full).filter((child) => statSync(join(full, child)).isDirectory());
    if (children.length === 0) {
      found.push(`src/${entry}`);
      continue;
    }
    for (const child of children) {
      found.push(`src/${entry}/${child}`);
    }
  }
  return found.sort();
}

export function named(readme: string): string[] {
  return [...readme.matchAll(/^\| `(src\/[a-z/-]+)` \|/gm)].map((match) => match[1] ?? '').sort();
}

export function problems(): string[] {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const table = named(readme);
  const tree = directories();
  const missing = tree.filter((entry) => !table.includes(entry));
  const gone = table.filter((entry) => !tree.includes(entry));
  return [
    ...missing.map((entry) => `${entry} is in the tree and not in the README table`),
    ...gone.map((entry) => `${entry} is in the README table and not in the tree`),
  ];
}

function main(): void {
  const found = problems();
  if (found.length > 0) {
    for (const problem of found) {
      console.error(problem);
    }
    process.exit(1);
  }
  console.log(`the README names all ${directories().length} directories`);
}

if (require.main === module) {
  main();
}

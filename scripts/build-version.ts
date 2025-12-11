/**
 * Write src/version.ts from package.json, or check that it matches.
 *
 * The version is in the source rather than read from package.json at runtime
 * because the built package does not ship package.json in a shape the compiled
 * code can find, and a version that reads "unknown" in the field is the sort of
 * thing nobody notices until an agent quotes it back.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const target = join(root, 'src', 'version.ts');

interface Manifest {
  readonly name: string;
  readonly version: string;
}

function render(manifest: Manifest): string {
  return [
    '/** Written by scripts/build-version.ts from package.json. Do not edit by hand. */',
    `export const VERSION = '${manifest.version}';`,
    `export const NAME = '${manifest.name}';`,
    '',
  ].join('\n');
}

function main(): void {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
  const wanted = render(manifest);
  const check = process.argv.includes('--check');
  const current = readFileSync(target, 'utf8');
  if (check) {
    if (current !== wanted) {
      console.error('src/version.ts does not match package.json, run npm run version:write');
      process.exit(1);
    }
    console.log(`version ${manifest.version} matches`);
    return;
  }
  writeFileSync(target, wanted);
  console.log(`wrote version ${manifest.version}`);
}

main();

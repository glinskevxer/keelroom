/**
 * The declarations the package ships.
 *
 * `tsc --noEmit` type checks and emits nothing, so it never asks whether the
 * declaration file it would have written is expressible. The stores' find or
 * throw pairs are built by a helper, and the type that comes out of it mentions
 * the sqlite handle by a name a declaration cannot import, which turned the
 * release build red while every other gate stayed green.
 *
 * The build in `scripts/check.sh` is the real guard. This says the same thing
 * cheaply, and it says which line to fix.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const stores = join(__dirname, '..', '..', '..', 'src', 'storage');

function storeFiles(): string[] {
  return readdirSync(stores)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => join(stores, entry));
}

interface Binding {
  readonly file: string;
  readonly name: string;
  readonly annotated: boolean;
}

/** Every exported const in the stores that is built rather than written out. */
function builtBindings(): Binding[] {
  const found: Binding[] = [];
  for (const file of storeFiles()) {
    const text = readFileSync(file, 'utf8');
    // the annotation carries a fat arrow, so it cannot be matched by excluding
    // equals signs; take everything up to the assignment and ask whether it
    // starts with a colon
    for (const match of text.matchAll(/^export const (\w+)(.*?) = requiring\(/gm)) {
      found.push({
        file: file.slice(stores.length + 1),
        name: match[1] ?? '',
        annotated: (match[2] ?? '').startsWith(':'),
      });
    }
  }
  return found;
}

describe('the built bindings', () => {
  it('are there to be checked at all', () => {
    expect(builtBindings().length).toBeGreaterThan(5);
  });

  it('every one of them says its own type', () => {
    for (const binding of builtBindings()) {
      expect(`${binding.file}:${binding.name}:${binding.annotated}`).toBe(
        `${binding.file}:${binding.name}:true`,
      );
    }
  });

  it('name the district handle rather than the driver type', () => {
    for (const file of storeFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toContain('BetterSqlite3.Database');
    }
  });

  it('cover the requirers the services actually call', () => {
    const names = builtBindings().map((binding) => binding.name);
    for (const wanted of [
      'requireVessel',
      'requireAccount',
      'requireMovement',
      'requirePilot',
      'requireNotice',
      'requireTug',
    ]) {
      expect(names).toContain(wanted);
    }
  });
});

describe('the check script', () => {
  it('runs the build, which is what caught this', () => {
    const script = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'check.sh'), 'utf8');
    expect(script).toContain('npm run build');
    expect(script.indexOf('npm run build')).toBeLessThan(script.indexOf('npm test'));
  });
});

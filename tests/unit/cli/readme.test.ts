import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { directories, named, problems } from '../../../scripts/check-readme';

const readme = readFileSync(join(__dirname, '..', '..', '..', 'README.md'), 'utf8');

describe('the readme', () => {
  it('names every directory in the tree', () => {
    expect(problems()).toEqual([]);
  });

  it('finds the directories one level below src', () => {
    const found = directories();
    expect(found).toContain('src/domain/tide');
    expect(found).toContain('src/util');
    expect(found.length).toBeGreaterThan(15);
  });

  it('reads the table out of the readme', () => {
    expect(named(readme)).toContain('src/domain/ukc');
  });

  it('says what the district does before it says how to run it', () => {
    expect(readme.indexOf('The chain of decisions')).toBeLessThan(readme.indexOf('Running it'));
  });

  it('points at the generated documents', () => {
    expect(readme).toContain('docs/commands.md');
    expect(readme).toContain('docs/rules.md');
    expect(readme).toContain('docs/operations.md');
  });
});

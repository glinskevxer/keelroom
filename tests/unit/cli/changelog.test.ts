import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogProblems } from '../../../scripts/release-check';
import { VERSION } from '../../../src/version';

const root = join(__dirname, '..', '..', '..');
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');

describe('the changelog', () => {
  it('has an entry for the version that is being built', () => {
    expect(changelogProblems(VERSION)).toEqual([]);
  });

  it('complains about a version it does not carry', () => {
    const problems = changelogProblems('9.9.9');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain('9.9.9');
  });

  it('dates every version it carries', () => {
    const headings = [...changelog.matchAll(/^## .*$/gm)];
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(heading[0]).toMatch(/^## \d+\.\d+\.\d+ — \d{4}-\d{2}-\d{2}$/);
    }
  });

  it('says what changed rather than that something did', () => {
    expect(changelog.length).toBeGreaterThan(1000);
    expect(changelog).toContain('### Planning');
    expect(changelog).toContain('### Money');
  });

  it('names the parts of the system a reader would look for', () => {
    for (const word of ['tide', 'squat', 'notices', 'tariff', 'audit']) {
      expect(changelog.toLowerCase()).toContain(word);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entries, entryFor } from '../../../scripts/release-notes';
import { VERSION } from '../../../src/version';

const changelog = readFileSync(join(__dirname, '..', '..', '..', 'CHANGELOG.md'), 'utf8');

describe('the release notes', () => {
  it('read every entry, newest first', () => {
    const found = entries(changelog);
    expect(found.length).toBeGreaterThan(1);
    expect(found[0]?.version).toBe(VERSION);
    expect(found[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('find the entry for the version being built', () => {
    const entry = entryFor(VERSION, changelog);
    expect(entry?.body.length).toBeGreaterThan(80);
  });

  it('give nothing for a version nobody cut', () => {
    expect(entryFor('9.9.9', changelog)).toBeUndefined();
  });

  it('keep each entry to its own body', () => {
    const found = entries(changelog);
    expect(found[0]?.body).not.toContain('## 0.1.0');
    expect(found.at(-1)?.body.length).toBeGreaterThan(80);
  });

  it('run in date order, newest first', () => {
    const dates = entries(changelog).map((entry) => entry.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it('carry a version that matches the package', () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(manifest.version).toBe(VERSION);
    expect(entryFor(manifest.version, changelog)).toBeDefined();
  });
});

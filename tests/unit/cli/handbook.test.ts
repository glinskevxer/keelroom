import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { collectRules } from '../../../scripts/build-handbook';

const root = join(__dirname, '..', '..', '..');
const handbook = readFileSync(join(root, 'docs', 'rules.md'), 'utf8');

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sources(full, found);
    } else if (entry.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

describe('the rule ids', () => {
  const rules = collectRules();

  it('are found in the source', () => {
    expect(rules.length).toBeGreaterThan(30);
  });

  it('are every one of them in the handbook', () => {
    for (const rule of rules) {
      expect(handbook).toContain(`\`${rule.id}\``);
    }
  });

  it('carry a severity and a message', () => {
    for (const rule of rules) {
      expect(['blocking', 'advice', 'note']).toContain(rule.severity);
      expect(rule.message.length).toBeGreaterThan(3);
    }
  });

  it('are unique', () => {
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('follow the shape the finding log enforces', () => {
    for (const rule of rules) {
      expect(rule.id).toMatch(/^[A-Z]{2,8}(-[A-Z0-9]{1,6}){1,3}$/);
    }
  });

  it('appear in the source they are attributed to', () => {
    for (const rule of rules) {
      const text = readFileSync(join(root, rule.file), 'utf8');
      expect(text).toContain(rule.id);
    }
  });

  it('leave no id in the source out of the handbook', () => {
    const found = new Set<string>();
    for (const file of sources(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\.(?:block|advise|note)\(\s*'([A-Z][A-Z0-9-]{3,})'/g)) {
        found.add(match[1] ?? '');
      }
    }
    for (const id of found) {
      expect(handbook).toContain(`\`${id}\``);
    }
  });
});

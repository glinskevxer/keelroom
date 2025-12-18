import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const register = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'security-advisories.json'), 'utf8'),
) as {
  policy: string;
  accepted: {
    package: string;
    advisory: string;
    severity: string;
    reason: string;
    reviewedBy: string;
    expires: string;
  }[];
};

describe('the advisory register', () => {
  it('carries the policy in words', () => {
    expect(register.policy).toContain('runs out');
  });

  it('gives every acceptance a reason, a reviewer and an expiry', () => {
    for (const acceptance of register.accepted) {
      expect(acceptance.reason.length).toBeGreaterThan(20);
      expect(acceptance.reviewedBy).not.toBe('');
      expect(acceptance.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('holds no acceptance that has already run out', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const acceptance of register.accepted) {
      expect(acceptance.expires >= today).toBe(true);
    }
  });

  it('accepts nothing twice for the same package', () => {
    const names = register.accepted.map((acceptance) => acceptance.package);
    expect(new Set(names).size).toBe(names.length);
  });
});

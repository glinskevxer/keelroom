import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../../../src/util/errors';
import { findRule, readHandbook, rulesLike } from '../../../src/cli/commands/explain';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('reading the handbook', () => {
  const rules = readHandbook();

  it('finds every rule in it', () => {
    expect(rules.length).toBeGreaterThan(40);
    expect(rules.every((rule) => rule.id.length > 4)).toBe(true);
  });

  it('finds one by id, whatever the case', () => {
    expect(findRule(rules, 'UKC-NET-01')?.severity).toBe('blocking');
    expect(findRule(rules, 'ukc-net-01')?.id).toBe('UKC-NET-01');
    expect(findRule(rules, 'NOPE-01')).toBeUndefined();
  });

  it('finds a family by prefix', () => {
    expect(rulesLike(rules, 'UKC').length).toBeGreaterThan(3);
    expect(rulesLike(rules, 'ZZZ')).toEqual([]);
  });

  it('carries where each one fires', () => {
    expect(findRule(rules, 'UKC-NET-01')?.file).toContain('src/domain/ukc');
  });
});

describe('the command', () => {
  it('explains one rule', async () => {
    harness = cliHarness();
    const result = await harness.invoke('explain', 'UKC-NET-01');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('not enough water');
    expect(result.io.text()).toContain('where it fires');
  });

  it('explains a family', async () => {
    harness = cliHarness();
    const result = await harness.invoke('explain', 'RES');
    expect(result.io.text()).toContain('rules like RES');
    expect(result.io.text()).toContain('RES-WIND-05');
  });

  it('lists them all when asked for nothing', async () => {
    harness = cliHarness();
    const result = await harness.invoke('explain');
    expect(result.io.text()).toMatch(/^\d+ rules/);
  });

  it('refuses an id nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke('explain', 'ZZZ-99');
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.io.errorText()).toContain('no rule with reference');
  });

  it('reads as json', async () => {
    harness = cliHarness();
    const result = await harness.invoke('--format', 'json', 'explain', 'UKC-NET-01');
    expect((JSON.parse(result.io.text()) as { id: string }).id).toBe('UKC-NET-01');
  });
});

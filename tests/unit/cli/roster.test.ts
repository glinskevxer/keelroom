import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('the board', () => {
  it('prints in turn order with who is next', async () => {
    harness = cliHarness();
    const result = await harness.invoke('board');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('next up: P02');
    expect(result.io.text()).toContain('A Ferrier');
  });

  it('prints only the warnings when asked', async () => {
    harness = cliHarness();
    const result = await harness.invoke('board', '--warnings');
    expect(result.io.text()).toBe('the board is running evenly');
  });

  it('reads as json', async () => {
    harness = cliHarness();
    const result = await harness.invoke('--format', 'json', 'board');
    const parsed = JSON.parse(result.io.text());
    expect(parsed.board.entries).toHaveLength(3);
  });

  it('draws the board up again in seniority order', async () => {
    harness = cliHarness();
    await harness.invoke('board-rebuild');
    const result = await harness.invoke('board');
    expect(result.io.text()).toContain('next up: P02');
  });
});

describe('pilots', () => {
  it('list with their endorsements', async () => {
    harness = cliHarness();
    const result = await harness.invoke('pilots', 'list');
    expect(result.io.text()).toContain('NIGHT');
    expect(result.io.text()).toContain('C Cadet');
  });

  it('show one in full', async () => {
    harness = cliHarness();
    const result = await harness.invoke('pilots', 'show', 'P11');
    expect(result.io.text()).toContain('draught limit');
    expect(result.io.text()).toContain('limited');
  });

  it('refuse one nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke('pilots', 'show', 'P99');
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.io.errorText()).toContain('no pilot with reference');
  });

  it('record leave', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'pilots',
      'leave',
      'P02',
      '2025-04-03T00:00',
      '2025-04-10T00:00',
      '--reason',
      'annual',
    );
    expect(result.io.text()).toContain('P02 is on leave');
  });

  it('refuse leave for a pilot nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'pilots',
      'leave',
      'P99',
      '2025-04-03T00:00',
      '2025-04-10T00:00',
    );
    expect(result.io.errorText()).toContain('no pilot with reference');
  });
});

describe('who can take her', () => {
  it('answers for every pilot with the rule that refused', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'pilots',
      'who',
      '9074729',
      '--draught',
      '12.00',
      '--berth',
      'GRAIN-3',
    );
    expect(result.io.text()).toContain('may take her');
    expect(result.io.text()).toContain('PIL-DEEP-01');
  });

  it('refuses a ship nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke('pilots', 'who', '9123453', '--draught', '10.00');
    expect(result.io.errorText()).toContain('no vessel with reference');
  });

  it('takes the night into account', async () => {
    harness = cliHarness();
    const day = await harness.invoke('pilots', 'who', '9074705', '--draught', '6.00');
    const night = await harness.invoke('pilots', 'who', '9074705', '--draught', '6.00', '--night');
    expect(day.io.text()).not.toBe(night.io.text());
    expect(night.io.text()).toContain('PIL-NIGHT-03');
  });
});

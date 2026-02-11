import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('the draught ladder', () => {
  it('has a rung for every step', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'advice',
      'draught',
      '9074729',
      'GRAIN-3',
      '--from',
      '2025-04-02T00:00',
      '--days',
      '1',
      '--low',
      '10.00',
      '--high',
      '11.00',
      '--step',
      '0.50',
    );
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text().split('\n')).toHaveLength(6);
    expect(result.io.text()).toContain('10.00');
  });

  it('shows the window shrinking as she loads', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      '--format',
      'json',
      'advice',
      'draught',
      '9074729',
      'GRAIN-3',
      '--from',
      '2025-04-02T00:00',
      '--days',
      '1',
      '--low',
      '9.00',
      '--high',
      '12.00',
      '--step',
      '1.00',
    );
    const parsed = JSON.parse(result.io.text()) as { steps: { windowMinutes: number }[] };
    expect(parsed.steps[0]!.windowMinutes).toBeGreaterThanOrEqual(
      parsed.steps.at(-1)!.windowMinutes,
    );
  });
});

describe('the deepest she can come', () => {
  it('finds a draught and quotes the window it buys', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'advice',
      'deepest',
      '9074729',
      'GRAIN-3',
      '--from',
      '2025-04-02T00:00',
      '--days',
      '1',
      '--want',
      '60',
    );
    expect(result.io.text()).toMatch(/deepest \d+\.\d\d m for a window of/);
  });

  it('says so when nothing in the range works', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'advice',
      'deepest',
      '9319466',
      'ANCH-A',
      '--from',
      '2025-04-02T00:00',
      '--days',
      '1',
      '--want',
      '2000',
    );
    expect(result.io.text()).toContain('no window at any draught');
  });
});

describe('the best days', () => {
  it('lists the days worst last', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      '--format',
      'json',
      'advice',
      'days',
      '9074729',
      'GRAIN-3',
      '11.50',
      '--from',
      '2025-04-02T00:00',
      '--days',
      '4',
    );
    const parsed = JSON.parse(result.io.text()) as { minutes: number }[];
    expect(parsed).toHaveLength(4);
    expect(parsed[0]!.minutes).toBeGreaterThanOrEqual(parsed.at(-1)!.minutes);
  });
});

describe('the dredging case', () => {
  it('says there is nothing to dredge when nothing is ordered', async () => {
    harness = cliHarness();
    const result = await harness.invoke('advice', 'dredging', '--days', '2');
    expect(result.io.text()).toContain('dredge');
  });

  it('names the reach that would buy the most', async () => {
    harness = cliHarness();
    await harness.invoke(
      'orders',
      'place',
      '9074729',
      'SEAWAY',
      '--kind',
      'arrival',
      '--from',
      'SEA',
      '--to',
      'GRAIN-3',
      '--draught',
      '11.80',
      '--at',
      '2025-04-02T06:00',
    );
    const result = await harness.invoke(
      'advice',
      'dredging',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '3',
      '--by',
      '0.50',
    );
    expect(result.io.text()).toContain('dredge LOWER-BAR first');
  });
});

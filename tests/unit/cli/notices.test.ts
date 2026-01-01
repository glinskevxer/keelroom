import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

async function issue(...extra: string[]): Promise<string> {
  const result = await harness!.invoke(
    'notices',
    'issue',
    'LOWER-BAR',
    'dredger',
    'working',
    'the',
    'bar',
    '--kind',
    'draught-cap',
    '--from',
    '2025-04-01T00:00',
    '--to',
    '2025-04-08T00:00',
    '--value',
    '1000',
    ...extra,
  );
  return /N-\d{4}-\d{3}/.exec(result.io.text())?.[0] ?? '';
}

describe('issuing', () => {
  it('numbers the notice and saves it', async () => {
    harness = cliHarness();
    expect(await issue()).toBe('N-2025-001');
  });

  it('numbers the next one after it', async () => {
    harness = cliHarness();
    await issue();
    expect(await issue()).toBe('N-2025-002');
  });

  it('refuses a kind nobody issues', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'notices',
      'issue',
      'LOWER-BAR',
      'x',
      '--kind',
      'rumour',
      '--from',
      '2025-04-01T00:00',
      '--to',
      '2025-04-08T00:00',
    );
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.io.errorText()).toContain('no notice kind');
  });

  it('refuses a draught cap of nothing', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'notices',
      'issue',
      'LOWER-BAR',
      'x',
      '--kind',
      'draught-cap',
      '--from',
      '2025-04-01T00:00',
      '--to',
      '2025-04-08T00:00',
    );
    expect(result.io.errorText()).toContain('caps the draught at nothing');
  });
});

describe('the board', () => {
  it('lists what has been issued', async () => {
    harness = cliHarness();
    await issue();
    const result = await harness.invoke('notices', 'list');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('LOWER-BAR');
    expect(result.io.text()).toContain('10.00 m');
    expect(result.io.text()).toContain('in force');
  });

  it('filters to one subject', async () => {
    harness = cliHarness();
    await issue();
    const result = await harness.invoke('notices', 'list', '--subject', 'UPPER');
    expect(result.io.text()).toContain('no notices');
  });

  it('prints headlines', async () => {
    harness = cliHarness();
    await issue();
    const result = await harness.invoke('notices', 'list', '--headlines');
    expect(result.io.text()).toBe('LOWER-BAR: dredger working the bar (N-2025-001)');
  });

  it('says so when nothing is in force', async () => {
    harness = cliHarness();
    const result = await harness.invoke('notices', 'list', '--headlines');
    expect(result.io.text()).toBe('nothing in force');
  });

  it('shows one notice', async () => {
    harness = cliHarness();
    const id = await issue();
    const result = await harness.invoke('notices', 'show', id);
    expect(result.io.text()).toContain('draught-cap');
    expect(result.io.text()).toContain('10.00 m');
  });

  it('refuses one nobody issued', async () => {
    harness = cliHarness();
    const result = await harness.invoke('notices', 'show', 'N-2025-999');
    expect(result.io.errorText()).toContain('no notice with reference');
  });
});

describe('withdrawing', () => {
  it('takes it off the board and leaves it readable', async () => {
    harness = cliHarness();
    const id = await issue();
    const result = await harness.invoke('notices', 'withdraw', id);
    expect(result.io.text()).toContain('withdrawn');
    const board = await harness.invoke('notices', 'list');
    expect(board.io.text()).toContain('no notices');
    const shown = await harness.invoke('notices', 'show', id);
    expect(shown.io.text()).toContain('dredger working the bar');
  });

  it('refuses one nobody issued', async () => {
    harness = cliHarness();
    const result = await harness.invoke('notices', 'withdraw', 'N-2025-999');
    expect(result.code).toBe(EXIT_FINDINGS);
  });
});

describe('a notice on the plan', () => {
  it('shows up in the plan for a movement it binds on', async () => {
    harness = cliHarness();
    await issue();
    const placed = await harness.invoke(
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
      '11.00',
      '--at',
      '2025-04-03T06:00',
    );
    const reference = /M-\d{4}-\d{4}/.exec(placed.io.text())?.[0] ?? '';
    const plan = await harness.invoke('plan', 'show', reference);
    expect(plan.io.text()).toContain('NOT-DEEP-02');
  });
});

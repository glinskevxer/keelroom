import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

async function addPort(): Promise<void> {
  await harness!.invoke(
    'tides',
    'add-secondary',
    'UPPER-BASIN',
    'Upper Basin',
    'NARROWS',
    '35',
    '50',
    '--hw-factor',
    '1100',
    '--lw-factor',
    '900',
  );
}

describe('secondary ports', () => {
  it('start with none', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tides', 'secondary');
    expect(result.io.text()).toContain('no secondary ports');
  });

  it('take a port and list it with its corrections', async () => {
    harness = cliHarness();
    await addPort();
    const result = await harness.invoke('tides', 'secondary');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('UPPER-BASIN');
    expect(result.io.text()).toContain('1.10');
  });

  it('refuse a standard port the district does not have', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'tides',
      'add-secondary',
      'BASIN',
      'Basin',
      'NOWHERE',
      '10',
      '10',
    );
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.io.errorText()).toContain('no tide station');
  });

  it('print a table at the secondary port', async () => {
    harness = cliHarness();
    await addPort();
    const result = await harness.invoke(
      'tides',
      'secondary-table',
      'UPPER-BASIN',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '1',
    );
    expect(result.io.text()).toContain('Upper Basin');
    expect(result.io.text()).toContain('HW');
  });

  it('read higher at the basin than at the gauge', async () => {
    harness = cliHarness();
    await addPort();
    const basin = await harness.invoke(
      '--format',
      'json',
      'tides',
      'secondary-table',
      'UPPER-BASIN',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '1',
    );
    const gauge = await harness.invoke(
      '--format',
      'json',
      'tides',
      'table',
      'NARROWS',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '1',
    );
    const basinHigh = (
      JSON.parse(basin.io.text()) as { turns: { kind: string; height: number }[] }
    ).turns.filter((turn) => turn.kind === 'high')[0]!.height;
    const gaugeHigh = (
      JSON.parse(gauge.io.text()) as { extremes: { kind: string; height: number }[] }
    ).extremes.filter((turn) => turn.kind === 'high')[0]!.height;
    expect(basinHigh).toBeGreaterThan(gaugeHigh);
  });

  it('refuse a port nobody recorded', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tides', 'secondary-table', 'NOWHERE');
    expect(result.io.errorText()).toContain('no secondary port');
  });
});

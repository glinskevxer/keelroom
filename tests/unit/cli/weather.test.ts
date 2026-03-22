import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_USAGE } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('logging the weather', () => {
  it('records an observation and reads the force', async () => {
    harness = cliHarness();
    const result = await harness.invoke('weather', 'log', '22', '6000', '--direction', '240');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('force 6');
  });

  it('records a forecast for a later time', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'weather',
      'log',
      '30',
      '4000',
      '--at',
      '2025-04-03T06:00',
      '--forecast',
    );
    expect(result.io.text()).toContain('forecast at 2025-04-03T06:00');
  });

  it('refuses a reading that is not one', async () => {
    harness = cliHarness();
    const result = await harness.invoke('weather', 'log', 'strong', '6000');
    expect(result.code).toBe(EXIT_USAGE);
  });
});

describe('reading the log', () => {
  it('says so when nothing is logged', async () => {
    harness = cliHarness();
    const result = await harness.invoke('weather', 'show', '--days', '2');
    expect(result.io.text()).toContain('nothing logged');
  });

  it('lists what has been logged', async () => {
    harness = cliHarness();
    await harness.invoke('weather', 'log', '22', '6000', '--at', '2025-04-01T05:00');
    const result = await harness.invoke(
      'weather',
      'show',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '2',
    );
    expect(result.io.text()).toContain('22 kn');
    expect(result.io.text()).toContain('observed');
  });

  it('says what a plan for a time would use', async () => {
    harness = cliHarness();
    await harness.invoke('weather', 'log', '22', '6000', '--at', '2025-04-03T05:00');
    const result = await harness.invoke('weather', 'at', '2025-04-03T06:00');
    expect(result.io.text()).toContain('observed 22 kn');
  });

  it('says when there is nothing to use', async () => {
    harness = cliHarness();
    const result = await harness.invoke('weather', 'at', '2025-04-03T06:00');
    expect(result.io.text()).toContain('assume fair weather');
  });

  it('warns when the reading it would use is old', async () => {
    harness = cliHarness();
    await harness.invoke('weather', 'log', '22', '6000', '--at', '2025-04-02T05:00');
    const result = await harness.invoke('weather', 'at', '2025-04-03T06:00');
    expect(result.io.text()).toContain('old reading');
  });
});

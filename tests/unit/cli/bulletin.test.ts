import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('the bulletin', () => {
  it('carries the tide, the weather and the board', async () => {
    harness = cliHarness();
    const result = await harness.invoke('bulletin');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('keelroom bulletin for 2025-04-01');
    expect(result.io.text()).toContain('HW');
    expect(result.io.text()).toContain('nothing logged');
    expect(result.io.text()).toContain('P02');
  });

  it('says when nothing is expected', async () => {
    harness = cliHarness();
    const result = await harness.invoke('bulletin');
    expect(result.io.text()).toContain('nothing on the book');
    expect(result.io.text()).toContain('no notices in force');
  });

  it('lists the movements expected that day', async () => {
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
      '10.00',
      '--at',
      '2025-04-01T18:00',
    );
    const result = await harness.invoke('bulletin');
    expect(result.io.text()).toContain('ATLANTIC CROWN');
    expect(result.io.text()).toContain('1 ordered');
  });

  it('carries the notices in force', async () => {
    harness = cliHarness();
    await harness.invoke(
      'notices',
      'issue',
      'LOWER-BAR',
      'dredger',
      'working',
      '--kind',
      'information',
      '--from',
      '2025-04-01T00:00',
      '--to',
      '2025-04-05T00:00',
    );
    const result = await harness.invoke('bulletin');
    expect(result.io.text()).toContain('dredger working');
  });

  it('shows the weather once it is logged', async () => {
    harness = cliHarness();
    await harness.invoke('weather', 'log', '18', '7000', '--direction', '210');
    const result = await harness.invoke('bulletin');
    expect(result.io.text()).toContain('18 kn from 210');
  });

  it('reads as headlines when asked', async () => {
    harness = cliHarness();
    const result = await harness.invoke('bulletin', '--headlines');
    expect(result.io.text()).toContain('2025-04-01: 0 movements');
    expect(result.io.text().split('\n').length).toBeLessThan(4);
  });

  it('takes a day of its own', async () => {
    harness = cliHarness();
    const result = await harness.invoke('bulletin', '--day', '2025-04-05');
    expect(result.io.text()).toContain('keelroom bulletin for 2025-04-05');
  });

  it('stamps when it was issued', async () => {
    harness = cliHarness();
    const result = await harness.invoke('bulletin');
    expect(result.io.text()).toContain('issued 2025-04-01T04:00');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_USAGE } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

async function fleet(): Promise<void> {
  await harness!.invoke('launch', 'ground', 'SEA-BUOY', 'Sea Buoy', '25', '200');
  await harness!.invoke('launch', 'boat', 'B1', 'Narrows Pilot', '250');
}

async function assigned(): Promise<string> {
  const placed = await harness!.invoke(
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
    '2025-04-03T06:00',
  );
  const reference = /M-\d{4}-\d{4}/.exec(placed.io.text())?.[0] ?? '';
  await harness!.invoke('plan', 'confirm', reference);
  await harness!.invoke('dispatch', 'assign', reference);
  return reference;
}

describe('the grounds and the boats', () => {
  it('start empty and take what is recorded', async () => {
    harness = cliHarness();
    const empty = await harness.invoke('launch', 'list');
    expect(empty.io.text()).toContain('no grounds');
    await fleet();
    const result = await harness.invoke('launch', 'list');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('Sea Buoy');
    expect(result.io.text()).toContain('Narrows Pilot');
  });

  it('refuse a ground that is no distance out', async () => {
    harness = cliHarness();
    const result = await harness.invoke('launch', 'ground', 'BUOY', 'Buoy', '0', '200');
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.io.errorText()).toContain('no distance');
  });
});

describe('booking the launch', () => {
  it('offers a trip worked back from the boarding time', async () => {
    harness = cliHarness();
    await fleet();
    const reference = await assigned();
    const result = await harness.invoke('launch', 'offer', reference);
    expect(result.io.text()).toMatch(/B1 leaves at \d{4}-\d{2}-\d{2}T\d{2}:\d{2} for SEA-BUOY/);
  });

  it('books it and gives it back again', async () => {
    harness = cliHarness();
    await fleet();
    const reference = await assigned();
    const booked = await harness.invoke('launch', 'book', reference);
    expect(booked.io.text()).toContain('takes P02 out');
    const released = await harness.invoke('launch', 'release', reference);
    expect(released.io.text()).toContain('1 trips released');
  });

  it('refuses when the swell is over the limit', async () => {
    harness = cliHarness();
    await fleet();
    const reference = await assigned();
    await harness.invoke(
      'weather',
      'log',
      '25',
      '8000',
      '--at',
      '2025-04-03T05:00',
      '--swell',
      '3.00',
    );
    const result = await harness.invoke('launch', 'book', reference);
    expect(result.io.errorText()).toContain('swell');
  });

  it('refuses a movement with no pilot on it', async () => {
    harness = cliHarness();
    await fleet();
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
      '10.00',
      '--at',
      '2025-04-03T06:00',
    );
    const reference = /M-\d{4}-\d{4}/.exec(placed.io.text())?.[0] ?? '';
    const result = await harness.invoke('launch', 'offer', reference);
    expect(result.io.errorText()).toContain('no planned time');
  });

  it('refuses when the district has no boats at all', async () => {
    harness = cliHarness();
    await harness.invoke('launch', 'ground', 'SEA-BUOY', 'Sea Buoy', '25', '200');
    const reference = await assigned();
    const result = await harness.invoke('launch', 'offer', reference);
    expect(result.io.errorText()).toContain('no pilot boats');
  });
});

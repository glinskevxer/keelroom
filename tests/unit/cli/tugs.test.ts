import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_FINDINGS, EXIT_USAGE } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

async function fleet(): Promise<void> {
  await harness!.invoke('tugs', 'add', 'T1', 'Bar Master', 'HARBOUR', '60', '--escort');
  await harness!.invoke('tugs', 'add', 'T2', 'Narrows', 'HARBOUR', '50');
  await harness!.invoke('tugs', 'add', 'T3', 'Upper Reach', 'RIVER', '45');
  await harness!.invoke('tugs', 'add', 'T4', 'Little Star', 'RIVER', '30');
}

async function confirmed(): Promise<string> {
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
  return reference;
}

describe('the fleet', () => {
  it('is empty to begin with', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tugs', 'list');
    expect(result.io.text()).toContain('no tugs on the list');
  });

  it('takes a tug and lists her', async () => {
    harness = cliHarness();
    await fleet();
    const result = await harness.invoke('tugs', 'list');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('Bar Master');
    expect(result.io.text()).toContain('185 tonnes across 2 owners');
  });

  it('shows one tug', async () => {
    harness = cliHarness();
    await fleet();
    const result = await harness.invoke('tugs', 'show', 'T1');
    expect(result.io.text()).toContain('escort fitted  yes');
  });

  it('refuses one nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tugs', 'show', 'T9');
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it('refuses a pull that is not a number', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tugs', 'add', 'T1', 'x', 'HARBOUR', 'strong');
    expect(result.code).toBe(EXIT_USAGE);
  });
});

describe('booking', () => {
  it('offers what could be raised', async () => {
    harness = cliHarness();
    await fleet();
    const reference = await confirmed();
    const result = await harness.invoke('tugs', 'offer', reference);
    expect(result.io.text()).toContain('hulls wanted');
    expect(result.io.text()).toContain('met            yes');
  });

  it('books them and shows them against the movement', async () => {
    harness = cliHarness();
    await fleet();
    const reference = await confirmed();
    const booked = await harness.invoke('tugs', 'book', reference);
    expect(booked.io.text()).toContain('T1');
    const list = await harness.invoke(
      'tugs',
      'booked',
      '--from',
      '2025-04-03T00:00',
      '--days',
      '2',
    );
    expect(list.io.text()).toContain(reference);
  });

  it('gives them back', async () => {
    harness = cliHarness();
    await fleet();
    const reference = await confirmed();
    await harness.invoke('tugs', 'book', reference);
    const released = await harness.invoke('tugs', 'release', reference);
    expect(released.io.text()).toContain('tugs released');
    const list = await harness.invoke(
      'tugs',
      'booked',
      '--from',
      '2025-04-03T00:00',
      '--days',
      '2',
    );
    expect(list.io.text()).toContain('nothing booked');
  });

  it('refuses when the fleet is too small', async () => {
    harness = cliHarness();
    await harness.invoke('tugs', 'add', 'T1', 'Bar Master', 'HARBOUR', '60', '--escort');
    const reference = await confirmed();
    const result = await harness.invoke('tugs', 'book', reference);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.io.errorText()).toContain('cannot be raised');
  });
});

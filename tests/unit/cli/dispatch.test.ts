import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_FINDINGS, EXIT_USAGE } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

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

describe('assigning', () => {
  it('gives the ship to the top of the board', async () => {
    harness = cliHarness();
    const reference = await confirmed();
    const result = await harness.invoke('dispatch', 'assign', reference);
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('P02');
    expect(result.io.text()).toContain('on duty');
  });

  it('takes a named pilot with a reason', async () => {
    harness = cliHarness();
    const reference = await confirmed();
    const result = await harness.invoke(
      'dispatch',
      'assign',
      reference,
      '--pilot',
      'P07',
      '--because',
      'P02 has the tanker',
    );
    expect(result.io.text()).toContain('P07');
    const shown = await harness.invoke('orders', 'show', reference);
    expect(shown.io.text()).toContain('board overridden');
  });

  it('refuses a movement that is not confirmed', async () => {
    harness = cliHarness();
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
    const result = await harness.invoke('dispatch', 'assign', reference);
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.io.errorText()).toContain('not confirmed');
  });
});

describe('following her through', () => {
  it('boards, lets go and completes', async () => {
    harness = cliHarness();
    const reference = await confirmed();
    await harness.invoke('dispatch', 'assign', reference);
    await harness.invoke('dispatch', 'boarded', reference, '--at', '2025-04-03T05:40');
    await harness.invoke('dispatch', 'underway', reference, '--at', '2025-04-03T05:55');
    const done = await harness.invoke(
      'dispatch',
      'complete',
      reference,
      '--at',
      '2025-04-03T08:10',
    );
    expect(done.code).toBe(EXIT_CLEAN);
    expect(done.io.text()).toContain('on board');
    expect(done.io.text()).toContain('detention blocks');
  });

  it('refuses to let go before boarding', async () => {
    harness = cliHarness();
    const reference = await confirmed();
    await harness.invoke('dispatch', 'assign', reference);
    const result = await harness.invoke('dispatch', 'underway', reference);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.io.errorText()).toContain('cannot move from');
  });

  it('records a delay against the movement', async () => {
    harness = cliHarness();
    const reference = await confirmed();
    await harness.invoke('dispatch', 'assign', reference);
    await harness.invoke('dispatch', 'boarded', reference, '--at', '2025-04-03T05:40');
    const result = await harness.invoke(
      'dispatch',
      'delay',
      reference,
      'vessel',
      '2025-04-03T06:00',
      '2025-04-03T06:40',
      '--note',
      'engine not ready',
    );
    expect(result.io.text()).toContain('delayed by vessel');
    await harness.invoke('dispatch', 'underway', reference, '--at', '2025-04-03T06:45');
    const done = await harness.invoke(
      'dispatch',
      'complete',
      reference,
      '--at',
      '2025-04-03T08:10',
    );
    expect(done.io.text()).toContain('detention blocks');
  });

  it('refuses a delay cause nobody records', async () => {
    harness = cliHarness();
    const reference = await confirmed();
    const result = await harness.invoke(
      'dispatch',
      'delay',
      reference,
      'sunspots',
      '2025-04-03T06:00',
      '2025-04-03T06:40',
    );
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.io.errorText()).toContain('a delay cause is one of');
  });
});

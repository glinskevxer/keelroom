import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

async function ranMovement(late = 0): Promise<string> {
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
  const boarded = late > 0 ? '2025-04-03T07:00' : '2025-04-03T05:40';
  await harness!.invoke('dispatch', 'boarded', reference, '--at', boarded);
  await harness!.invoke('dispatch', 'underway', reference, '--at', '2025-04-03T07:10');
  await harness!.invoke('dispatch', 'complete', reference, '--at', '2025-04-03T09:10');
  return reference;
}

describe('the return', () => {
  it('reads as nothing when nothing has run', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'stats',
      'return',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '7',
    );
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('movements         0');
  });

  it('counts what ran and what it was charged', async () => {
    harness = cliHarness();
    await ranMovement();
    const result = await harness.invoke(
      'stats',
      'return',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '7',
    );
    expect(result.io.text()).toContain('completed         1');
    expect(result.io.text()).toContain('charged');
    expect(result.io.text()).toContain('pilots');
  });

  it('reads as one line when asked', async () => {
    harness = cliHarness();
    await ranMovement();
    const result = await harness.invoke(
      'stats',
      'return',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '7',
      '--headline',
    );
    expect(result.io.text()).toMatch(/^1 of 1 movements ran/);
  });

  it('reads as json', async () => {
    harness = cliHarness();
    await ranMovement();
    const result = await harness.invoke(
      '--format',
      'json',
      'stats',
      'return',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '7',
    );
    const parsed = JSON.parse(result.io.text());
    expect(parsed.summary.completed).toBe(1);
    expect(parsed.pilots[0].pilot).toBe('P02');
  });

  it('shows the delay causes when there are any', async () => {
    harness = cliHarness();
    const reference = await ranMovement();
    await harness.invoke(
      'dispatch',
      'delay',
      reference,
      'vessel',
      '2025-04-03T06:00',
      '2025-04-03T06:40',
    );
    const result = await harness.invoke(
      'stats',
      'return',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '7',
    );
    expect(result.io.text()).toContain('vessel');
  });
});

describe('comparing', () => {
  it('puts this period against the one a year earlier', async () => {
    harness = cliHarness();
    await ranMovement();
    const result = await harness.invoke(
      'stats',
      'compare',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '7',
    );
    expect(result.io.text()).toContain('this period:');
    expect(result.io.text()).toContain('a year ago:');
    expect(result.io.text()).toContain('movements up by 1');
  });
});

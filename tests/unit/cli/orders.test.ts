import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CLEAN, EXIT_FINDINGS, EXIT_USAGE } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

async function place(...extra: string[]): Promise<string> {
  const result = await harness!.invoke(
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
    ...extra,
  );
  const match = /M-\d{4}-\d{4}/.exec(result.io.text());
  return match?.[0] ?? '';
}

describe('placing', () => {
  it('takes an order and prints the reference', async () => {
    harness = cliHarness();
    const reference = await place();
    expect(reference).toBe('M-2025-0001');
  });

  it('records a note with the order', async () => {
    harness = cliHarness();
    const reference = await place('--note', 'agent asked for a morning tide');
    const shown = await harness.invoke('orders', 'show', reference);
    expect(shown.io.text()).toContain('agent asked for a morning tide');
  });

  it('refuses a kind nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
      'orders',
      'place',
      '9074729',
      'SEAWAY',
      '--kind',
      'towage',
      '--from',
      'SEA',
      '--to',
      'GRAIN-3',
      '--draught',
      '10.00',
      '--at',
      '2025-04-03T06:00',
    );
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.io.errorText()).toContain('no movement kind');
  });

  it('refuses a draught that is not one', async () => {
    harness = cliHarness();
    const result = await harness.invoke(
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
      'deep',
      '--at',
      '2025-04-03T06:00',
    );
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.io.errorText()).toContain('depth in metres');
  });

  it('needs every required option', async () => {
    harness = cliHarness();
    const result = await harness.invoke('orders', 'place', '9074729', 'SEAWAY');
    expect(result.code).toBe(EXIT_USAGE);
  });
});

describe('listing and showing', () => {
  it('lists what is on the book with a count', async () => {
    harness = cliHarness();
    await place();
    const result = await harness.invoke('orders', 'list', '--days', '5');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('ATLANTIC CROWN');
    expect(result.io.text()).toContain('1 ordered');
  });

  it('filters to one agent', async () => {
    harness = cliHarness();
    await place();
    const mine = await harness.invoke('orders', 'list', '--days', '5', '--agent', 'SEAWAY');
    const theirs = await harness.invoke('orders', 'list', '--days', '5', '--agent', 'NORTH');
    expect(mine.io.text()).toContain('M-2025-0001');
    expect(theirs.io.text()).toContain('nothing on the book');
  });

  it('shows one movement in full', async () => {
    harness = cliHarness();
    const reference = await place();
    const result = await harness.invoke('orders', 'show', reference);
    expect(result.io.text()).toContain('status       ordered');
    expect(result.io.text()).toContain('next states');
    expect(result.io.text()).toContain('notice');
  });

  it('refuses a movement nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke('orders', 'show', 'M-2025-9999');
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.io.errorText()).toContain('no movement with reference');
  });

  it('reads as json', async () => {
    harness = cliHarness();
    const reference = await place();
    const result = await harness.invoke('--format', 'json', 'orders', 'show', reference);
    const parsed = JSON.parse(result.io.text());
    expect(parsed.movement.reference).toBe(reference);
  });
});

describe('changing an order', () => {
  it('amends the draught', async () => {
    harness = cliHarness();
    const reference = await place();
    await harness.invoke('orders', 'amend', reference, '--draught', '9.50');
    const shown = await harness.invoke('orders', 'show', reference);
    expect(shown.io.text()).toContain('9.50 m');
  });

  it('amends the time', async () => {
    harness = cliHarness();
    const reference = await place();
    await harness.invoke('orders', 'amend', reference, '--at', '2025-04-04T07:30');
    const shown = await harness.invoke('orders', 'show', reference);
    expect(shown.io.text()).toContain('2025-04-04T07:30');
  });

  it('cancels with a reason', async () => {
    harness = cliHarness();
    const reference = await place();
    const result = await harness.invoke(
      'orders',
      'cancel',
      reference,
      'ship',
      'delayed',
      'at',
      'sea',
    );
    expect(result.io.text()).toContain(`cancelled ${reference}`);
    const shown = await harness.invoke('orders', 'show', reference);
    expect(shown.io.text()).toContain('cancelled: ship delayed at sea');
  });

  it('refuses with a reason', async () => {
    harness = cliHarness();
    const reference = await place();
    await harness.invoke('orders', 'refuse', reference, 'no', 'window');
    const shown = await harness.invoke('orders', 'show', reference);
    expect(shown.io.text()).toContain('status       refused');
  });
});

describe('importing a file of orders', () => {
  it('takes them all and prints the references', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'orders.csv');
    writeFileSync(
      path,
      `imo,agent,kind,from,to,draught_cm,requested_for,note
9074729,SEAWAY,arrival,SEA,GRAIN-3,1100,2025-04-03T06:00Z,grain
9074705,SEAWAY,arrival,SEA,GRAIN-3,600,2025-04-05T06:00Z,
`,
    );
    const result = await harness.invoke('orders', 'import', path);
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('took 2 orders');
    const listed = await harness.invoke('orders', 'list', '--days', '10');
    expect(listed.io.text()).toContain('M-2025-0002');
  });

  it('refuses the file when one row is bad', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'orders.csv');
    writeFileSync(
      path,
      `imo,agent,kind,from,to,draught_cm,requested_for
9074729,SEAWAY,arrival,SEA,NOWHERE,1100,2025-04-03T06:00Z
`,
    );
    const result = await harness.invoke('orders', 'import', path);
    expect(result.io.errorText()).toContain('no such berth');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../../../src/util/errors';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

async function ranMovement(): Promise<string> {
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
  await harness!.invoke('dispatch', 'boarded', reference, '--at', '2025-04-03T05:40');
  await harness!.invoke('dispatch', 'underway', reference, '--at', '2025-04-03T05:55');
  await harness!.invoke('dispatch', 'complete', reference, '--at', '2025-04-03T08:10');
  return reference;
}

describe('the books', () => {
  it('list the one the harness published', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tariff', 'list');
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('T-2025-A');
    expect(result.io.text()).toContain('in force');
  });

  it('show the one in force with its bands', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tariff', 'show');
    expect(result.io.text()).toContain('bands');
    expect(result.io.text()).toContain('per unit');
  });

  it('show one by name', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tariff', 'show', 'T-2025-A');
    expect(result.io.text()).toContain('T-2025-A');
  });

  it('refuse one nobody published', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tariff', 'show', 'T-1999-A');
    expect(result.code).toBe(EXIT_FINDINGS);
  });
});

describe('publishing', () => {
  it('takes a book from a json file and records it', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'book.json');
    writeFileSync(
      path,
      JSON.stringify({
        id: 'T-2026-A',
        effectiveFrom: '2026-01-01T00:00',
        bands: [{ upTo: 1400, charge: 50000, perUnit: 350 }],
        minimumCharge: 45000,
        detentionBlock: 13000,
        boatFee: 27000,
        adminFee: 4000,
      }),
    );
    const result = await harness.invoke('tariff', 'publish', path);
    expect(result.io.text()).toContain('T-2026-A published');
    const listed = await harness.invoke('tariff', 'list');
    expect(listed.io.text()).toContain('T-2026-A');
    const trail = await harness.invoke('audit', 'show', 'T-2026-A');
    expect(trail.io.text()).toContain('tariff-published');
  });

  it('refuses a book that is not one', async () => {
    harness = cliHarness();
    const path = join(harness.directory, 'book.json');
    writeFileSync(
      path,
      JSON.stringify({
        id: 'nonsense',
        effectiveFrom: '2026-01-01T00:00',
        bands: [],
        minimumCharge: 1,
        detentionBlock: 1,
      }),
    );
    const result = await harness.invoke('tariff', 'publish', path);
    expect(result.io.errorText()).toContain('tariff id must look like');
  });
});

describe('simulating a rise', () => {
  it('reads as nothing when nothing ran', async () => {
    harness = cliHarness();
    const result = await harness.invoke('tariff', 'simulate', '500', '--days', '30');
    expect(result.io.text()).toContain('movements     0');
    expect(result.io.text()).toContain('nothing to reprice');
  });

  it('reprices what ran and splits it by agent', async () => {
    harness = cliHarness();
    await ranMovement();
    const result = await harness.invoke(
      'tariff',
      'simulate',
      '1000',
      '--from',
      '2025-04-01T00:00',
      '--days',
      '7',
    );
    expect(result.io.text()).toContain('overall rise');
    expect(result.io.text()).toContain('SEAWAY');
  });
});

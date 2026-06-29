import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_FINDINGS, EXIT_USAGE } from '../../../src/util/errors';
import { openDatabase } from '../../../src/storage/database';
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

async function invoiced(): Promise<string> {
  await ranMovement();
  const raised = await harness!.invoke('billing', 'raise', 'SEAWAY', '--to', '2025-04-05T00:00');
  return /INV-\d{4}-\d{5}/.exec(raised.io.text())?.[0] ?? '';
}

describe('quoting and pricing', () => {
  it('quotes a movement without writing anything', async () => {
    harness = cliHarness();
    const reference = await ranMovement();
    const result = await harness.invoke('billing', 'quote', reference);
    expect(result.code).toBe(EXIT_CLEAN);
    expect(result.io.text()).toContain('PILOTAGE');
    expect(result.io.text()).toContain('total');
  });

  it('prices it against the book in force', async () => {
    harness = cliHarness();
    const reference = await ranMovement();
    const result = await harness.invoke('billing', 'price', reference);
    expect(result.io.text()).toContain('T-2025-A');
  });

  it('refuses a movement nobody has', async () => {
    harness = cliHarness();
    const result = await harness.invoke('billing', 'quote', 'M-2025-9999');
    expect(result.code).toBe(EXIT_FINDINGS);
  });
});

describe('invoicing', () => {
  it('raises one invoice for the period', async () => {
    harness = cliHarness();
    const number = await invoiced();
    expect(number).toBe('INV-2025-00001');
  });

  it('shows an invoice with its lines and totals', async () => {
    harness = cliHarness();
    const number = await invoiced();
    const result = await harness.invoke('billing', 'show', number);
    expect(result.io.text()).toContain('pilotage');
    expect(result.io.text()).toContain('total');
  });

  it('issues a draft', async () => {
    harness = cliHarness();
    const number = await invoiced();
    const result = await harness.invoke('billing', 'issue', number);
    expect(result.io.text()).toContain('issued');
  });

  it('refuses to bill a period with nothing in it', async () => {
    harness = cliHarness();
    const result = await harness.invoke('billing', 'raise', 'NORTH', '--to', '2025-04-05T00:00');
    expect(result.code).toBe(EXIT_USAGE);
    expect(result.io.errorText()).toContain('nothing to bill');
  });
});

describe('money in', () => {
  it('takes a payment and reports the allocation', async () => {
    harness = cliHarness();
    const number = await invoiced();
    await harness.invoke('billing', 'issue', number);
    const result = await harness.invoke('billing', 'pay', 'SEAWAY', 'TT-44812', '100000');
    expect(result.io.text()).toContain(number);
    expect(result.io.text()).toContain('allocated to 1 invoices');
  });

  it('reports what could not be allocated', async () => {
    harness = cliHarness();
    const number = await invoiced();
    await harness.invoke('billing', 'issue', number);
    const result = await harness.invoke('billing', 'pay', 'SEAWAY', 'TT-2', '99999999');
    expect(result.io.text()).toContain('left unallocated');
  });

  it('raises a credit note', async () => {
    harness = cliHarness();
    const number = await invoiced();
    await harness.invoke('billing', 'issue', number);
    const result = await harness.invoke(
      'billing',
      'credit',
      number,
      'rate-in-error',
      '5000',
      'charged',
      'on',
      'the',
      'wrong',
      'band',
    );
    expect(result.io.text()).toContain('CRN-2025-00001');
  });

  it('refuses a credit reason nobody has', async () => {
    harness = cliHarness();
    const number = await invoiced();
    await harness.invoke('billing', 'issue', number);
    const result = await harness.invoke('billing', 'credit', number, 'because', '100', 'x');
    expect(result.io.errorText()).toContain('no credit reason');
  });
});

describe('what is owed', () => {
  it('prints a statement with the ageing', async () => {
    harness = cliHarness();
    const number = await invoiced();
    await harness.invoke('billing', 'issue', number);
    const result = await harness.invoke('billing', 'statement', 'SEAWAY');
    expect(result.io.text()).toContain('open invoices');
    expect(result.io.text()).toContain('ageing');
  });

  it('prints the overdue list', async () => {
    harness = cliHarness();
    const number = await invoiced();
    await harness.invoke('billing', 'issue', number);
    const result = await harness.invoke('billing', 'overdue', 'SEAWAY');
    expect(result.io.text()).toContain('nothing overdue');
  });
});

describe('deposits', () => {
  it('lodge money and show what is held', async () => {
    harness = cliHarness();
    const lodged = await harness.invoke('billing', 'deposit', 'NORTH', 'DEP-001', '500000');
    expect(lodged.io.text()).toContain('5,000.00 held for NORTH');
    const shown = await harness.invoke('billing', 'deposits', 'NORTH');
    expect(shown.io.text()).toContain('DEP-001');
    expect(shown.io.text()).toContain('NORTH holds 5,000.00');
  });

  it('say when nothing is lodged', async () => {
    harness = cliHarness();
    const result = await harness.invoke('billing', 'deposits', 'SEAWAY');
    expect(result.io.text()).toContain('nothing lodged');
  });

  it('draw a movement charge down against them', async () => {
    harness = cliHarness();
    const reference = await ranMovement();
    await harness.invoke('billing', 'deposit', 'SEAWAY', 'DEP-002', '20000');
    const result = await harness.invoke('billing', 'draw', reference);
    expect(result.io.text()).toContain('200.00 drawn');
    expect(result.io.text()).toContain('left to invoice');
  });

  it('refuse an order from an agent who works on deposit and has lodged nothing', async () => {
    harness = cliHarness();
    const database = harness.databasePath;
    const db = openDatabase(database);
    db.prepare('update account set requires_deposit = 1 where agent = ?').run('NORTH');
    db.close();
    const refused = await harness.invoke(
      'orders',
      'place',
      '9074705',
      'NORTH',
      '--kind',
      'arrival',
      '--from',
      'SEA',
      '--to',
      'GRAIN-3',
      '--draught',
      '6.00',
      '--at',
      '2025-04-03T06:00',
    );
    expect(refused.io.errorText()).toContain('works on deposit');
    await harness.invoke('billing', 'deposit', 'NORTH', 'DEP-009', '500000');
    const taken = await harness.invoke(
      'orders',
      'place',
      '9074705',
      'NORTH',
      '--kind',
      'arrival',
      '--from',
      'SEA',
      '--to',
      'GRAIN-3',
      '--draught',
      '6.00',
      '--at',
      '2025-04-03T06:00',
    );
    expect(taken.io.text()).toContain('taken as');
  });
});

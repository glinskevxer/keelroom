import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { TransitionError } from '../../../src/util/errors';
import { makeLine } from '../../../src/domain/tariff/charge';
import {
  allLines,
  daysOverdue,
  describeInvoice,
  grossTotal,
  isOutstanding,
  isOverdue,
  makeInvoice,
  makeInvoiceNumber,
  moveTo,
  netTotal,
  nextInvoiceNumber,
  taxTotal,
  totalForCode,
} from '../../../src/domain/billing/invoice';
import type { Invoice } from '../../../src/domain/billing/invoice';

const RAISED = parseInstant('2025-06-30T09:00Z');
const DUE = parseInstant('2025-07-30T09:00Z');

const ITEMS = [
  {
    movement: 'M-2025-0004',
    lines: [makeLine('PILOTAGE', 'pilotage', 259300), makeLine('BOAT', 'boat', 25000)],
  },
  {
    movement: 'M-2025-0009',
    lines: [makeLine('PILOTAGE', 'pilotage', 141000), makeLine('DISCOUNT', 'discount', -14100)],
  },
];

function invoice(overrides: Partial<Parameters<typeof makeInvoice>[0]> = {}): Invoice {
  return makeInvoice({
    number: 'INV-2025-00042',
    agent: 'SEAWAY',
    raisedAt: RAISED,
    dueAt: DUE,
    items: ITEMS,
    taxRate: 1500,
    ...overrides,
  });
}

describe('numbering', () => {
  it('pads the sequence to five digits', () => {
    expect(makeInvoiceNumber(2025, 42)).toBe('INV-2025-00042');
  });

  it('issues the next in a year', () => {
    expect(nextInvoiceNumber(2025, [])).toBe('INV-2025-00001');
    expect(nextInvoiceNumber(2025, ['INV-2025-00041', 'INV-2024-09999'])).toBe('INV-2025-00042');
  });

  it('refuses what is not a number', () => {
    expect(() => makeInvoiceNumber(1999, 1)).toThrow(/not a year/);
    expect(() => makeInvoiceNumber(2025, 0)).toThrow(/outside the invoice sequence/);
  });
});

describe('building an invoice', () => {
  it('keeps what it was given and starts as a draft', () => {
    const one = invoice();
    expect(one.status).toBe('draft');
    expect(one.currency).toBe('USD');
    expect(one.items).toHaveLength(2);
  });

  it('refuses an invoice that is not one', () => {
    expect(() => invoice({ number: '42' })).toThrow(/not an invoice number/);
    expect(() => invoice({ items: [] })).toThrow(/nothing on it/);
    expect(() => invoice({ dueAt: RAISED - 60 })).toThrow(/falls due before/);
    expect(() => invoice({ taxRate: 9000 })).toThrow(/tax rate that is not one/);
  });

  it('refuses a movement carried twice or with no lines', () => {
    expect(() => invoice({ items: [ITEMS[0]!, ITEMS[0]!] })).toThrow(/twice/);
    expect(() => invoice({ items: [{ movement: 'M-2025-0004', lines: [] }] })).toThrow(/no lines/);
  });

  it('refuses a line that is not whole cents', () => {
    expect(() =>
      invoice({
        items: [{ movement: 'M-1', lines: [{ code: 'X', description: 'x', amount: 1.5 }] }],
      }),
    ).toThrow(/whole cents/);
  });
});

describe('the totals', () => {
  const one = invoice();

  it('adds the lines to the net', () => {
    expect(netTotal(one)).toBe(259300 + 25000 + 141000 - 14100);
  });

  it('takes the tax on the net', () => {
    expect(taxTotal(one)).toBe(Math.round(netTotal(one) * 0.15));
    expect(grossTotal(one)).toBe(netTotal(one) + taxTotal(one));
  });

  it('charges no tax where there is no rate', () => {
    const free = invoice({ taxRate: 0 });
    expect(taxTotal(free)).toBe(0);
    expect(grossTotal(free)).toBe(netTotal(free));
  });

  it('totals one code across the invoice', () => {
    expect(totalForCode(one, 'PILOTAGE')).toBe(400300);
    expect(totalForCode(one, 'DETENTION')).toBe(0);
    expect(allLines(one)).toHaveLength(4);
  });
});

describe('the invoice lifecycle', () => {
  it('issues a draft', () => {
    expect(moveTo(invoice(), 'issued').status).toBe('issued');
  });

  it('refuses to pay a draft', () => {
    expect(() => moveTo(invoice(), 'paid')).toThrow(TransitionError);
  });

  it('lets a disputed invoice go back to issued or be written off', () => {
    const disputed = moveTo(moveTo(invoice(), 'issued'), 'disputed');
    expect(moveTo(disputed, 'issued').status).toBe('issued');
    expect(moveTo(disputed, 'written-off').status).toBe('written-off');
  });

  it('refuses to move a paid invoice at all', () => {
    const paid = moveTo(moveTo(invoice(), 'issued'), 'paid');
    expect(() => moveTo(paid, 'disputed')).toThrow(/does not go that way/);
  });

  it('reads which invoices are outstanding and overdue', () => {
    const issued = moveTo(invoice(), 'issued');
    expect(isOutstanding(issued)).toBe(true);
    expect(isOverdue(issued, DUE + 1)).toBe(true);
    expect(isOverdue(issued, DUE - 1)).toBe(false);
    expect(daysOverdue(issued, DUE + 1440 * 3)).toBe(3);
    expect(daysOverdue(issued, DUE - 1)).toBe(0);
  });

  it('reads a paid invoice as neither', () => {
    const paid = moveTo(moveTo(invoice(), 'issued'), 'paid');
    expect(isOutstanding(paid)).toBe(false);
    expect(isOverdue(paid, DUE + 10000)).toBe(false);
  });

  it('describes itself in one line', () => {
    expect(describeInvoice(invoice(), 0)).toContain('INV-2025-00042 SEAWAY 2025-06-30');
  });
});

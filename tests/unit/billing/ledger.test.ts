import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeLine } from '../../../src/domain/tariff/charge';
import { makeInvoice, moveTo } from '../../../src/domain/billing/invoice';
import type { Invoice } from '../../../src/domain/billing/invoice';
import {
  ageing,
  allocate,
  balanceFor,
  makePayment,
  oldestOutstanding,
  outstandingOn,
} from '../../../src/domain/billing/ledger';

const DAY = 1440;
const JAN = parseInstant('2025-01-10T09:00Z');

function invoice(number: string, raised: number, amount: number, agent = 'SEAWAY'): Invoice {
  return moveTo(
    makeInvoice({
      number,
      agent,
      raisedAt: raised,
      dueAt: raised + 30 * DAY,
      items: [
        { movement: `M-${number.slice(-4)}`, lines: [makeLine('PILOTAGE', 'pilotage', amount)] },
      ],
    }),
    'issued',
  );
}

const INVOICES = [
  invoice('INV-2025-00001', JAN, 100000),
  invoice('INV-2025-00002', JAN + 40 * DAY, 200000),
  invoice('INV-2025-00003', JAN + 80 * DAY, 50000, 'NORTH'),
];

describe('a payment', () => {
  it('takes a reference and a positive amount', () => {
    const payment = makePayment({
      reference: ' TT 44812 ',
      agent: 'SEAWAY',
      amount: 150000,
      receivedAt: JAN,
    });
    expect(payment.reference).toBe('TT 44812');
  });

  it('refuses one that is not', () => {
    const base = { agent: 'SEAWAY', amount: 100, receivedAt: JAN };
    expect(() => makePayment({ ...base, reference: ' ' })).toThrow(/needs a reference/);
    expect(() => makePayment({ ...base, reference: 'x', amount: 0 })).toThrow(/positive amount/);
    expect(() => makePayment({ ...base, reference: 'x', amount: 1.5 })).toThrow(/whole cents/);
  });
});

describe('allocation', () => {
  const payment = makePayment({
    reference: 'TT 44812',
    agent: 'SEAWAY',
    amount: 250000,
    receivedAt: JAN + 90 * DAY,
  });

  it('sets a payment against the oldest invoice first', () => {
    const result = allocate(payment, INVOICES);
    expect(result.allocations).toEqual([
      { invoice: 'INV-2025-00001', amount: 100000 },
      { invoice: 'INV-2025-00002', amount: 150000 },
    ]);
    expect(result.unallocated).toBe(0);
  });

  it('leaves the rest unallocated when everything is covered', () => {
    const big = makePayment({
      reference: 'TT 2',
      agent: 'SEAWAY',
      amount: 400000,
      receivedAt: JAN,
    });
    expect(allocate(big, INVOICES).unallocated).toBe(100000);
  });

  it('never touches another agent invoices', () => {
    const result = allocate(payment, INVOICES);
    expect(result.allocations.some((one) => one.invoice === 'INV-2025-00003')).toBe(false);
  });

  it('skips an invoice that is already paid off', () => {
    const already = [{ invoice: 'INV-2025-00001', amount: 100000 }];
    const result = allocate(payment, INVOICES, [], already);
    expect(result.allocations).toEqual([{ invoice: 'INV-2025-00002', amount: 200000 }]);
    expect(result.unallocated).toBe(50000);
  });

  it('takes credits into account before allocating', () => {
    const credits = [
      {
        number: 'CRN-2025-00001',
        invoice: 'INV-2025-00001',
        agent: 'SEAWAY',
        reason: 'goodwill' as const,
        amount: 25000,
        raisedAt: JAN,
        note: 'x',
      },
    ];
    const result = allocate(payment, INVOICES, credits);
    expect(result.allocations[0]).toEqual({ invoice: 'INV-2025-00001', amount: 75000 });
  });
});

describe('balances', () => {
  it('adds up what one agent owes', () => {
    expect(balanceFor('SEAWAY', INVOICES)).toBe(300000);
    expect(balanceFor('NORTH', INVOICES)).toBe(50000);
    expect(balanceFor('NOBODY', INVOICES)).toBe(0);
  });

  it('takes payments and credits off', () => {
    const allocations = [{ invoice: 'INV-2025-00001', amount: 60000 }];
    expect(balanceFor('SEAWAY', INVOICES, [], allocations)).toBe(240000);
  });

  it('never reads an overpaid invoice as a negative', () => {
    const allocations = [{ invoice: 'INV-2025-00001', amount: 500000 }];
    expect(outstandingOn(INVOICES[0]!, [], allocations)).toBe(0);
  });

  it('finds the oldest one still owing', () => {
    expect(oldestOutstanding('SEAWAY', INVOICES)?.number).toBe('INV-2025-00001');
    const allocations = [{ invoice: 'INV-2025-00001', amount: 100000 }];
    expect(oldestOutstanding('SEAWAY', INVOICES, [], allocations)?.number).toBe('INV-2025-00002');
    expect(oldestOutstanding('NOBODY', INVOICES)).toBeUndefined();
  });
});

describe('ageing', () => {
  it('puts an invoice not yet due in the current bucket', () => {
    const buckets = ageing('SEAWAY', INVOICES, JAN + 5 * DAY);
    expect(buckets.current).toBe(300000);
    expect(buckets.thirty).toBe(0);
  });

  it('moves it along as it ages', () => {
    expect(ageing('SEAWAY', INVOICES, JAN + 45 * DAY).thirty).toBe(100000);
    expect(ageing('SEAWAY', INVOICES, JAN + 80 * DAY).sixty).toBe(100000);
    expect(ageing('SEAWAY', INVOICES, JAN + 110 * DAY).ninety).toBe(100000);
    expect(ageing('SEAWAY', INVOICES, JAN + 200 * DAY).older).toBe(300000);
  });

  it('totals to the balance', () => {
    const buckets = ageing('SEAWAY', INVOICES, JAN + 45 * DAY);
    expect(buckets.total).toBe(balanceFor('SEAWAY', INVOICES));
    expect(buckets.current + buckets.thirty + buckets.sixty + buckets.ninety + buckets.older).toBe(
      buckets.total,
    );
  });

  it('leaves out an invoice that has been paid', () => {
    const allocations = [
      { invoice: 'INV-2025-00001', amount: 100000 },
      { invoice: 'INV-2025-00002', amount: 200000 },
    ];
    expect(ageing('SEAWAY', INVOICES, JAN + 200 * DAY, [], allocations).total).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeLine } from '../../../src/domain/tariff/charge';
import { makeInvoice, moveTo } from '../../../src/domain/billing/invoice';
import type { Invoice } from '../../../src/domain/billing/invoice';
import {
  ceilingFor,
  creditedTotal,
  creditsByReason,
  fullyCredited,
  makeCreditNumber,
  netOfCredits,
  nextCreditNumber,
  raiseCredit,
} from '../../../src/domain/billing/credit';

const RAISED = parseInstant('2025-06-30T09:00Z');
const DUE = parseInstant('2025-07-30T09:00Z');

function invoice(lines = [makeLine('PILOTAGE', 'pilotage', 100000)]): Invoice {
  return moveTo(
    makeInvoice({
      number: 'INV-2025-00042',
      agent: 'SEAWAY',
      raisedAt: RAISED,
      dueAt: DUE,
      items: [{ movement: 'M-2025-0004', lines }],
    }),
    'issued',
  );
}

describe('numbering', () => {
  it('pads the sequence', () => {
    expect(makeCreditNumber(2025, 7)).toBe('CRN-2025-00007');
    expect(nextCreditNumber(2025, ['CRN-2025-00006'])).toBe('CRN-2025-00007');
    expect(nextCreditNumber(2025, [])).toBe('CRN-2025-00001');
  });

  it('refuses what is not a number', () => {
    expect(() => makeCreditNumber(2025, 0)).toThrow(/outside the credit note sequence/);
    expect(() => makeCreditNumber(1999, 1)).toThrow(/not a year/);
  });
});

describe('raising a credit', () => {
  it('credits a movement that never ran', () => {
    const credit = raiseCredit({
      number: 'CRN-2025-00001',
      invoice: invoice(),
      reason: 'movement-not-run',
      amount: 100000,
      raisedAt: RAISED,
      note: 'ship sailed without a pilot in error',
    });
    expect(credit.amount).toBe(100000);
    expect(credit.agent).toBe('SEAWAY');
    expect(credit.invoice).toBe('INV-2025-00042');
  });

  it('refuses a credit for more than the invoice', () => {
    expect(() =>
      raiseCredit({
        number: 'CRN-2025-00001',
        invoice: invoice(),
        reason: 'rate-in-error',
        amount: 150000,
        raisedAt: RAISED,
        note: 'wrong band',
      }),
    ).toThrow(/more than the invoice/);
  });

  it('counts the credits already raised against the same invoice', () => {
    const first = raiseCredit({
      number: 'CRN-2025-00001',
      invoice: invoice(),
      reason: 'rate-in-error',
      amount: 60000,
      raisedAt: RAISED,
      note: 'wrong band',
    });
    expect(() =>
      raiseCredit({
        number: 'CRN-2025-00002',
        invoice: invoice(),
        reason: 'rate-in-error',
        amount: 60000,
        raisedAt: RAISED,
        note: 'wrong band again',
        existing: [first],
      }),
    ).toThrow(/more than the invoice/);
  });

  it('holds goodwill to a quarter of the invoice', () => {
    expect(ceilingFor('goodwill')).toBe(2500);
    expect(() =>
      raiseCredit({
        number: 'CRN-2025-00001',
        invoice: invoice(),
        reason: 'goodwill',
        amount: 30000,
        raisedAt: RAISED,
        note: 'agent unhappy about the delay',
      }),
    ).toThrow(/the reason allows/);
    expect(
      raiseCredit({
        number: 'CRN-2025-00001',
        invoice: invoice(),
        reason: 'goodwill',
        amount: 25000,
        raisedAt: RAISED,
        note: 'agent unhappy about the delay',
      }).amount,
    ).toBe(25000);
  });

  it('refuses to credit detention that is not on the invoice', () => {
    expect(() =>
      raiseCredit({
        number: 'CRN-2025-00001',
        invoice: invoice(),
        reason: 'detention-in-error',
        amount: 10000,
        raisedAt: RAISED,
        note: 'tug was late',
      }),
    ).toThrow(/not that much detention/);
  });

  it('credits detention that is', () => {
    const withDetention = invoice([
      makeLine('PILOTAGE', 'pilotage', 100000),
      makeLine('DETENTION', 'detention', 24000),
    ]);
    const credit = raiseCredit({
      number: 'CRN-2025-00001',
      invoice: withDetention,
      reason: 'detention-in-error',
      amount: 24000,
      raisedAt: RAISED,
      note: 'tug was late and that is ours',
    });
    expect(credit.amount).toBe(24000);
  });

  it('refuses a credit against an invoice that is not open', () => {
    const paid = moveTo(invoice(), 'paid');
    expect(() =>
      raiseCredit({
        number: 'CRN-2025-00001',
        invoice: paid,
        reason: 'goodwill',
        amount: 1000,
        raisedAt: RAISED,
        note: 'x',
      }),
    ).toThrow(/not open to a credit/);
  });

  it('refuses a credit note that is not one', () => {
    const base = {
      invoice: invoice(),
      reason: 'goodwill' as const,
      amount: 1000,
      raisedAt: RAISED,
      note: 'x',
    };
    expect(() => raiseCredit({ ...base, number: 'CRN-1' })).toThrow(/not a credit note number/);
    expect(() => raiseCredit({ ...base, number: 'CRN-2025-00001', amount: 0 })).toThrow(
      /positive amount/,
    );
    expect(() => raiseCredit({ ...base, number: 'CRN-2025-00001', note: ' ' })).toThrow(
      /reason in words/,
    );
  });
});

describe('reading the credits', () => {
  const credits = [
    {
      number: 'CRN-2025-00001',
      invoice: 'INV-2025-00042',
      agent: 'SEAWAY',
      reason: 'goodwill' as const,
      amount: 10000,
      raisedAt: RAISED,
      note: 'x',
    },
    {
      number: 'CRN-2025-00002',
      invoice: 'INV-2025-00043',
      agent: 'SEAWAY',
      reason: 'rate-in-error' as const,
      amount: 5000,
      raisedAt: RAISED,
      note: 'y',
    },
  ];

  it('totals what has been credited against one invoice', () => {
    expect(creditedTotal(credits, 'INV-2025-00042')).toBe(10000);
    expect(creditedTotal(credits, 'INV-2025-00099')).toBe(0);
  });

  it('nets an invoice off against its credits', () => {
    expect(netOfCredits(invoice(), credits)).toBe(90000);
    expect(fullyCredited(invoice(), credits)).toBe(false);
  });

  it('reads an invoice credited to nothing as fully credited', () => {
    const full = [{ ...credits[0]!, amount: 100000 }];
    expect(fullyCredited(invoice(), full)).toBe(true);
  });

  it('groups by reason for the monthly return', () => {
    expect(creditsByReason(credits)).toEqual({ goodwill: 10000, 'rate-in-error': 5000 });
  });
});

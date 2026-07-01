import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, parseInstant } from '../../../src/util/clock';
import {
  describeDispute,
  disputeGrounds,
  disputedOn,
  isDisputeGround,
  isOpen,
  openFor,
  overdue,
  raiseDispute,
  settle,
} from '../../../src/domain/billing/dispute';
import type { Dispute } from '../../../src/domain/billing/dispute';

const T = parseInstant('2025-06-01T09:00Z');

function dispute(overrides: Partial<Parameters<typeof raiseDispute>[0]> = {}): Dispute {
  return raiseDispute({
    invoice: 'INV-2025-00042',
    agent: 'SEAWAY',
    ground: 'wrong-rate',
    amount: 50000,
    raisedAt: T,
    note: 'charged on the deep draught band and she was in ballast',
    ...overrides,
  });
}

describe('raising one', () => {
  it('starts open', () => {
    expect(dispute().outcome).toBe('open');
    expect(isOpen(dispute())).toBe(true);
  });

  it('lists the grounds the district recognises', () => {
    expect(disputeGrounds().length).toBeGreaterThan(4);
    expect(isDisputeGround('wrong-units')).toBe(true);
    expect(isDisputeGround('because')).toBe(false);
  });

  it('refuses one that is not a dispute', () => {
    expect(() => dispute({ ground: 'because' })).toThrow(/not a ground/);
    expect(() => dispute({ amount: 0 })).toThrow(/positive amount/);
    expect(() => dispute({ note: 'no' })).toThrow(/what the agent actually said/);
    expect(() => dispute({ amount: 1.5 })).toThrow(/whole cents/);
  });

  it('describes itself in a line', () => {
    expect(describeDispute(dispute())).toContain('INV-2025-00042 wrong-rate (open)');
  });
});

describe('settling one', () => {
  it('records the outcome and the answer', () => {
    const settled = settle(dispute(), 'upheld', T + 1440, 'she was in ballast, credit raised');
    expect(settled.outcome).toBe('upheld');
    expect(settled.settledAt).toBe(T + 1440);
    expect(isOpen(settled)).toBe(false);
  });

  it('refuses to settle one twice', () => {
    const settled = settle(dispute(), 'rejected', T, 'the declaration says otherwise');
    expect(() => settle(settled, 'upheld', T, 'changed my mind')).toThrow(/settled already/);
  });

  it('refuses an answer that says nothing', () => {
    expect(() => settle(dispute(), 'upheld', T, '  ')).toThrow(/answer in words/);
  });
});

describe('reading the disputes', () => {
  const disputes = [
    dispute(),
    dispute({ invoice: 'INV-2025-00043', amount: 20000, raisedAt: T - 30 * MINUTES_PER_DAY }),
    settle(dispute({ invoice: 'INV-2025-00044' }), 'rejected', T, 'the rate is the published one'),
  ];

  it('total what is under dispute on one invoice', () => {
    expect(disputedOn(disputes, 'INV-2025-00042')).toBe(50000);
    expect(disputedOn(disputes, 'INV-2025-00044')).toBe(0);
  });

  it('list what is open for an agent', () => {
    expect(openFor(disputes, 'SEAWAY')).toHaveLength(2);
    expect(openFor(disputes, 'NORTH')).toEqual([]);
  });

  it('flag the ones nobody has answered', () => {
    const late = overdue(disputes, T, 14);
    expect(late.map((each) => each.invoice)).toEqual(['INV-2025-00043']);
    expect(overdue(disputes, T, 60)).toEqual([]);
  });
});

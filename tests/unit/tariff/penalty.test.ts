import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeBook } from '../../../src/domain/tariff/book';
import {
  cancellationCharge,
  cancellationLines,
  detentionLines,
  freeCancellationHours,
  makePenaltyRules,
  STANDARD_PENALTIES,
} from '../../../src/domain/tariff/penalty';

const BOOK = makeBook({
  id: 'T-2025-A',
  effectiveFrom: parseInstant('2025-01-01T00:00Z'),
  bands: [{ upTo: 1000, charge: 45000, perUnit: 300 }],
  minimumCharge: 40000,
  detentionBlock: 12000,
});

const BASE = 200000;

describe('the scale', () => {
  it('takes the standard steps', () => {
    expect(makePenaltyRules().steps).toHaveLength(3);
    expect(freeCancellationHours(STANDARD_PENALTIES)).toBe(6);
  });

  it('refuses a scale that is not one', () => {
    expect(() => makePenaltyRules({ steps: [] })).toThrow(/no steps/);
    expect(() =>
      makePenaltyRules({
        steps: [
          { noticeHours: 2, rate: 5000 },
          { noticeHours: 6, rate: 0 },
        ],
      }),
    ).toThrow(/most notice to least/);
    expect(() => makePenaltyRules({ steps: [{ noticeHours: 6, rate: 20000 }] })).toThrow(
      /not a portion/,
    );
    expect(() => makePenaltyRules({ steps: [{ noticeHours: 1.5, rate: 0 }] })).toThrow(InputError);
  });
});

describe('cancelling', () => {
  it('charges nothing on plenty of notice', () => {
    const cancellation = cancellationCharge(STANDARD_PENALTIES, {
      base: BASE,
      noticeHours: 24,
      status: 'confirmed',
    });
    expect(cancellation.amount).toBe(0);
    expect(cancellation.reason).toBe('CAN-FREE-01');
    expect(
      cancellationLines(STANDARD_PENALTIES, { base: BASE, noticeHours: 24, status: 'confirmed' }),
    ).toEqual([]);
  });

  it('charges half inside six hours', () => {
    const cancellation = cancellationCharge(STANDARD_PENALTIES, {
      base: BASE,
      noticeHours: 4,
      status: 'assigned',
    });
    expect(cancellation.amount).toBe(100000);
    expect(cancellation.reason).toBe('CAN-LATE-02');
  });

  it('charges the lot inside two', () => {
    expect(
      cancellationCharge(STANDARD_PENALTIES, { base: BASE, noticeHours: 1, status: 'assigned' })
        .amount,
    ).toBe(200000);
  });

  it('charges the lot once the pilot is aboard, whatever the notice', () => {
    const cancellation = cancellationCharge(STANDARD_PENALTIES, {
      base: BASE,
      noticeHours: 48,
      status: 'boarded',
    });
    expect(cancellation.amount).toBe(200000);
    expect(cancellation.reason).toBe('CAN-ABOARD-03');
  });

  it('charges nothing when the district cancels', () => {
    const cancellation = cancellationCharge(STANDARD_PENALTIES, {
      base: BASE,
      noticeHours: 0,
      status: 'boarded',
      byDistrict: true,
    });
    expect(cancellation.amount).toBe(0);
    expect(cancellation.reason).toBe('CAN-PORT-04');
  });

  it('reads a step exactly at its boundary as the cheaper one', () => {
    expect(
      cancellationCharge(STANDARD_PENALTIES, { base: BASE, noticeHours: 6, status: 'confirmed' })
        .amount,
    ).toBe(0);
    expect(
      cancellationCharge(STANDARD_PENALTIES, { base: BASE, noticeHours: 2, status: 'confirmed' })
        .amount,
    ).toBe(100000);
  });

  it('writes the line the invoice carries', () => {
    const lines = cancellationLines(STANDARD_PENALTIES, {
      base: BASE,
      noticeHours: 1,
      status: 'confirmed',
    });
    expect(lines[0]?.code).toBe('CANCEL');
    expect(lines[0]?.description).toContain('100 percent');
  });

  it('refuses a scale that does not cover the notice given', () => {
    const rules = makePenaltyRules({ steps: [{ noticeHours: 6, rate: 0 }] });
    expect(() =>
      cancellationCharge(rules, { base: BASE, noticeHours: 1, status: 'confirmed' }),
    ).toThrow(/does not cover/);
  });
});

describe('detention', () => {
  it('charges by the block', () => {
    expect(detentionLines(BOOK, 3)[0]?.amount).toBe(36000);
    expect(detentionLines(BOOK, 1)[0]?.description).toContain('1 blocks');
  });

  it('charges nothing for no blocks', () => {
    expect(detentionLines(BOOK, 0)).toEqual([]);
  });

  it('charges nothing where the book has no detention rate', () => {
    const free = makeBook({
      id: 'T-2025-B',
      effectiveFrom: parseInstant('2025-01-01T00:00Z'),
      bands: [{ upTo: 1000, charge: 45000, perUnit: 300 }],
      minimumCharge: 0,
      detentionBlock: 0,
    });
    expect(detentionLines(free, 4)).toEqual([]);
  });

  it('refuses a part block', () => {
    expect(() => detentionLines(BOOK, 1.5)).toThrow(/whole blocks/);
    expect(() => detentionLines(BOOK, -1)).toThrow(InputError);
  });
});

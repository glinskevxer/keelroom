import { describe, expect, it } from 'vitest';
import { parseLocal } from '../../../src/util/clock';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { makeBook } from '../../../src/domain/tariff/book';
import { makeCalendar } from '../../../src/domain/tariff/calendar';
import { totalOf } from '../../../src/domain/tariff/charge';
import { assessMovement, comparePriced, printedOrder } from '../../../src/domain/tariff/assess';
import type { AssessmentRequest } from '../../../src/domain/tariff/assess';

const OFFSET = -240;
const at = (text: string): number => parseLocal(text, OFFSET);

const BOOK = makeBook({
  id: 'T-2025-A',
  effectiveFrom: at('2025-01-01T00:00'),
  bands: [
    { upTo: 100, charge: 45000, perUnit: 0 },
    { upTo: 400, charge: 45000, perUnit: 320 },
    { upTo: 1000, charge: 141000, perUnit: 260 },
  ],
  minimumCharge: 40000,
  detentionBlock: 12000,
  boatFee: 25000,
  adminFee: 3500,
  kindMultiplier: { shift: 700 },
});

const SHIP = makeVessel({
  imo: '9074729',
  name: 'atlantic crown',
  type: 'bulk',
  length: 22500,
  beam: 3220,
  summerDraught: 1250,
  airDraught: 4200,
  grossTonnage: 43000,
});

function request(overrides: Partial<AssessmentRequest> = {}): AssessmentRequest {
  return {
    book: BOOK,
    calendar: makeCalendar({ holidays: ['2025-07-01'] }),
    offset: OFFSET,
    vessel: SHIP,
    kind: 'arrival',
    draught: 1100,
    at: at('2025-05-07T14:00'),
    noticeHours: 48,
    ...overrides,
  };
}

describe('an ordinary movement', () => {
  const assessment = assessMovement(request());

  it('charges the pilotage, the boat and the administration', () => {
    expect(assessment.lines.map((line) => line.code)).toEqual(['PILOTAGE', 'BOAT', 'ADMIN']);
    expect(assessment.total).toBe(assessment.base + 28500);
  });

  it('reads the units off the marks', () => {
    expect(assessment.units).toBe(906);
  });

  it('charges at the declared draught when the district asks it to', () => {
    const declared = assessMovement(request({ chargeAtDeclaredDraught: true }));
    expect(declared.units).toBeLessThan(assessment.units);
    expect(declared.total).toBeLessThan(assessment.total);
  });

  it('names the book it was priced on', () => {
    expect(assessment.book).toBe('T-2025-A');
  });
});

describe('the order the tariff applies things in', () => {
  it('takes surcharges on the pilotage but not on the disbursements', () => {
    const night = assessMovement(request({ at: at('2025-05-07T02:00') }));
    const day = assessMovement(request());
    expect(night.surcharges).toBe(Math.round(day.base * 0.25));
    expect(night.disbursements).toBe(day.disbursements);
  });

  it('discounts the pilotage and the surcharges together', () => {
    const plain = assessMovement(request({ at: at('2025-05-07T02:00') }));
    const discounted = assessMovement(request({ at: at('2025-05-07T02:00'), discount: 1000 }));
    expect(discounted.discount).toBe(Math.round((plain.base + plain.surcharges) * 0.1));
    expect(discounted.total).toBe(plain.total - discounted.discount);
  });

  it('leaves the disbursements out of the discount', () => {
    const discounted = assessMovement(request({ discount: 10000 }));
    expect(discounted.total).toBe(discounted.disbursements);
  });

  it('adds detention after the discount', () => {
    const withDetention = assessMovement(request({ detentionBlocks: 2, discount: 5000 }));
    const without = assessMovement(request({ discount: 5000 }));
    expect(withDetention.total - without.total).toBe(24000);
    expect(withDetention.detention).toBe(24000);
  });

  it('adds up to the sum of its lines', () => {
    const heavy = assessMovement(
      request({ at: at('2025-07-01T02:00'), draught: 1300, detentionBlocks: 1, discount: 750 }),
    );
    expect(heavy.total).toBe(totalOf(heavy.lines));
  });

  it('discounts a shift by the kind multiplier before anything else', () => {
    const shift = assessMovement(request({ kind: 'shift' }));
    const arrival = assessMovement(request());
    expect(shift.base).toBe(Math.round(arrival.base * 0.7));
  });
});

describe('a cancelled movement', () => {
  it('charges nothing but the disbursements on plenty of notice', () => {
    const cancelled = assessMovement(
      request({ cancelled: { status: 'confirmed' }, noticeHours: 24 }),
    );
    expect(cancelled.lines.map((line) => line.code)).toEqual(['BOAT', 'ADMIN']);
    expect(cancelled.total).toBe(28500);
  });

  it('charges the scale inside it', () => {
    const cancelled = assessMovement(
      request({ cancelled: { status: 'confirmed' }, noticeHours: 3 }),
    );
    expect(cancelled.lines[0]?.code).toBe('CANCEL');
    expect(cancelled.total).toBeGreaterThan(28500);
  });

  it('takes no surcharge and no detention on a cancellation', () => {
    const cancelled = assessMovement(
      request({
        cancelled: { status: 'boarded' },
        at: at('2025-07-01T02:00'),
        detentionBlocks: 4,
      }),
    );
    expect(cancelled.surcharges).toBe(0);
    expect(cancelled.detention).toBe(0);
  });

  it('charges nothing when the district cancelled', () => {
    const cancelled = assessMovement(
      request({ cancelled: { status: 'boarded', byDistrict: true }, noticeHours: 0 }),
    );
    expect(cancelled.total).toBe(28500);
  });
});

describe('comparing books', () => {
  it('shows what a rate rise does to one movement', () => {
    const dearer = makeBook({
      id: 'T-2026-A',
      effectiveFrom: at('2026-01-01T00:00'),
      bands: [{ upTo: 1000, charge: 160000, perUnit: 300 }],
      minimumCharge: 45000,
      detentionBlock: 14000,
      boatFee: 27000,
      adminFee: 4000,
    });
    const comparison = comparePriced(request(), dearer);
    expect(comparison.after).toBeGreaterThan(comparison.before);
    expect(comparison.difference).toBe(comparison.after - comparison.before);
  });

  it('prints charges before credits', () => {
    const discounted = assessMovement(request({ discount: 1000 }));
    const printed = printedOrder(discounted);
    expect(printed.at(-1)?.code).toBe('DISCOUNT');
  });
});

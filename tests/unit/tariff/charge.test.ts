import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeBook } from '../../../src/domain/tariff/book';
import type { TariffBook } from '../../../src/domain/tariff/book';
import {
  applyDiscount,
  assessBase,
  baseCharge,
  kindCharge,
  lineFor,
  makeLine,
  marginalRate,
  quoteRange,
  totalOf,
} from '../../../src/domain/tariff/charge';

const BOOK: TariffBook = makeBook({
  id: 'T-2025-A',
  effectiveFrom: parseInstant('2025-01-01T00:00Z'),
  bands: [
    { upTo: 100, charge: 45000, perUnit: 0 },
    { upTo: 400, charge: 45000, perUnit: 320 },
    { upTo: 1000, charge: 141000, perUnit: 260 },
  ],
  minimumCharge: 40000,
  detentionBlock: 12000,
  boatFee: 25000,
  adminFee: 3500,
  kindMultiplier: { shift: 700, swing: 500 },
});

describe('the base charge', () => {
  it('charges the band alone inside the first band', () => {
    expect(baseCharge(BOOK, 40)).toBe(45000);
    expect(baseCharge(BOOK, 100)).toBe(45000);
  });

  it('adds the per unit rate over the band floor', () => {
    expect(baseCharge(BOOK, 200)).toBe(45000 + 100 * 320);
    expect(baseCharge(BOOK, 400)).toBe(45000 + 300 * 320);
  });

  it('steps to the next band and starts again from its floor', () => {
    expect(baseCharge(BOOK, 401)).toBe(141000 + 1 * 260);
    expect(baseCharge(BOOK, 855)).toBe(141000 + 455 * 260);
  });

  it('climbs with every unit', () => {
    let previous = baseCharge(BOOK, 1);
    for (let units = 2; units <= 1200; units += 7) {
      const charge = baseCharge(BOOK, units);
      expect(charge).toBeGreaterThanOrEqual(previous);
      previous = charge;
    }
  });

  it('refuses units that are not units', () => {
    expect(() => baseCharge(BOOK, 0)).toThrow(/whole number/);
    expect(() => baseCharge(BOOK, 12.5)).toThrow(InputError);
  });

  it('reads the rate at the margin', () => {
    expect(marginalRate(BOOK, 50)).toBe(0);
    expect(marginalRate(BOOK, 200)).toBe(320);
    expect(marginalRate(BOOK, 900)).toBe(260);
  });
});

describe('the kind multiplier', () => {
  it('leaves an arrival at the base charge', () => {
    expect(kindCharge(BOOK, 200, 'arrival')).toBe(baseCharge(BOOK, 200));
  });

  it('discounts a shift and a swing', () => {
    expect(kindCharge(BOOK, 200, 'shift')).toBe(Math.round(baseCharge(BOOK, 200) * 0.7));
    expect(kindCharge(BOOK, 200, 'swing')).toBe(Math.round(baseCharge(BOOK, 200) * 0.5));
  });
});

describe('the assessment', () => {
  it('carries the working', () => {
    const assessment = assessBase(BOOK, 855, 'arrival');
    expect(assessment.units).toBe(855);
    expect(assessment.band).toBe(1000);
    expect(assessment.base).toBe(259300);
    expect(assessment.charge).toBe(259300);
    expect(assessment.minimumApplied).toBe(false);
  });

  it('applies the minimum to a small ship on a cheap kind', () => {
    const assessment = assessBase(BOOK, 40, 'swing');
    expect(assessment.afterMultiplier).toBe(22500);
    expect(assessment.charge).toBe(40000);
    expect(assessment.minimumApplied).toBe(true);
  });

  it('adds the boat and the administration as separate lines', () => {
    const lines = assessBase(BOOK, 200, 'arrival').lines;
    expect(lines.map((line) => line.code)).toEqual(['PILOTAGE', 'BOAT', 'ADMIN']);
    expect(lineFor(lines, 'BOAT')?.amount).toBe(25000);
    expect(totalOf(lines)).toBe(77000 + 25000 + 3500);
  });

  it('leaves out a fee the book does not carry', () => {
    const bare = makeBook({
      id: 'T-2025-B',
      effectiveFrom: parseInstant('2025-01-01T00:00Z'),
      bands: [{ upTo: 1000, charge: 10000, perUnit: 100 }],
      minimumCharge: 0,
      detentionBlock: 0,
    });
    expect(assessBase(bare, 200, 'arrival').lines.map((line) => line.code)).toEqual(['PILOTAGE']);
  });

  it('refuses a charge code that is not one', () => {
    expect(() => makeLine('pilotage', 'x', 100)).toThrow(/upper case/);
  });

  it('finds nothing for a code that is not there', () => {
    expect(lineFor(assessBase(BOOK, 200, 'arrival').lines, 'DETENTION')).toBeUndefined();
  });
});

describe('quotations and discounts', () => {
  it('quotes a range of sizes', () => {
    const quotes = quoteRange(BOOK, 'arrival', 100, 400, 100);
    expect(quotes.map((quote) => quote.units)).toEqual([100, 200, 300, 400]);
    expect(quotes[3]!.charge).toBeGreaterThan(quotes[0]!.charge);
  });

  it('refuses a step that is not a whole number of units', () => {
    expect(() => quoteRange(BOOK, 'arrival', 100, 400, 0)).toThrow(InputError);
  });

  it('takes a discount off in basis points', () => {
    expect(applyDiscount(100000, 500)).toBe(95000);
    expect(applyDiscount(100000, 0)).toBe(100000);
    expect(applyDiscount(100000, 10000)).toBe(0);
  });

  it('refuses a discount that is not one', () => {
    expect(() => applyDiscount(100000, -1)).toThrow(/not one/);
    expect(() => applyDiscount(100000, 20000)).toThrow(InputError);
  });
});

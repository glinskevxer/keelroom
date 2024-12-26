import { describe, expect, it } from 'vitest';
import {
  allocateCents,
  applyBps,
  assertCents,
  assertCm,
  ceilToStep,
  clamp,
  cmToFeet,
  cmToMetres,
  feetToCm,
  formatMetres,
  formatMoney,
  isInteger,
  metresToCm,
  parseMetres,
  parseMoney,
  roundHalf,
  roundToStep,
  sumCents,
  UnitError,
} from '../../../src/util/units';

describe('integer guards', () => {
  it('accepts whole centimetres', () => {
    expect(assertCm(1234, 'draught')).toBe(1234);
    expect(assertCm(-45, 'tide')).toBe(-45);
  });

  it('rejects a fractional centimetre and names the field', () => {
    expect(() => assertCm(12.5, 'draught')).toThrow(UnitError);
    expect(() => assertCm(12.5, 'draught')).toThrow(/draught/);
  });

  it('rejects a fractional cent', () => {
    expect(() => assertCents(10.5, 'fee')).toThrow(/fee/);
  });

  it('reads infinities as non integer', () => {
    expect(isInteger(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isInteger(Number.NaN)).toBe(false);
    expect(isInteger(-0)).toBe(true);
  });
});

describe('rounding', () => {
  it('rounds a half away from zero in both directions', () => {
    expect(roundHalf(2.5)).toBe(3);
    expect(roundHalf(-2.5)).toBe(-3);
    expect(roundHalf(2.49)).toBe(2);
    expect(roundHalf(-2.49)).toBe(-2);
  });

  it('refuses to round a non finite value', () => {
    expect(() => roundHalf(Number.NaN)).toThrow(UnitError);
  });

  it('rounds to a step', () => {
    expect(roundToStep(147, 10)).toBe(150);
    expect(roundToStep(144, 10)).toBe(140);
    expect(roundToStep(-145, 10)).toBe(-150);
  });

  it('ceils away from zero to a step', () => {
    expect(ceilToStep(141, 10)).toBe(150);
    expect(ceilToStep(150, 10)).toBe(150);
    expect(ceilToStep(-141, 10)).toBe(-150);
  });

  it('rejects a step of zero or less', () => {
    expect(() => roundToStep(10, 0)).toThrow(UnitError);
    expect(() => ceilToStep(10, -5)).toThrow(UnitError);
  });
});

describe('metres', () => {
  it('converts both ways', () => {
    expect(metresToCm(12.34)).toBe(1234);
    expect(metresToCm(-0.42)).toBe(-42);
    expect(cmToMetres(1234)).toBeCloseTo(12.34, 6);
  });

  it('converts feet', () => {
    expect(feetToCm(1)).toBe(30);
    expect(feetToCm(40)).toBe(1219);
    expect(cmToFeet(1219)).toBeCloseTo(39.99, 2);
  });

  it('parses a two place reading', () => {
    expect(parseMetres('12.34')).toBe(1234);
    expect(parseMetres('12.3')).toBe(1230);
    expect(parseMetres('12')).toBe(1200);
    expect(parseMetres(' -1.05 ')).toBe(-105);
  });

  it('rejects a reading finer than a centimetre', () => {
    expect(() => parseMetres('12.345', 'draught')).toThrow(/draught/);
    expect(() => parseMetres('twelve')).toThrow(UnitError);
    expect(() => parseMetres('')).toThrow(UnitError);
  });

  it('formats to the places asked for', () => {
    expect(formatMetres(1234)).toBe('12.34');
    expect(formatMetres(1234, 1)).toBe('12.3');
    expect(formatMetres(1236, 1)).toBe('12.4');
    expect(formatMetres(1236, 0)).toBe('12');
    expect(formatMetres(-105)).toBe('-1.05');
    expect(formatMetres(5)).toBe('0.05');
  });

  it('refuses more than two places', () => {
    expect(() => formatMetres(1234, 3)).toThrow(UnitError);
  });
});

describe('money', () => {
  it('parses amounts with and without separators', () => {
    expect(parseMoney('1234.50')).toBe(123450);
    expect(parseMoney('1,234.50')).toBe(123450);
    expect(parseMoney('7')).toBe(700);
    expect(parseMoney('-12.05')).toBe(-1205);
  });

  it('rejects rubbish and names the field', () => {
    expect(() => parseMoney('12.345', 'tariff')).toThrow(/tariff/);
    expect(() => parseMoney('$12')).toThrow(UnitError);
  });

  it('formats with and without grouping', () => {
    expect(formatMoney(123450)).toBe('1234.50');
    expect(formatMoney(123450, { grouped: true })).toBe('1,234.50');
    expect(formatMoney(-1205)).toBe('-12.05');
    expect(formatMoney(5)).toBe('0.05');
    expect(formatMoney(100000000, { grouped: true })).toBe('1,000,000.00');
  });

  it('applies a basis point rate', () => {
    expect(applyBps(100000, 250)).toBe(2500);
    expect(applyBps(12345, 1500)).toBe(1852);
    expect(applyBps(-12345, 1500)).toBe(-1852);
  });

  it('refuses a fractional rate', () => {
    expect(() => applyBps(1000, 12.5)).toThrow(UnitError);
  });

  it('sums and rejects a fractional member', () => {
    expect(sumCents([100, 250, -50])).toBe(300);
    expect(sumCents([])).toBe(0);
    expect(() => sumCents([100, 2.5])).toThrow(UnitError);
  });
});

describe('clamp', () => {
  it('holds a value between the bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it('refuses inverted bounds', () => {
    expect(() => clamp(5, 10, 0)).toThrow(UnitError);
  });
});

describe('allocation', () => {
  it('splits evenly when it divides', () => {
    expect(allocateCents(900, [1, 1, 1])).toEqual([300, 300, 300]);
  });

  it('gives the remainder to the largest fractions', () => {
    expect(allocateCents(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(sumCents(allocateCents(1000, [1, 1, 1]))).toBe(1000);
  });

  it('splits by weight', () => {
    const parts = allocateCents(10000, [3, 1]);
    expect(parts).toEqual([7500, 2500]);
  });

  it('handles a negative total', () => {
    const parts = allocateCents(-1000, [1, 1, 1]);
    expect(sumCents(parts)).toBe(-1000);
    expect(parts).toEqual([-334, -333, -333]);
  });

  it('drops nothing on a zero weight', () => {
    const parts = allocateCents(1000, [1, 0, 1]);
    expect(parts).toEqual([500, 0, 500]);
  });

  it('refuses impossible weights', () => {
    expect(() => allocateCents(100, [])).toThrow(UnitError);
    expect(() => allocateCents(100, [0, 0])).toThrow(UnitError);
    expect(() => allocateCents(100, [1, -1])).toThrow(UnitError);
  });
});

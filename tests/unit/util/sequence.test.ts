import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import {
  format,
  isReference,
  makeSeries,
  next,
  pattern,
  sequenceOf,
  yearOf,
} from '../../../src/util/sequence';

const MOVEMENTS = makeSeries('M', 4);
const INVOICES = makeSeries('INV', 5);

describe('building a series', () => {
  it('takes a prefix and a width', () => {
    expect(MOVEMENTS.prefix).toBe('M');
    expect(INVOICES.width).toBe(5);
  });

  it('refuses one that is not', () => {
    expect(() => makeSeries('m', 4)).toThrow(/upper case letters/);
    expect(() => makeSeries('TOOLONGPREFIX', 4)).toThrow(InputError);
    expect(() => makeSeries('M', 0)).toThrow(/width of 0/);
    expect(() => makeSeries('M', 12)).toThrow(InputError);
  });

  it('builds the pattern it recognises', () => {
    expect(pattern(MOVEMENTS).source).toBe('^M-\\d{4}-\\d{4}$');
    expect(isReference(MOVEMENTS, 'M-2025-0004')).toBe(true);
    expect(isReference(MOVEMENTS, 'M-2025-00004')).toBe(false);
    expect(isReference(INVOICES, 'INV-2025-00042')).toBe(true);
  });
});

describe('formatting', () => {
  it('pads to the width of the series', () => {
    expect(format(MOVEMENTS, 2025, 4)).toBe('M-2025-0004');
    expect(format(INVOICES, 2025, 4)).toBe('INV-2025-00004');
  });

  it('refuses a year or a sequence outside the series', () => {
    expect(() => format(MOVEMENTS, 1999, 1)).toThrow(/not a year/);
    expect(() => format(MOVEMENTS, 2025, 0)).toThrow(/outside the sequence/);
    expect(() => format(MOVEMENTS, 2025, 10000)).toThrow(/a year of M holds/);
    expect(() => format(INVOICES, 2025, 100000)).toThrow(InputError);
  });

  it('reads the year and the sequence back', () => {
    expect(yearOf(MOVEMENTS, 'M-2025-0004')).toBe(2025);
    expect(sequenceOf(MOVEMENTS, 'M-2025-0004')).toBe(4);
    expect(yearOf(INVOICES, 'INV-2026-00042')).toBe(2026);
    expect(sequenceOf(INVOICES, 'INV-2026-00042')).toBe(42);
  });

  it('refuses to read one from another series', () => {
    expect(() => yearOf(MOVEMENTS, 'INV-2025-00042')).toThrow(/not a M reference/);
    expect(() => sequenceOf(INVOICES, 'M-2025-0004')).toThrow(/not a INV reference/);
  });
});

describe('the next in a year', () => {
  it('starts at one', () => {
    expect(next(MOVEMENTS, 2025, [])).toBe('M-2025-0001');
  });

  it('takes one past the highest', () => {
    expect(next(MOVEMENTS, 2025, ['M-2025-0001', 'M-2025-0007', 'M-2025-0003'])).toBe(
      'M-2025-0008',
    );
  });

  it('ignores other years, other series and rubbish', () => {
    expect(next(MOVEMENTS, 2026, ['M-2025-0900', 'INV-2026-00099', 'nonsense'])).toBe(
      'M-2026-0001',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError, NotFoundError } from '../../../src/util/errors';
import {
  bandFloor,
  bandFor,
  bookAt,
  describeBook,
  findBook,
  inEffectOrder,
  makeBook,
  multiplierFor,
  requireBook,
} from '../../../src/domain/tariff/book';
import type { TariffBook } from '../../../src/domain/tariff/book';

const JAN = parseInstant('2025-01-01T00:00Z');
const JUL = parseInstant('2025-07-01T00:00Z');

const BANDS = [
  { upTo: 100, charge: 45000, perUnit: 0 },
  { upTo: 400, charge: 45000, perUnit: 320 },
  { upTo: 1000, charge: 141000, perUnit: 260 },
];

function book(overrides: Partial<Parameters<typeof makeBook>[0]> = {}): TariffBook {
  return makeBook({
    id: 'T-2025-A',
    effectiveFrom: JAN,
    bands: BANDS,
    minimumCharge: 40000,
    detentionBlock: 12000,
    boatFee: 25000,
    adminFee: 3500,
    kindMultiplier: { shift: 700, swing: 500 },
    ...overrides,
  });
}

describe('building a book', () => {
  it('keeps what it was given and defaults the currency', () => {
    const one = book();
    expect(one.currency).toBe('USD');
    expect(one.bands).toHaveLength(3);
    expect(one.adminFee).toBe(3500);
  });

  it('refuses a book that is not one', () => {
    expect(() => book({ id: '2025' })).toThrow(/look like T-2025-A/);
    expect(() => book({ bands: [] })).toThrow(/no bands/);
    expect(() => book({ minimumCharge: -1 })).toThrow(/negative charge/);
    expect(() => book({ detentionBlock: 1.5 })).toThrow(/whole cents/);
  });

  it('refuses bands that do not climb', () => {
    expect(() =>
      book({
        bands: [
          { upTo: 400, charge: 1, perUnit: 0 },
          { upTo: 100, charge: 1, perUnit: 0 },
        ],
      }),
    ).toThrow(/do not climb/);
    expect(() => book({ bands: [{ upTo: 0, charge: 1, perUnit: 0 }] })).toThrow(InputError);
  });

  it('refuses a negative charge inside a band', () => {
    expect(() => book({ bands: [{ upTo: 100, charge: -1, perUnit: 0 }] })).toThrow(
      /negative charge in a band/,
    );
  });

  it('refuses a multiplier that is not one', () => {
    expect(() => book({ kindMultiplier: { shift: 0 } })).toThrow(/multiplier that is not one/);
    expect(() => book({ kindMultiplier: { shift: 1.5 } })).toThrow(InputError);
  });
});

describe('the series', () => {
  const books = [book(), book({ id: 'T-2025-B', effectiveFrom: JUL, minimumCharge: 44000 })];

  it('finds the book in force on a date', () => {
    expect(bookAt(books, JAN + 1000).id).toBe('T-2025-A');
    expect(bookAt(books, JUL).id).toBe('T-2025-B');
    expect(bookAt(books, JUL - 1).id).toBe('T-2025-A');
  });

  it('refuses a date before any book took effect', () => {
    expect(() => bookAt(books, JAN - 1)).toThrow(NotFoundError);
  });

  it('finds a book by id', () => {
    expect(findBook(books, 'T-2025-B')?.minimumCharge).toBe(44000);
    expect(findBook(books, 'T-1999-A')).toBeUndefined();
    expect(() => requireBook(books, 'T-1999-A')).toThrow(/no tariff book/);
  });

  it('orders the register by effect', () => {
    expect(inEffectOrder([books[1]!, books[0]!]).map((one) => one.id)).toEqual([
      'T-2025-A',
      'T-2025-B',
    ]);
  });

  it('describes a book in one line', () => {
    expect(describeBook(book(), 0)).toBe('T-2025-A from 2025-01-01, 3 bands, USD');
  });
});

describe('bands', () => {
  const one = book();

  it('finds the band a ship falls in', () => {
    expect(bandFor(one, 50).upTo).toBe(100);
    expect(bandFor(one, 100).upTo).toBe(100);
    expect(bandFor(one, 101).upTo).toBe(400);
    expect(bandFor(one, 900).upTo).toBe(1000);
  });

  it('puts anything over the top band in the top band', () => {
    expect(bandFor(one, 5000).upTo).toBe(1000);
  });

  it('reads where a band starts', () => {
    expect(bandFloor(one, one.bands[0]!)).toBe(0);
    expect(bandFloor(one, one.bands[1]!)).toBe(100);
    expect(bandFloor(one, one.bands[2]!)).toBe(400);
  });

  it('reads a multiplier, defaulting to one', () => {
    expect(multiplierFor(one, 'shift')).toBe(700);
    expect(multiplierFor(one, 'arrival')).toBe(1000);
  });
});

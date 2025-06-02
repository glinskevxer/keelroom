/**
 * The tariff book, and the fact that there is more than one of them.
 *
 * A tariff is published to take effect on a date and stands until the next one
 * does. Movements are charged on the book in force when the ship moved, not the
 * book in force when the invoice is raised, which matters every January and
 * every time a rate rise is backdated. So the books are held as a series and
 * looked up by date, and a movement carries the id of the book it was charged
 * on so an invoice can be reproduced years later.
 */

import { InputError, NotFoundError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import { localDate } from '../../util/clock';
import type { Cents } from '../../util/units';
import { assertCents } from '../../util/units';

export interface UnitBand {
  /** Units up to and including this figure fall in the band. */
  readonly upTo: number;
  /** Charge for the whole band, in cents. */
  readonly charge: Cents;
  /** Charge for each unit over the previous band, in cents. */
  readonly perUnit: Cents;
}

export interface TariffBook {
  readonly id: string;
  /** The first minute this book applies to. */
  readonly effectiveFrom: Minute;
  readonly currency: string;
  readonly bands: readonly UnitBand[];
  /** The least any movement is charged. */
  readonly minimumCharge: Cents;
  /** Multipliers on the base charge, in thousandths, by movement kind. */
  readonly kindMultiplier: Readonly<Record<string, number>>;
  /** Charge for each block of detention. */
  readonly detentionBlock: Cents;
  /** Charge for the pilot boat, whether or not she is used. */
  readonly boatFee: Cents;
  /** Charge added to every movement for the administration of it. */
  readonly adminFee: Cents;
}

const BOOK_ID = /^T-\d{4}-[A-Z]$/;

export function makeBook(input: {
  id: string;
  effectiveFrom: Minute;
  currency?: string;
  bands: readonly UnitBand[];
  minimumCharge: number;
  kindMultiplier?: Readonly<Record<string, number>>;
  detentionBlock: number;
  boatFee?: number;
  adminFee?: number;
}): TariffBook {
  if (!BOOK_ID.test(input.id)) {
    throw new InputError(`tariff id must look like T-2025-A, got ${JSON.stringify(input.id)}`);
  }
  if (input.bands.length === 0) {
    throw new InputError(`tariff ${input.id} has no bands`);
  }
  let previous = 0;
  for (const band of input.bands) {
    if (!Number.isInteger(band.upTo) || band.upTo <= previous) {
      throw new InputError(`tariff ${input.id} has bands that do not climb`, { upTo: band.upTo });
    }
    assertCents(band.charge, 'band charge');
    assertCents(band.perUnit, 'per unit charge');
    if (band.charge < 0 || band.perUnit < 0) {
      throw new InputError(`tariff ${input.id} has a negative charge in a band`);
    }
    previous = band.upTo;
  }
  const minimumCharge = assertCents(input.minimumCharge, 'minimum charge');
  const detentionBlock = assertCents(input.detentionBlock, 'detention block charge');
  const boatFee = assertCents(input.boatFee ?? 0, 'boat fee');
  const adminFee = assertCents(input.adminFee ?? 0, 'admin fee');
  if (minimumCharge < 0 || detentionBlock < 0 || boatFee < 0 || adminFee < 0) {
    throw new InputError(`tariff ${input.id} carries a negative charge`);
  }
  const kindMultiplier = input.kindMultiplier ?? {};
  for (const [kind, multiplier] of Object.entries(kindMultiplier)) {
    if (!Number.isInteger(multiplier) || multiplier <= 0) {
      throw new InputError(`tariff ${input.id} has a multiplier that is not one`, { kind });
    }
  }
  return {
    id: input.id,
    effectiveFrom: input.effectiveFrom,
    currency: input.currency ?? 'USD',
    bands: [...input.bands],
    minimumCharge,
    kindMultiplier,
    detentionBlock,
    boatFee,
    adminFee,
  };
}

/** The book in force at a moment, from a series that need not be sorted. */
export function bookAt(books: readonly TariffBook[], at: Minute): TariffBook {
  const inForce = [...books]
    .filter((book) => book.effectiveFrom <= at)
    .sort((a, b) => a.effectiveFrom - b.effectiveFrom)
    .at(-1);
  if (inForce === undefined) {
    throw new NotFoundError('tariff book in force', String(at));
  }
  return inForce;
}

export function findBook(books: readonly TariffBook[], id: string): TariffBook | undefined {
  return books.find((book) => book.id === id);
}

export function requireBook(books: readonly TariffBook[], id: string): TariffBook {
  const book = findBook(books, id);
  if (book === undefined) {
    throw new NotFoundError('tariff book', id);
  }
  return book;
}

/** Books in the order they took effect, which is how the register prints. */
export function inEffectOrder(books: readonly TariffBook[]): TariffBook[] {
  return [...books].sort((a, b) => a.effectiveFrom - b.effectiveFrom || a.id.localeCompare(b.id));
}

/** The band a number of units falls in. */
export function bandFor(book: TariffBook, units: number): UnitBand {
  const band = book.bands.find((candidate) => units <= candidate.upTo);
  if (band === undefined) {
    const last = book.bands.at(-1);
    if (last === undefined) {
      throw new InputError(`tariff ${book.id} has no bands`);
    }
    return last;
  }
  return band;
}

/** Where a band starts, which the per unit charge is measured from. */
export function bandFloor(book: TariffBook, band: UnitBand): number {
  const index = book.bands.indexOf(band);
  if (index <= 0) {
    return 0;
  }
  return book.bands[index - 1]?.upTo ?? 0;
}

export function multiplierFor(book: TariffBook, kind: string): number {
  return book.kindMultiplier[kind] ?? 1000;
}

export function describeBook(book: TariffBook, offset: number): string {
  return `${book.id} from ${localDate(book.effectiveFrom, offset)}, ${book.bands.length} bands, ${book.currency}`;
}

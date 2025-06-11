/**
 * The base charge for a movement, before anything is added to it.
 *
 * A ship's pilotage units put her in a band. The band carries a charge for the
 * band itself and a rate for every unit above where the band starts, so the
 * tariff climbs in a straight line inside a band and steps between them. The
 * movement kind then multiplies the whole thing, because a shift across the
 * harbour is not an arrival from sea, and the minimum charge is applied last so
 * a small ship on a cheap kind still pays something.
 */

import { InputError } from '../../util/errors';
import type { Cents } from '../../util/units';
import { applyBps, roundHalf } from '../../util/units';
import type { TariffBook } from './book';
import { bandFloor, bandFor, multiplierFor } from './book';

export interface ChargeLine {
  /** Stable code the invoice and the tariff both quote. */
  readonly code: string;
  readonly description: string;
  readonly amount: Cents;
}

export function makeLine(code: string, description: string, amount: Cents): ChargeLine {
  if (!/^[A-Z][A-Z0-9-]{1,15}$/.test(code)) {
    throw new InputError(`charge code must be upper case, got ${JSON.stringify(code)}`);
  }
  return { code, description, amount };
}

/** The band charge plus the per unit rate over the band floor. */
export function baseCharge(book: TariffBook, units: number): Cents {
  if (!Number.isInteger(units) || units <= 0) {
    throw new InputError(`pilotage units must be a whole number, got ${units}`);
  }
  const band = bandFor(book, units);
  const floor = bandFloor(book, band);
  const over = Math.max(0, units - floor);
  return band.charge + over * band.perUnit;
}

/** The base charge with the kind multiplier applied, before the minimum. */
export function kindCharge(book: TariffBook, units: number, kind: string): Cents {
  const base = baseCharge(book, units);
  const multiplier = multiplierFor(book, kind);
  return roundHalf((base * multiplier) / 1000);
}

export interface BaseAssessment {
  readonly units: number;
  readonly band: number;
  readonly base: Cents;
  readonly afterMultiplier: Cents;
  readonly charge: Cents;
  readonly minimumApplied: boolean;
  readonly lines: readonly ChargeLine[];
}

export function assessBase(book: TariffBook, units: number, kind: string): BaseAssessment {
  const band = bandFor(book, units);
  const base = baseCharge(book, units);
  const afterMultiplier = kindCharge(book, units, kind);
  const minimumApplied = afterMultiplier < book.minimumCharge;
  const charge = minimumApplied ? book.minimumCharge : afterMultiplier;
  const lines: ChargeLine[] = [makeLine('PILOTAGE', `pilotage, ${units} units, ${kind}`, charge)];
  if (book.boatFee > 0) {
    lines.push(makeLine('BOAT', 'pilot boat', book.boatFee));
  }
  if (book.adminFee > 0) {
    lines.push(makeLine('ADMIN', 'administration', book.adminFee));
  }
  return {
    units,
    band: band.upTo,
    base,
    afterMultiplier,
    charge,
    minimumApplied,
    lines,
  };
}

/** What the charge would be at a different number of units, for a quotation. */
export function quoteRange(
  book: TariffBook,
  kind: string,
  from: number,
  to: number,
  step: number,
): { units: number; charge: Cents }[] {
  if (step <= 0 || !Number.isInteger(step)) {
    throw new InputError('a quotation steps by a whole number of units');
  }
  const quotes: { units: number; charge: Cents }[] = [];
  for (let units = from; units <= to; units += step) {
    quotes.push({ units, charge: assessBase(book, units, kind).charge });
  }
  return quotes;
}

/** The charge for a unit at the margin, which is what an agent asks about. */
export function marginalRate(book: TariffBook, units: number): Cents {
  return bandFor(book, units).perUnit;
}

/** Apply a percentage discount held against an agent's account. */
export function applyDiscount(amount: Cents, basisPoints: number): Cents {
  if (basisPoints < 0 || basisPoints > 10000) {
    throw new InputError(`a discount of ${basisPoints} basis points is not one`);
  }
  return amount - applyBps(amount, basisPoints);
}

export function totalOf(lines: readonly ChargeLine[]): Cents {
  return lines.reduce((total, line) => total + line.amount, 0);
}

export function lineFor(lines: readonly ChargeLine[], code: string): ChargeLine | undefined {
  return lines.find((line) => line.code === code);
}

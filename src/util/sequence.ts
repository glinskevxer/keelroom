/**
 * Yearly reference series.
 *
 * Movements, invoices and credit notes all number themselves the same way: a
 * prefix, the year, and a sequence padded to a fixed width, with the next
 * number being one past the highest already issued in that year. The three had
 * grown their own copies of it and they had already drifted apart on what they
 * did with a malformed number, so it lives here once.
 */

import { InputError } from './errors';

export interface Series {
  /** The letters in front, without the dash. */
  readonly prefix: string;
  /** How many digits the sequence is padded to. */
  readonly width: number;
}

export function makeSeries(prefix: string, width: number): Series {
  if (!/^[A-Z]{1,6}$/.test(prefix)) {
    throw new InputError(`a series prefix is upper case letters, got ${JSON.stringify(prefix)}`);
  }
  if (!Number.isInteger(width) || width < 1 || width > 8) {
    throw new InputError(`a sequence width of ${width} is not one`);
  }
  return { prefix, width };
}

function ceiling(series: Series): number {
  return 10 ** series.width - 1;
}

export function pattern(series: Series): RegExp {
  return new RegExp(`^${series.prefix}-\\d{4}-\\d{${series.width}}$`);
}

export function isReference(series: Series, candidate: string): boolean {
  return pattern(series).test(candidate);
}

export function format(series: Series, year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw new InputError(`${year} is not a year this series runs in`);
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > ceiling(series)) {
    throw new InputError(`${sequence} is outside the sequence a year of ${series.prefix} holds`);
  }
  return `${series.prefix}-${year}-${String(sequence).padStart(series.width, '0')}`;
}

export function yearOf(series: Series, reference: string): number {
  requireReference(series, reference);
  return Number(reference.slice(series.prefix.length + 1, series.prefix.length + 5));
}

export function sequenceOf(series: Series, reference: string): number {
  requireReference(series, reference);
  return Number(reference.slice(series.prefix.length + 6));
}

function requireReference(series: Series, reference: string): void {
  if (!isReference(series, reference)) {
    throw new InputError(`not a ${series.prefix} reference: ${JSON.stringify(reference)}`);
  }
}

/** The next reference in a year, ignoring anything that is not one of ours. */
export function next(series: Series, year: number, issued: readonly string[]): string {
  const highest = issued
    .filter((reference) => isReference(series, reference) && yearOf(series, reference) === year)
    .reduce((worst, reference) => Math.max(worst, sequenceOf(series, reference)), 0);
  return format(series, year, highest + 1);
}

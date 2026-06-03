/**
 * Secondary ports.
 *
 * Most of the berths in a district are not at the gauge. The hydrographic office
 * publishes a secondary port as a set of corrections to a standard port rather
 * than as its own harmonic constants: high water so many minutes later, low
 * water so many minutes later again, and the range scaled by a factor at each.
 *
 * The curve between the corrected turns is a cosine, which is what the tide
 * tables assume and close enough at any port where the shallow water terms are
 * small. Where they are not, the office publishes constants and the district
 * should carry a station of its own rather than a correction.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import type { Cm } from '../../util/units';
import { assertCm, roundHalf } from '../../util/units';
import type { Extreme } from './extremes';
import { findExtremes } from './extremes';
import type { TideStation } from './station';

export interface SecondaryPort {
  readonly id: string;
  readonly name: string;
  /** The standard port these corrections are against. */
  readonly standard: string;
  /** Minutes to add to the time of high water. */
  readonly highWaterOffset: number;
  readonly lowWaterOffset: number;
  /** Height factor at high water, in thousandths. */
  readonly highWaterFactor: number;
  readonly lowWaterFactor: number;
  /** A fixed shift applied after the factor, for a differing datum. */
  readonly datumShift: Cm;
}

const PORT_ID = /^[A-Z][A-Z0-9-]{1,15}$/;

export function makeSecondary(input: {
  id: string;
  name: string;
  standard: string;
  highWaterOffset: number;
  lowWaterOffset: number;
  highWaterFactor?: number;
  lowWaterFactor?: number;
  datumShift?: number;
}): SecondaryPort {
  if (!PORT_ID.test(input.id)) {
    throw new InputError(`secondary port id must be upper case, got ${JSON.stringify(input.id)}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`secondary port ${input.id} has no name`);
  }
  for (const offset of [input.highWaterOffset, input.lowWaterOffset]) {
    if (!Number.isInteger(offset) || Math.abs(offset) > 720) {
      throw new InputError(`secondary port ${input.id} has an offset of ${offset} minutes`);
    }
  }
  const highWaterFactor = input.highWaterFactor ?? 1000;
  const lowWaterFactor = input.lowWaterFactor ?? 1000;
  for (const factor of [highWaterFactor, lowWaterFactor]) {
    if (!Number.isInteger(factor) || factor <= 0 || factor > 3000) {
      throw new InputError(`secondary port ${input.id} has a height factor of ${factor}`);
    }
  }
  return {
    id: input.id,
    name: input.name.trim(),
    standard: input.standard,
    highWaterOffset: input.highWaterOffset,
    lowWaterOffset: input.lowWaterOffset,
    highWaterFactor,
    lowWaterFactor,
    datumShift: assertCm(input.datumShift ?? 0, 'datum shift'),
  };
}

/** One turn of the tide, moved and scaled onto the secondary port. */
export function correctExtreme(port: SecondaryPort, extreme: Extreme, meanLevel: Cm): Extreme {
  const offset = extreme.kind === 'high' ? port.highWaterOffset : port.lowWaterOffset;
  const factor = extreme.kind === 'high' ? port.highWaterFactor : port.lowWaterFactor;
  const fromMean = extreme.height - meanLevel;
  return {
    kind: extreme.kind,
    minute: extreme.minute + offset,
    height: roundHalf(meanLevel + (fromMean * factor) / 1000) + port.datumShift,
  };
}

/** Every turn of the tide at the secondary port over a range. */
export function secondaryExtremes(
  port: SecondaryPort,
  standard: TideStation,
  from: Minute,
  to: Minute,
): Extreme[] {
  const widest = Math.max(Math.abs(port.highWaterOffset), Math.abs(port.lowWaterOffset));
  return findExtremes(standard, from - widest - 60, to + widest + 60)
    .map((extreme) => correctExtreme(port, extreme, standard.meanLevel))
    .filter((extreme) => extreme.minute >= from && extreme.minute <= to)
    .sort((a, b) => a.minute - b.minute);
}

/**
 * The height at the secondary port, interpolated between the corrected turns on
 * a cosine. Outside the turns it cannot say, because there is nothing to
 * interpolate between, so the caller asks over a range that holds two.
 */
export function secondaryHeight(
  port: SecondaryPort,
  standard: TideStation,
  at: Minute,
): Cm | undefined {
  const window = 900;
  const turns = secondaryExtremes(port, standard, at - window, at + window);
  let before: Extreme | undefined;
  let after: Extreme | undefined;
  for (const turn of turns) {
    if (turn.minute <= at) {
      before = turn;
    } else if (after === undefined) {
      after = turn;
    }
  }
  if (before === undefined || after === undefined) {
    return undefined;
  }
  const span = after.minute - before.minute;
  if (span <= 0) {
    return before.height;
  }
  const through = (at - before.minute) / span;
  const shape = (1 - Math.cos(Math.PI * through)) / 2;
  return roundHalf(before.height + (after.height - before.height) * shape);
}

/** The range at the secondary port around a turn, which the tariff never sees. */
export function secondaryRange(
  port: SecondaryPort,
  standard: TideStation,
  from: Minute,
  to: Minute,
): Cm {
  const turns = secondaryExtremes(port, standard, from, to);
  if (turns.length < 2) {
    return 0;
  }
  const heights = turns.map((turn) => turn.height);
  return Math.max(...heights) - Math.min(...heights);
}

export function describeSecondary(port: SecondaryPort): string {
  const sign = (value: number): string => (value >= 0 ? `+${value}` : String(value));
  return (
    `${port.id} ${port.name} on ${port.standard}: HW ${sign(port.highWaterOffset)} min ` +
    `at ${(port.highWaterFactor / 1000).toFixed(2)}, LW ${sign(port.lowWaterOffset)} min ` +
    `at ${(port.lowWaterFactor / 1000).toFixed(2)}`
  );
}

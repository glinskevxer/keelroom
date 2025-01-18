/**
 * A tide station is a gauge with a fitted set of harmonic terms and a datum.
 *
 * Every height in this system is measured from chart datum, because that is
 * what the charted depths are measured from and the two get added together all
 * day long. Mean sea level is carried only so the gauge's own readings, which
 * are published against it, can be brought onto the same footing.
 */

import { InputError } from '../../util/errors';
import type { Cm } from '../../util/units';
import { assertCm } from '../../util/units';
import { findConstituent, requireConstituent } from './constituent';

export interface HarmonicTerm {
  readonly name: string;
  /** Half the range the term contributes, in centimetres. */
  readonly amplitude: Cm;
  /** The gauge's fitted lag, in degrees. */
  readonly phase: number;
}

export interface TideStation {
  readonly id: string;
  readonly name: string;
  /** Height of mean sea level above chart datum. */
  readonly meanLevel: Cm;
  readonly terms: readonly HarmonicTerm[];
}

const STATION_ID = /^[A-Z][A-Z0-9]{1,7}$/;

export function makeStation(input: {
  id: string;
  name: string;
  meanLevel: number;
  terms: readonly { name: string; amplitude: number; phase: number }[];
}): TideStation {
  if (!STATION_ID.test(input.id)) {
    throw new InputError(
      `station id must be short and upper case, got ${JSON.stringify(input.id)}`,
    );
  }
  if (input.name.trim() === '') {
    throw new InputError(`station ${input.id} has no name`);
  }
  const meanLevel = assertCm(input.meanLevel, 'mean level');
  if (meanLevel < 0) {
    throw new InputError(`station ${input.id} puts mean sea level below chart datum`);
  }
  if (input.terms.length === 0) {
    throw new InputError(`station ${input.id} has no harmonic terms`);
  }
  const seen = new Set<string>();
  const terms = input.terms.map((term) => {
    const name = term.name.toUpperCase();
    if (findConstituent(name) === undefined) {
      throw new InputError(`station ${input.id} carries an unknown constituent ${name}`);
    }
    if (seen.has(name)) {
      throw new InputError(`station ${input.id} carries ${name} twice`);
    }
    seen.add(name);
    const amplitude = assertCm(term.amplitude, `${name} amplitude`);
    if (amplitude < 0) {
      throw new InputError(`station ${input.id} has a negative amplitude for ${name}`);
    }
    if (!Number.isFinite(term.phase) || term.phase < 0 || term.phase >= 360) {
      throw new InputError(`station ${input.id} has a phase outside a turn for ${name}`);
    }
    return { name, amplitude, phase: term.phase };
  });
  return { id: input.id, name: input.name.trim(), meanLevel, terms };
}

export function termFor(station: TideStation, name: string): HarmonicTerm | undefined {
  const wanted = name.toUpperCase();
  return station.terms.find((term) => term.name === wanted);
}

export function amplitudeOf(station: TideStation, name: string): Cm {
  return termFor(station, name)?.amplitude ?? 0;
}

/** Spring range, the usual two times the sum of the semidiurnal pair. */
export function springRange(station: TideStation): Cm {
  return 2 * (amplitudeOf(station, 'M2') + amplitudeOf(station, 'S2'));
}

export function neapRange(station: TideStation): Cm {
  return Math.max(0, 2 * (amplitudeOf(station, 'M2') - amplitudeOf(station, 'S2')));
}

/**
 * The form number decides whether the port gets two useful tides a day or one.
 * Under 0.25 the tide is semidiurnal, over 3 it is diurnal, and the two bands
 * between are mixed with one of the two dominating.
 */
export function formNumber(station: TideStation): number {
  const semidiurnal = amplitudeOf(station, 'M2') + amplitudeOf(station, 'S2');
  if (semidiurnal === 0) {
    throw new InputError(`station ${station.id} has no semidiurnal amplitude to form a ratio with`);
  }
  return (amplitudeOf(station, 'K1') + amplitudeOf(station, 'O1')) / semidiurnal;
}

export type TideForm =
  | 'semidiurnal'
  | 'mixed-mainly-semidiurnal'
  | 'mixed-mainly-diurnal'
  | 'diurnal';

export function tideForm(station: TideStation): TideForm {
  const form = formNumber(station);
  if (form < 0.25) {
    return 'semidiurnal';
  }
  if (form < 1.5) {
    return 'mixed-mainly-semidiurnal';
  }
  if (form <= 3) {
    return 'mixed-mainly-diurnal';
  }
  return 'diurnal';
}

/**
 * The highest and lowest the sum of the terms can reach, ignoring whether the
 * phases could ever line up. It bounds a search rather than predicting a tide.
 */
export function extremeBounds(station: TideStation): { highest: Cm; lowest: Cm } {
  const total = station.terms.reduce((sum, term) => sum + term.amplitude, 0);
  return { highest: station.meanLevel + total, lowest: station.meanLevel - total };
}

export function describeStation(station: TideStation): string {
  return `${station.id} ${station.name}, ${station.terms.length} terms, spring range ${springRange(station)} cm`;
}

/** The terms in a fixed order, strongest first, so two renderings agree. */
export function orderedTerms(station: TideStation): HarmonicTerm[] {
  return [...station.terms].sort(
    (a, b) =>
      b.amplitude - a.amplitude ||
      requireConstituent(b.name).speed - requireConstituent(a.name).speed ||
      a.name.localeCompare(b.name),
  );
}

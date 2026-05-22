/**
 * Predicting a height is the sum of the station's terms at a minute, and the
 * only subtlety is where the node factors are evaluated.
 *
 * The published tables hold the node factors constant across a prediction
 * period rather than recomputing them every step, because the factors change
 * over months and a factor that moved inside a single tide would put a kink in
 * the curve that the extremes search would then chase. So a prediction takes a
 * node state, and a series computes one state for the middle of the range and
 * uses it throughout.
 */

import type { Minute } from '../../util/clock';
import { roundHalf } from '../../util/units';
import type { Cm } from '../../util/units';
import type { NodeState } from './astronomy';
import { equilibriumArgument, nodeFactor, nodeStateAt } from './astronomy';
import { requireConstituent } from './constituent';
import type { TideStation } from './station';

const DEGREES = Math.PI / 180;

export interface PreparedTerm {
  readonly name: string;
  /** Node factor times fitted amplitude, in centimetres. */
  readonly amplitude: number;
  /** Degrees per hour. */
  readonly speed: number;
  /** Equilibrium argument less the fitted lag, at the reference minute. */
  readonly argument: number;
}

export interface PreparedStation {
  readonly station: TideStation;
  readonly reference: Minute;
  readonly terms: readonly PreparedTerm[];
}

/**
 * Preparing a station costs an astronomical calculation per term, and the sweep
 * asks for the same station at the same reference minute over and over: once per
 * reach, per candidate draught, per bisection step. The cache is keyed on the
 * station object itself, so a station loaded again or edited is a different key
 * and nothing stale can be read back.
 */
const prepared = new WeakMap<TideStation, Map<Minute, PreparedStation>>();

/** How many minutes of reference time share one preparation. */
const BUCKET = 60;

/**
 * Fix the node factors at a reference minute and fold the fitted lag in. Every
 * height after that is arithmetic.
 */
export function prepare(station: TideStation, reference: Minute): PreparedStation {
  const bucket = Math.round(reference / BUCKET) * BUCKET;
  const held = prepared.get(station) ?? new Map<Minute, PreparedStation>();
  const found = held.get(bucket);
  if (found !== undefined) {
    return found;
  }
  const built = prepareAt(station, bucket);
  held.set(bucket, built);
  prepared.set(station, held);
  return built;
}

/** Prepare without the cache, which is what the cache calls and what tests use. */
export function prepareAt(station: TideStation, reference: Minute): PreparedStation {
  const state: NodeState = nodeStateAt(reference);
  const terms = station.terms.map((term) => {
    const constituent = requireConstituent(term.name);
    return {
      name: term.name,
      amplitude: term.amplitude * nodeFactor(constituent, state),
      speed: constituent.speed,
      argument: equilibriumArgument(constituent, state) - term.phase,
    };
  });
  return { station, reference, terms };
}

/** Height above chart datum in exact centimetres, before rounding. */
export function heightExact(prepared: PreparedStation, minute: Minute): number {
  const hours = (minute - prepared.reference) / 60;
  let total = prepared.station.meanLevel;
  for (const term of prepared.terms) {
    total += term.amplitude * Math.cos((term.argument + term.speed * hours) * DEGREES);
  }
  return total;
}

/** Height above chart datum, in whole centimetres. */
export function heightAt(prepared: PreparedStation, minute: Minute): Cm {
  return roundHalf(heightExact(prepared, minute));
}

/** Rate of rise in centimetres an hour. Positive on a making tide. */
export function rateAt(prepared: PreparedStation, minute: Minute): number {
  const hours = (minute - prepared.reference) / 60;
  let total = 0;
  for (const term of prepared.terms) {
    total -=
      term.amplitude *
      term.speed *
      DEGREES *
      Math.sin((term.argument + term.speed * hours) * DEGREES);
  }
  return total;
}

/** Second derivative, which the extremes search uses to tell a peak from a trough. */
export function curvatureAt(prepared: PreparedStation, minute: Minute): number {
  const hours = (minute - prepared.reference) / 60;
  let total = 0;
  for (const term of prepared.terms) {
    const rate = term.speed * DEGREES;
    total -=
      term.amplitude * rate * rate * Math.cos((term.argument + term.speed * hours) * DEGREES);
  }
  return total;
}

/** Predict one height without preparing a station first. */
export function predictHeight(station: TideStation, minute: Minute): Cm {
  return heightAt(prepare(station, minute), minute);
}

export interface Sample {
  readonly minute: Minute;
  readonly height: Cm;
}

/**
 * Sample the curve from one minute to another inclusive. The node state is
 * taken once, at the middle of the range.
 */
export function predictSeries(
  station: TideStation,
  from: Minute,
  to: Minute,
  stepMinutes: number,
): Sample[] {
  if (stepMinutes <= 0 || Math.trunc(stepMinutes) !== stepMinutes) {
    throw new Error(`sampling step must be a whole number of minutes, got ${stepMinutes}`);
  }
  if (to < from) {
    throw new Error('sampling range ends before it starts');
  }
  const prepared = prepare(station, Math.round((from + to) / 2));
  const samples: Sample[] = [];
  for (let minute = from; minute <= to; minute += stepMinutes) {
    samples.push({ minute, height: heightAt(prepared, minute) });
  }
  const last = samples[samples.length - 1];
  if (last !== undefined && last.minute !== to) {
    samples.push({ minute: to, height: heightAt(prepared, to) });
  }
  return samples;
}

export function highestSample(samples: readonly Sample[]): Sample {
  const first = samples[0];
  if (first === undefined) {
    throw new Error('no samples to take a highest from');
  }
  return samples.reduce((best, sample) => (sample.height > best.height ? sample : best), first);
}

export function lowestSample(samples: readonly Sample[]): Sample {
  const first = samples[0];
  if (first === undefined) {
    throw new Error('no samples to take a lowest from');
  }
  return samples.reduce((best, sample) => (sample.height < best.height ? sample : best), first);
}

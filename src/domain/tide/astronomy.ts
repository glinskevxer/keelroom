/**
 * The astronomical side of a prediction: where the sun and moon are, what that
 * does to the amplitude of a lunar constituent over the eighteen year node
 * cycle, and what the equilibrium argument is at a given minute.
 *
 * The node factor and correction formulas are the usual Schureman series in the
 * longitude of the ascending node. They are approximations, and they are the
 * ones the published tide tables are computed with, so the predictions agree
 * with what the pilots have on paper.
 */

import type { Constituent, NodeFamily } from './constituent';
import { RATES } from './constituent';
import type { Minute } from '../../util/clock';
import { MINUTES_PER_DAY } from '../../util/clock';

const DEGREES = Math.PI / 180;

/** Julian day number at the given minute. */
export function julianDay(minute: Minute): number {
  return 2440587.5 + minute / MINUTES_PER_DAY;
}

/** Julian centuries since j2000. */
export function julianCentury(minute: Minute): number {
  return (julianDay(minute) - 2451545) / 36525;
}

export interface MeanLongitudes {
  /** mean longitude of the moon */
  readonly s: number;
  /** mean longitude of the sun */
  readonly h: number;
  /** longitude of lunar perigee */
  readonly p: number;
  /** longitude of the moon's ascending node */
  readonly n: number;
  /** longitude of solar perigee */
  readonly p1: number;
}

export function normaliseDegrees(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Signed to the half turn, which is how a phase difference reads. */
export function signedDegrees(value: number): number {
  const wrapped = normaliseDegrees(value);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

export function meanLongitudes(minute: Minute): MeanLongitudes {
  const t = julianCentury(minute);
  const t2 = t * t;
  return {
    s: normaliseDegrees(218.3164477 + 481267.88123421 * t - 0.0015786 * t2),
    h: normaliseDegrees(280.46646 + 36000.76983 * t + 0.0003032 * t2),
    p: normaliseDegrees(83.3532465 + 4069.0137287 * t - 0.01032 * t2),
    n: normaliseDegrees(125.04455501 - 1934.13626197 * t + 0.0020708 * t2),
    p1: normaliseDegrees(282.937348 + 1.7195269 * t + 0.0004568 * t2),
  };
}

/** Mean lunar time as an angle, which is what the first doodson number counts. */
export function lunarTimeAngle(minute: Minute, longitudes: MeanLongitudes): number {
  const hoursOfDay = (((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) / 60;
  return normaliseDegrees(15 * hoursOfDay + longitudes.h - longitudes.s);
}

function cosN(n: number, multiple: number): number {
  return Math.cos(multiple * n * DEGREES);
}

function sinN(n: number, multiple: number): number {
  return Math.sin(multiple * n * DEGREES);
}

/** The amplitude multiplier for a family at a node longitude in degrees. */
export function nodeFactorFor(family: NodeFamily, n: number): number {
  const m2 = 1.0004 - 0.0373 * cosN(n, 1) + 0.0002 * cosN(n, 2);
  const k1 = 1.006 + 0.115 * cosN(n, 1) - 0.0088 * cosN(n, 2) + 0.0006 * cosN(n, 3);
  switch (family) {
    case 'solar':
      return 1;
    case 'lunar-semidiurnal':
      return m2;
    case 'lunar-diurnal-o1':
      return 1.0089 + 0.1871 * cosN(n, 1) - 0.0147 * cosN(n, 2) + 0.0014 * cosN(n, 3);
    case 'lunar-diurnal-k1':
      return k1;
    case 'lunisolar-k2':
      return 1.0241 + 0.2863 * cosN(n, 1) + 0.0083 * cosN(n, 2) - 0.0015 * cosN(n, 3);
    case 'lunar-fortnightly':
      return 1.0429 + 0.4135 * cosN(n, 1) - 0.004 * cosN(n, 2);
    case 'lunar-monthly':
      return 1.0 - 0.13 * cosN(n, 1) + 0.0013 * cosN(n, 2);
    case 'quarter-diurnal':
      return m2 * m2;
    case 'sixth-diurnal':
      return m2 * m2 * m2;
    case 'compound-ms4':
      return m2;
    case 'compound-mk3':
      return m2 * k1;
  }
}

/** The phase correction for a family at a node longitude, in degrees. */
export function nodeCorrectionFor(family: NodeFamily, n: number): number {
  const m2 = -2.14 * sinN(n, 1);
  const k1 = -8.86 * sinN(n, 1) + 0.68 * sinN(n, 2) - 0.07 * sinN(n, 3);
  switch (family) {
    case 'solar':
      return 0;
    case 'lunar-semidiurnal':
      return m2;
    case 'lunar-diurnal-o1':
      return 10.8 * sinN(n, 1) - 1.34 * sinN(n, 2) + 0.19 * sinN(n, 3);
    case 'lunar-diurnal-k1':
      return k1;
    case 'lunisolar-k2':
      return -17.74 * sinN(n, 1) + 0.68 * sinN(n, 2) - 0.04 * sinN(n, 3);
    case 'lunar-fortnightly':
      return -23.7 * sinN(n, 1) + 2.7 * sinN(n, 2) - 0.4 * sinN(n, 3);
    case 'lunar-monthly':
      return 0;
    case 'quarter-diurnal':
      return 2 * m2;
    case 'sixth-diurnal':
      return 3 * m2;
    case 'compound-ms4':
      return m2;
    case 'compound-mk3':
      return m2 + k1;
  }
}

export interface NodeState {
  readonly minute: Minute;
  readonly longitudes: MeanLongitudes;
}

export function nodeStateAt(minute: Minute): NodeState {
  return { minute, longitudes: meanLongitudes(minute) };
}

export function nodeFactor(constituent: Constituent, state: NodeState): number {
  return nodeFactorFor(constituent.family, state.longitudes.n);
}

export function nodeCorrection(constituent: Constituent, state: NodeState): number {
  return nodeCorrectionFor(constituent.family, state.longitudes.n);
}

/**
 * The equilibrium argument, node correction included, in degrees. This is the
 * phase the constituent would have if the ocean responded instantly; the
 * gauge's fitted lag is subtracted from it at prediction time.
 */
export function equilibriumArgument(constituent: Constituent, state: NodeState): number {
  const longitudes = state.longitudes;
  const tau = lunarTimeAngle(state.minute, longitudes);
  const [i1, i2, i3, i4, i5, i6] = constituent.doodson;
  const base =
    i1 * tau +
    i2 * longitudes.s +
    i3 * longitudes.h +
    i4 * longitudes.p +
    i5 * longitudes.n +
    i6 * longitudes.p1 +
    constituent.phaseQuarters * 90;
  return normaliseDegrees(base + nodeCorrection(constituent, state));
}

/** Degrees the constituent turns in the given number of minutes. */
export function advance(constituent: Constituent, minutes: number): number {
  return (constituent.speed * minutes) / 60;
}

/** The node cycle in days, from the rate the node regresses at. */
export function nodeCycleDays(): number {
  return 360 / (RATES.n * 24);
}

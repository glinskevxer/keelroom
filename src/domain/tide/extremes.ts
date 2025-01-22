/**
 * High and low waters, found from the curve rather than from a table.
 *
 * The rate crosses zero at every turn of the tide, so the search is a coarse
 * scan for a sign change followed by a bisection onto the minute. A minute is
 * as fine as anything downstream can use: the ordering system works in whole
 * minutes and the gauge itself is not better than a few centimetres.
 */

import type { Minute } from '../../util/clock';
import type { Cm } from '../../util/units';
import { curvatureAt, heightAt, prepare, rateAt } from './predict';
import type { PreparedStation } from './predict';
import type { TideStation } from './station';

export type ExtremeKind = 'high' | 'low';

export interface Extreme {
  readonly kind: ExtremeKind;
  readonly minute: Minute;
  readonly height: Cm;
}

export interface ExtremeOptions {
  /** Coarse scan step. Ten minutes is well inside the shortest tide we carry. */
  readonly scanMinutes?: number;
}

/** Find every turn of the tide in a range, in time order. */
export function findExtremes(
  station: TideStation,
  from: Minute,
  to: Minute,
  options: ExtremeOptions = {},
): Extreme[] {
  if (to <= from) {
    throw new Error('extremes range ends before it starts');
  }
  const scan = options.scanMinutes ?? 10;
  if (scan <= 0 || Math.trunc(scan) !== scan) {
    throw new Error(`scan step must be a whole number of minutes, got ${scan}`);
  }
  const prepared = prepare(station, Math.round((from + to) / 2));
  const found: Extreme[] = [];
  let previousMinute = from;
  let previousRate = rateAt(prepared, from);
  for (let minute = from + scan; minute <= to; minute += scan) {
    const rate = rateAt(prepared, minute);
    if (previousRate === 0) {
      found.push(atTurn(prepared, previousMinute));
    } else if (Math.sign(rate) !== Math.sign(previousRate)) {
      const turn = bisectRate(prepared, previousMinute, minute);
      found.push(atTurn(prepared, turn));
    }
    previousMinute = minute;
    previousRate = rate;
  }
  return dedupe(found).filter((extreme) => extreme.minute >= from && extreme.minute <= to);
}

function atTurn(prepared: PreparedStation, minute: Minute): Extreme {
  const kind: ExtremeKind = curvatureAt(prepared, minute) < 0 ? 'high' : 'low';
  return { kind, minute, height: heightAt(prepared, minute) };
}

/** Bisect the rate between two minutes that bracket a sign change. */
function bisectRate(prepared: PreparedStation, low: Minute, high: Minute): Minute {
  let left = low;
  let right = high;
  let leftRate = rateAt(prepared, left);
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    const rate = rateAt(prepared, middle);
    if (rate === 0) {
      return middle;
    }
    if (Math.sign(rate) === Math.sign(leftRate)) {
      left = middle;
      leftRate = rate;
    } else {
      right = middle;
    }
  }
  return Math.abs(rateAt(prepared, left)) <= Math.abs(rateAt(prepared, right)) ? left : right;
}

function dedupe(extremes: readonly Extreme[]): Extreme[] {
  const out: Extreme[] = [];
  for (const extreme of extremes) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      Math.abs(last.minute - extreme.minute) <= 1 &&
      last.kind === extreme.kind
    ) {
      continue;
    }
    out.push(extreme);
  }
  return out;
}

export function highWaters(extremes: readonly Extreme[]): Extreme[] {
  return extremes.filter((extreme) => extreme.kind === 'high');
}

export function lowWaters(extremes: readonly Extreme[]): Extreme[] {
  return extremes.filter((extreme) => extreme.kind === 'low');
}

/** The turn of the tide at or before a minute, if the range holds one. */
export function lastExtremeBefore(
  extremes: readonly Extreme[],
  minute: Minute,
): Extreme | undefined {
  let best: Extreme | undefined;
  for (const extreme of extremes) {
    if (extreme.minute <= minute) {
      best = extreme;
    }
  }
  return best;
}

export function nextExtremeAfter(
  extremes: readonly Extreme[],
  minute: Minute,
): Extreme | undefined {
  return extremes.find((extreme) => extreme.minute > minute);
}

/** Whether the tide is making or falling at a minute, from the turns around it. */
export function tideState(
  extremes: readonly Extreme[],
  minute: Minute,
): 'making' | 'falling' | 'unknown' {
  const next = nextExtremeAfter(extremes, minute);
  if (next === undefined) {
    return 'unknown';
  }
  return next.kind === 'high' ? 'making' : 'falling';
}

/** The range of the tide either side of a turn, in centimetres. */
export function rangeAround(extremes: readonly Extreme[], index: number): Cm | undefined {
  const here = extremes[index];
  const next = extremes[index + 1];
  if (here === undefined || next === undefined) {
    return undefined;
  }
  return Math.abs(next.height - here.height);
}

/** The tallest high water in a set, which is what a deep ship is planned around. */
export function tallestHighWater(extremes: readonly Extreme[]): Extreme | undefined {
  return highWaters(extremes).reduce<Extreme | undefined>(
    (best, extreme) => (best === undefined || extreme.height > best.height ? extreme : best),
    undefined,
  );
}

export function shallowestLowWater(extremes: readonly Extreme[]): Extreme | undefined {
  return lowWaters(extremes).reduce<Extreme | undefined>(
    (best, extreme) => (best === undefined || extreme.height < best.height ? extreme : best),
    undefined,
  );
}

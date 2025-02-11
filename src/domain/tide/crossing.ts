/**
 * When is there at least so much tide, and when is there at most so much.
 *
 * A reach needs a minimum height of tide to be passable, and a bridge needs a
 * maximum, so both questions are asked of the same curve and both come back as
 * a set of intervals. The scan is coarse and the edges are bisected, and the
 * result is trimmed inwards by a minute on each side so a boundary minute
 * always satisfies the test it was derived from. A window whose edge failed its
 * own test would be worse than no window at all.
 */

import type { Minute } from '../../util/clock';
import type { Interval } from '../../util/interval';
import { clip, normalise } from '../../util/interval';
import type { Cm } from '../../util/units';
import { heightAt, heightExact, prepare } from './predict';
import type { PreparedStation } from './predict';
import type { TideStation } from './station';

export interface ScanOptions {
  /** Coarse scan step in minutes. */
  readonly scanMinutes?: number;
}

type Test = (height: number) => boolean;

function scan(
  prepared: PreparedStation,
  bounds: Interval,
  test: Test,
  scanMinutes: number,
): Interval[] {
  const found: Interval[] = [];
  let openedAt: Minute | undefined;
  let previousMinute = bounds.from;
  let previousPass = test(heightExact(prepared, bounds.from));
  if (previousPass) {
    openedAt = bounds.from;
  }
  for (let minute = bounds.from + scanMinutes; ; minute += scanMinutes) {
    const at = Math.min(minute, bounds.to);
    const pass = test(heightExact(prepared, at));
    if (pass !== previousPass) {
      const edge = bisect(prepared, previousMinute, at, test);
      if (pass) {
        openedAt = edge;
      } else if (openedAt !== undefined) {
        found.push({ from: openedAt, to: edge });
        openedAt = undefined;
      }
    }
    previousPass = pass;
    previousMinute = at;
    if (at >= bounds.to) {
      break;
    }
  }
  if (openedAt !== undefined) {
    found.push({ from: openedAt, to: bounds.to });
  }
  return found.filter((interval) => interval.to >= interval.from);
}

/**
 * Find the first minute at or after `low` that passes, given that `low` fails
 * and `high` passes, or the last minute that passes in the opposite case.
 */
function bisect(prepared: PreparedStation, low: Minute, high: Minute, test: Test): Minute {
  const lowPasses = test(heightExact(prepared, low));
  let left = low;
  let right = high;
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    if (test(heightExact(prepared, middle)) === lowPasses) {
      left = middle;
    } else {
      right = middle;
    }
  }
  return lowPasses ? left : right;
}

/** Every stretch where the tide is at or above a height above chart datum. */
export function intervalsAtOrAbove(
  station: TideStation,
  bounds: Interval,
  threshold: Cm,
  options: ScanOptions = {},
): Interval[] {
  return scanFor(station, bounds, (height) => height >= threshold, options);
}

/** Every stretch where the tide is at or below a height above chart datum. */
export function intervalsAtOrBelow(
  station: TideStation,
  bounds: Interval,
  threshold: Cm,
  options: ScanOptions = {},
): Interval[] {
  return scanFor(station, bounds, (height) => height <= threshold, options);
}

function scanFor(
  station: TideStation,
  bounds: Interval,
  test: Test,
  options: ScanOptions,
): Interval[] {
  const step = options.scanMinutes ?? 5;
  if (step <= 0 || Math.trunc(step) !== step) {
    throw new Error(`scan step must be a whole number of minutes, got ${step}`);
  }
  if (bounds.to < bounds.from) {
    throw new Error('scan range ends before it starts');
  }
  const prepared = prepare(station, Math.round((bounds.from + bounds.to) / 2));
  const rounded: Test = (height) => test(Math.round(height));
  return clip(normalise(scan(prepared, bounds, rounded, step)), bounds);
}

/**
 * The first minute at or after a moment when the tide reaches a height, if it
 * does so inside the bounds.
 */
export function firstReaches(
  station: TideStation,
  bounds: Interval,
  threshold: Cm,
  options: ScanOptions = {},
): Minute | undefined {
  return intervalsAtOrAbove(station, bounds, threshold, options)[0]?.from;
}

/** How much tide is guaranteed across a whole interval. */
export function minimumHeightOver(
  station: TideStation,
  interval: Interval,
  options: ScanOptions = {},
): Cm {
  const step = options.scanMinutes ?? 5;
  const prepared = prepare(station, Math.round((interval.from + interval.to) / 2));
  let lowest = heightAt(prepared, interval.from);
  for (let minute = interval.from; minute <= interval.to; minute += step) {
    lowest = Math.min(lowest, heightAt(prepared, minute));
  }
  return Math.min(lowest, heightAt(prepared, interval.to));
}

export function maximumHeightOver(
  station: TideStation,
  interval: Interval,
  options: ScanOptions = {},
): Cm {
  const step = options.scanMinutes ?? 5;
  const prepared = prepare(station, Math.round((interval.from + interval.to) / 2));
  let highest = heightAt(prepared, interval.from);
  for (let minute = interval.from; minute <= interval.to; minute += step) {
    highest = Math.max(highest, heightAt(prepared, minute));
  }
  return Math.max(highest, heightAt(prepared, interval.to));
}

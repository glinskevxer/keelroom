/**
 * Closed intervals of minutes, and the set algebra over them.
 *
 * Every constraint in the planner ends up as a set of intervals when a ship may
 * pass, and a transit window is what is left after all of them are intersected.
 * Intervals are closed at both ends because a window that ends at 14:30 means
 * the ship may still be moving at 14:30.
 */

import type { Minute } from './clock';

export interface Interval {
  readonly from: Minute;
  readonly to: Minute;
}

export class IntervalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntervalError';
  }
}

export function makeInterval(from: Minute, to: Minute): Interval {
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw new IntervalError(`interval bounds must be whole minutes, got ${from} to ${to}`);
  }
  if (to < from) {
    throw new IntervalError(`interval ends before it starts: ${from} to ${to}`);
  }
  return { from, to };
}

export function duration(interval: Interval): number {
  return interval.to - interval.from;
}

export function contains(interval: Interval, minute: Minute): boolean {
  return minute >= interval.from && minute <= interval.to;
}

export function overlaps(left: Interval, right: Interval): boolean {
  return left.from <= right.to && right.from <= left.to;
}

export function intersect(left: Interval, right: Interval): Interval | undefined {
  const from = Math.max(left.from, right.from);
  const to = Math.min(left.to, right.to);
  return to < from ? undefined : { from, to };
}

/** Sort and join anything that touches or overlaps. */
export function normalise(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Interval[] = [];
  for (const interval of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && interval.from <= last.to + 1) {
      out[out.length - 1] = { from: last.from, to: Math.max(last.to, interval.to) };
      continue;
    }
    out.push({ from: interval.from, to: interval.to });
  }
  return out;
}

export function unionAll(...sets: readonly (readonly Interval[])[]): Interval[] {
  return normalise(sets.flat());
}

/** Every minute that is in both sets. */
export function intersectSets(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  const a = normalise(left);
  const b = normalise(right);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const piece = intersect(a[i]!, b[j]!);
    if (piece !== undefined) {
      out.push(piece);
    }
    if (a[i]!.to <= b[j]!.to) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return out;
}

/** Everything in the left set that is not in the right set. */
export function subtractSets(left: readonly Interval[], right: readonly Interval[]): Interval[] {
  const blocked = normalise(right);
  const out: Interval[] = [];
  for (const interval of normalise(left)) {
    let cursor = interval.from;
    for (const block of blocked) {
      if (block.to < cursor || block.from > interval.to) {
        continue;
      }
      if (block.from > cursor) {
        out.push({ from: cursor, to: Math.min(block.from - 1, interval.to) });
      }
      cursor = Math.max(cursor, block.to + 1);
      if (cursor > interval.to) {
        break;
      }
    }
    if (cursor <= interval.to) {
      out.push({ from: cursor, to: interval.to });
    }
  }
  return out.filter((interval) => interval.to >= interval.from);
}

export function clip(intervals: readonly Interval[], bounds: Interval): Interval[] {
  return normalise(intervals)
    .map((interval) => intersect(interval, bounds))
    .filter((interval): interval is Interval => interval !== undefined);
}

/** Drop anything shorter than the given number of minutes. */
export function atLeast(intervals: readonly Interval[], minutes: number): Interval[] {
  return intervals.filter((interval) => duration(interval) >= minutes);
}

/** Pull both ends in, which is how a safety margin on a window is applied. */
export function shrink(intervals: readonly Interval[], minutes: number): Interval[] {
  return intervals
    .map((interval) => ({ from: interval.from + minutes, to: interval.to - minutes }))
    .filter((interval) => interval.to >= interval.from);
}

export function shift(intervals: readonly Interval[], minutes: number): Interval[] {
  return intervals.map((interval) => ({
    from: interval.from + minutes,
    to: interval.to + minutes,
  }));
}

export function totalMinutes(intervals: readonly Interval[]): number {
  return normalise(intervals).reduce((total, interval) => total + duration(interval), 0);
}

export function longest(intervals: readonly Interval[]): Interval | undefined {
  return intervals.reduce<Interval | undefined>(
    (best, interval) =>
      best === undefined || duration(interval) > duration(best) ? interval : best,
    undefined,
  );
}

export function earliest(intervals: readonly Interval[]): Interval | undefined {
  return normalise(intervals)[0];
}

/** The first interval that can hold a run of the given length at or after a minute. */
export function firstFit(
  intervals: readonly Interval[],
  minutes: number,
  notBefore: Minute,
): Minute | undefined {
  for (const interval of normalise(intervals)) {
    const start = Math.max(interval.from, notBefore);
    if (start + minutes <= interval.to) {
      return start;
    }
  }
  return undefined;
}

export function describeInterval(interval: Interval, format: (minute: Minute) => string): string {
  return `${format(interval.from)} to ${format(interval.to)}`;
}

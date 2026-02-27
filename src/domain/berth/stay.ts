/**
 * Which ship is lying where.
 *
 * A berth holds one ship at a time, and the district works out who is alongside
 * from the movements rather than from a separate berth diary: a ship arrives at
 * a berth and lies there until a movement takes her away again. That means the
 * occupancy is right by construction, and it also means an arrival with no
 * departure behind it leaves the berth looking occupied for ever, which is
 * exactly the thing the berth report should be shouting about.
 */

import type { Minute } from '../../util/clock';
import type { Interval } from '../../util/interval';
import { makeInterval, overlaps } from '../../util/interval';
import type { Cm } from '../../util/units';
import type { Berth } from '../chart/berth';
import { canLie, takesLength } from '../chart/berth';
import type { Movement } from '../movement/movement';

export interface Stay {
  readonly berth: string;
  readonly vessel: string;
  readonly from: Minute;
  /** Absent while she is still there. */
  readonly to?: Minute;
  readonly arrival: string;
  readonly departure?: string;
}

function timeOf(movement: Movement): Minute {
  return movement.plannedFor ?? movement.requestedFor;
}

/**
 * Build the stays from a set of movements. Movements are read in time order, an
 * arrival or a shift onto a berth opens a stay and a departure or a shift off it
 * closes the one that was open.
 */
export function staysFrom(movements: readonly Movement[]): Stay[] {
  const ordered = [...movements]
    .filter((movement) => movement.status !== 'cancelled' && movement.status !== 'refused')
    .sort((a, b) => timeOf(a) - timeOf(b) || a.reference.localeCompare(b.reference));
  const stays: Stay[] = [];
  const open = new Map<string, number>();
  for (const movement of ordered) {
    const at = timeOf(movement);
    if (movement.from !== 'SEA') {
      const index = open.get(`${movement.vessel}@${movement.from}`);
      if (index !== undefined) {
        const stay = stays[index];
        if (stay !== undefined) {
          stays[index] = { ...stay, to: at, departure: movement.reference };
        }
        open.delete(`${movement.vessel}@${movement.from}`);
      }
    }
    if (movement.to !== 'SEA') {
      stays.push({
        berth: movement.to,
        vessel: movement.vessel,
        from: at,
        arrival: movement.reference,
      });
      open.set(`${movement.vessel}@${movement.to}`, stays.length - 1);
    }
  }
  return stays;
}

export function stayPeriod(stay: Stay, openEndsAt: Minute): Interval {
  return makeInterval(stay.from, stay.to ?? Math.max(stay.from, openEndsAt));
}

export function staysAt(stays: readonly Stay[], berth: string): Stay[] {
  return stays.filter((stay) => stay.berth === berth).sort((a, b) => a.from - b.from);
}

export interface BerthConflict {
  readonly berth: string;
  readonly first: string;
  readonly second: string;
  readonly period: Interval;
}

/** Two ships alongside the same berth at once. */
export function berthConflicts(stays: readonly Stay[], openEndsAt: Minute): BerthConflict[] {
  const found: BerthConflict[] = [];
  const sorted = [...stays].sort((a, b) => a.berth.localeCompare(b.berth) || a.from - b.from);
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const left = sorted[i]!;
      const right = sorted[j]!;
      if (left.berth !== right.berth) {
        continue;
      }
      const leftPeriod = stayPeriod(left, openEndsAt);
      const rightPeriod = stayPeriod(right, openEndsAt);
      if (!overlaps(leftPeriod, rightPeriod)) {
        continue;
      }
      found.push({
        berth: left.berth,
        first: left.arrival,
        second: right.arrival,
        period: makeInterval(
          Math.max(leftPeriod.from, rightPeriod.from),
          Math.min(leftPeriod.to, rightPeriod.to),
        ),
      });
    }
  }
  return found;
}

export function isOccupied(
  stays: readonly Stay[],
  berth: string,
  at: Minute,
  openEndsAt: Minute,
): boolean {
  return staysAt(stays, berth).some((stay) => {
    const period = stayPeriod(stay, openEndsAt);
    return at >= period.from && at <= period.to;
  });
}

export interface BerthCandidate {
  readonly berth: Berth;
  readonly free: boolean;
  readonly fits: boolean;
  readonly reason?: string;
}

/** Which berths could take a ship over a period, and why the others could not. */
export function candidates(
  berths: readonly Berth[],
  stays: readonly Stay[],
  period: Interval,
  ship: { length: Cm; draught: Cm; tideHeight: Cm },
  openEndsAt: Minute,
): BerthCandidate[] {
  return berths.map((berth) => {
    const free = !staysAt(stays, berth.id).some((stay) =>
      overlaps(stayPeriod(stay, openEndsAt), period),
    );
    const fitsLength = takesLength(berth, ship.length);
    const fitsDepth = canLie(berth, ship.draught, ship.tideHeight);
    const fits = fitsLength && fitsDepth;
    const reason = !fitsLength
      ? 'she is longer than the berth'
      : !fitsDepth
        ? 'not enough water alongside'
        : !free
          ? 'another ship is lying there'
          : undefined;
    return { berth, free, fits, ...(reason === undefined ? {} : { reason }) };
  });
}

export function firstFree(candidates_: readonly BerthCandidate[]): BerthCandidate | undefined {
  return candidates_.find((candidate) => candidate.free && candidate.fits);
}

/** Stays with no departure behind them, which the report chases. */
export function openStays(stays: readonly Stay[]): Stay[] {
  return stays.filter((stay) => stay.to === undefined);
}

/**
 * Who is in which reach, and when.
 *
 * A confirmed movement is not only a window; it is a claim on a stretch of
 * channel for a quarter of an hour at a time. Two ships in the same reach are
 * ordinary and two ships passing each other in a one way reach is not, so the
 * despatcher needs the day laid out reach by reach rather than movement by
 * movement.
 *
 * The occupancy is derived from the passage and the start time, so it moves when
 * the plan moves and there is nothing to keep in step by hand.
 */

import type { Minute } from '../../util/clock';
import type { Interval } from '../../util/interval';
import { intersect, makeInterval, overlaps } from '../../util/interval';
import type { Direction, Passage } from '../chart/passage';

export interface Occupancy {
  readonly movement: string;
  readonly reach: string;
  readonly direction: Direction;
  readonly period: Interval;
  /** Pilotage units, which decide whether the reach goes one way. */
  readonly units: number;
}

export interface OccupancyInput {
  readonly movement: string;
  readonly passage: Passage;
  readonly startAt: Minute;
  readonly units: number;
  /** Minutes of margin added at each end of every reach. */
  readonly margin?: number;
}

export function occupancyOf(input: OccupancyInput): Occupancy[] {
  const margin = input.margin ?? 5;
  return input.passage.legs.map((leg) => ({
    movement: input.movement,
    reach: leg.reach.id,
    direction: input.passage.direction,
    period: makeInterval(input.startAt + leg.entry - margin, input.startAt + leg.exit + margin),
    units: input.units,
  }));
}

export type ConflictKind = 'head-on' | 'overtaking' | 'one-way' | 'crowded';

export interface Conflict {
  readonly kind: ConflictKind;
  readonly reach: string;
  readonly first: string;
  readonly second: string;
  readonly period: Interval;
}

export interface TrafficRules {
  /** Units above which a ship holds the reach to herself. */
  readonly oneWayUnits: number;
  /** Ships in one reach at once before it counts as crowded. */
  readonly crowdedAt: number;
}

export const STANDARD_TRAFFIC: TrafficRules = {
  oneWayUnits: 400,
  crowdedAt: 3,
};

/** Every pair that meets, worst kind first. */
export function conflicts(
  occupancies: readonly Occupancy[],
  rules: TrafficRules = STANDARD_TRAFFIC,
): Conflict[] {
  const found: Conflict[] = [];
  const sorted = [...occupancies].sort(
    (a, b) => a.reach.localeCompare(b.reach) || a.period.from - b.period.from,
  );
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const left = sorted[i]!;
      const right = sorted[j]!;
      if (left.reach !== right.reach || left.movement === right.movement) {
        continue;
      }
      if (!overlaps(left.period, right.period)) {
        continue;
      }
      const period = intersect(left.period, right.period);
      if (period === undefined) {
        continue;
      }
      const kind: ConflictKind =
        left.units >= rules.oneWayUnits || right.units >= rules.oneWayUnits
          ? 'one-way'
          : left.direction === right.direction
            ? 'overtaking'
            : 'head-on';
      found.push({
        kind,
        reach: left.reach,
        first: left.movement,
        second: right.movement,
        period,
      });
    }
  }
  found.push(...crowding(sorted, rules));
  return found.sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      a.period.from - b.period.from ||
      a.reach.localeCompare(b.reach),
  );
}

function rank(kind: ConflictKind): number {
  switch (kind) {
    case 'one-way':
      return 0;
    case 'head-on':
      return 1;
    case 'overtaking':
      return 2;
    case 'crowded':
      return 3;
  }
}

/** Reaches carrying more ships at once than the district allows. */
function crowding(occupancies: readonly Occupancy[], rules: TrafficRules): Conflict[] {
  const found: Conflict[] = [];
  const byReach = new Map<string, Occupancy[]>();
  for (const occupancy of occupancies) {
    byReach.set(occupancy.reach, [...(byReach.get(occupancy.reach) ?? []), occupancy]);
  }
  for (const [reach, held] of byReach) {
    for (const candidate of held) {
      const together = held.filter((other) => overlaps(other.period, candidate.period));
      if (together.length >= rules.crowdedAt) {
        const last = together[together.length - 1];
        if (last === undefined || last.movement === candidate.movement) {
          continue;
        }
        found.push({
          kind: 'crowded',
          reach,
          first: candidate.movement,
          second: last.movement,
          period: candidate.period,
        });
        break;
      }
    }
  }
  return found;
}

/** The movements in a reach at a moment, which is what the vhf call needs. */
export function inReachAt(
  occupancies: readonly Occupancy[],
  reach: string,
  minute: Minute,
): Occupancy[] {
  return occupancies.filter(
    (occupancy) =>
      occupancy.reach === reach && minute >= occupancy.period.from && minute <= occupancy.period.to,
  );
}

export function busiestReach(occupancies: readonly Occupancy[]): string | undefined {
  const counts = new Map<string, number>();
  for (const occupancy of occupancies) {
    counts.set(occupancy.reach, (counts.get(occupancy.reach) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

/** Whether a movement can be added without making a conflict worse. */
export function wouldConflict(
  existing: readonly Occupancy[],
  candidate: readonly Occupancy[],
  rules: TrafficRules = STANDARD_TRAFFIC,
): Conflict[] {
  const before = conflicts(existing, rules).length;
  const after = conflicts([...existing, ...candidate], rules);
  return after.length > before ? after.slice(before) : [];
}

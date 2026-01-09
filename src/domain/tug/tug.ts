/**
 * The tugs, and who has them.
 *
 * The district does not own the tugs; two towage companies do, and they lend
 * them to movements. What the district keeps is a list of what is available,
 * what each one pulls, and which movement has which one when. A movement that
 * wants four tugs and can raise three is a movement that does not go, and that
 * is worth knowing the day before rather than on the day.
 */

import { InputError } from '../../util/errors';
import type { Interval } from '../../util/interval';
import { overlaps } from '../../util/interval';

export interface Tug {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  /** Bollard pull in tonnes. */
  readonly pull: number;
  /** Whether she is fitted for escort work at speed. */
  readonly escort: boolean;
  readonly active: boolean;
}

const TUG_ID = /^T[0-9]{1,3}$/;

export function makeTug(input: {
  id: string;
  name: string;
  owner: string;
  pull: number;
  escort?: boolean;
  active?: boolean;
}): Tug {
  if (!TUG_ID.test(input.id)) {
    throw new InputError(`tug id must look like T4, got ${JSON.stringify(input.id)}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`tug ${input.id} has no name`);
  }
  if (!Number.isInteger(input.pull) || input.pull <= 0) {
    throw new InputError(`tug ${input.id} pulls nothing`);
  }
  return {
    id: input.id,
    name: input.name.trim(),
    owner: input.owner,
    pull: input.pull,
    escort: input.escort ?? false,
    active: input.active ?? true,
  };
}

export interface TugBooking {
  readonly tug: string;
  readonly movement: string;
  readonly period: Interval;
}

export function isFree(bookings: readonly TugBooking[], tug: string, period: Interval): boolean {
  return !bookings.some((booking) => booking.tug === tug && overlaps(booking.period, period));
}

export function freeTugs(
  tugs: readonly Tug[],
  bookings: readonly TugBooking[],
  period: Interval,
): Tug[] {
  return tugs.filter((tug) => tug.active && isFree(bookings, tug.id, period));
}

export interface TugDemand {
  /** How many hulls the standing orders want. */
  readonly count: number;
  /** Total bollard pull the movement needs, in tonnes. */
  readonly pull: number;
  /** Whether one of them has to be an escort tug. */
  readonly escort?: boolean;
  readonly period: Interval;
}

export interface Allocation {
  readonly tugs: readonly Tug[];
  readonly shortBy: number;
  readonly pull: number;
  readonly met: boolean;
  readonly reason?: string;
}

/**
 * Take the tugs that answer the demand: the escort first when one is wanted,
 * then the strongest, because a movement that cannot raise the pull is refused
 * whole and there is no credit for having taken four weak ones.
 */
export function allocateTugs(
  tugs: readonly Tug[],
  bookings: readonly TugBooking[],
  demand: TugDemand,
): Allocation {
  if (!Number.isInteger(demand.count) || demand.count < 0) {
    throw new InputError('a movement wants a whole number of tugs');
  }
  const available = freeTugs(tugs, bookings, demand.period).sort(
    (a, b) => b.pull - a.pull || a.id.localeCompare(b.id),
  );
  const taken: Tug[] = [];
  if (demand.escort === true) {
    const escort = available.find((tug) => tug.escort);
    if (escort === undefined) {
      return {
        tugs: [],
        shortBy: demand.count,
        pull: 0,
        met: false,
        reason: 'no escort tug is free',
      };
    }
    taken.push(escort);
  }
  for (const tug of available) {
    if (taken.length >= demand.count) {
      break;
    }
    if (taken.some((held) => held.id === tug.id)) {
      continue;
    }
    taken.push(tug);
  }
  const pull = taken.reduce((total, tug) => total + tug.pull, 0);
  const shortBy = Math.max(0, demand.count - taken.length);
  if (shortBy > 0) {
    return {
      tugs: taken,
      shortBy,
      pull,
      met: false,
      reason: `${shortBy} short of the hulls wanted`,
    };
  }
  if (pull < demand.pull) {
    return {
      tugs: taken,
      shortBy: 0,
      pull,
      met: false,
      reason: `${demand.pull - pull} tonnes short of the pull wanted`,
    };
  }
  return { tugs: taken, shortBy: 0, pull, met: true };
}

export function bookingsFor(bookings: readonly TugBooking[], movement: string): TugBooking[] {
  return bookings.filter((booking) => booking.movement === movement);
}

/** Bollard pull the district can raise at all, whatever is booked. */
export function fleetPull(tugs: readonly Tug[]): number {
  return tugs.filter((tug) => tug.active).reduce((total, tug) => total + tug.pull, 0);
}

export function byOwner(tugs: readonly Tug[]): Record<string, Tug[]> {
  const grouped: Record<string, Tug[]> = {};
  for (const tug of tugs) {
    grouped[tug.owner] = [...(grouped[tug.owner] ?? []), tug];
  }
  return grouped;
}

export function describeTug(tug: Tug): string {
  const escort = tug.escort ? ', escort fitted' : '';
  const active = tug.active ? '' : ' (laid up)';
  return `${tug.id} ${tug.name}, ${tug.pull} t${escort}${active}`;
}

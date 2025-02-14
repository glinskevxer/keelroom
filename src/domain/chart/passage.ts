/**
 * A passage is the ordered run of reaches a ship takes between the sea buoy and
 * a berth, with the time it is in each one measured from the moment it starts.
 *
 * The offsets are what makes the tide sweep possible. A ship that starts at the
 * sea buoy at 06:00 is not on the upper bar until 07:40, so the height of tide
 * that matters on the upper bar is the height at 07:40, and a window is only a
 * window if every reach clears at its own offset rather than at the start.
 */

import { InputError } from '../../util/errors';
import type { Reach } from './reach';
import { permittedSpeed, transitMinutes } from './reach';

export type Direction = 'inbound' | 'outbound';

export interface Leg {
  readonly reach: Reach;
  /** Minutes from the start of the passage to entering this reach. */
  readonly entry: number;
  /** Minutes from the start of the passage to leaving it. */
  readonly exit: number;
  /** Speed made good through this reach, in tenths of a knot. */
  readonly speed: number;
}

export interface Passage {
  readonly direction: Direction;
  readonly legs: readonly Leg[];
  /** Total minutes from entering the first reach to leaving the last. */
  readonly minutes: number;
  /** Total distance in metres. */
  readonly length: number;
}

export interface PassageOptions {
  /** Requested speed over the ground in tenths of a knot. */
  readonly speed: number;
  /** Minutes held at the start, for boarding or for letting go. */
  readonly startDelay?: number;
  /** Extra minutes at the end, for berthing or for disembarking. */
  readonly endDelay?: number;
  /** Extra minutes held between two named reaches, keyed by the earlier one. */
  readonly holds?: Readonly<Record<string, number>>;
}

/**
 * Build a passage from reaches given seaward first. An outbound passage runs
 * the same reaches in the other order, which is what the district's charts
 * assume and what the tide sweep then follows.
 */
export function buildPassage(
  reaches: readonly Reach[],
  direction: Direction,
  options: PassageOptions,
): Passage {
  if (reaches.length === 0) {
    throw new InputError('a passage needs at least one reach');
  }
  if (!Number.isInteger(options.speed) || options.speed <= 0) {
    throw new InputError(`passage speed must be whole tenths of a knot, got ${options.speed}`);
  }
  const startDelay = options.startDelay ?? 0;
  const endDelay = options.endDelay ?? 0;
  if (startDelay < 0 || endDelay < 0) {
    throw new InputError('a passage cannot hold for a negative number of minutes');
  }
  const ordered = direction === 'inbound' ? [...reaches] : [...reaches].reverse();
  const seen = new Set<string>();
  for (const reach of ordered) {
    if (seen.has(reach.id)) {
      throw new InputError(`reach ${reach.id} appears in the passage twice`);
    }
    seen.add(reach.id);
  }
  const legs: Leg[] = [];
  let cursor = startDelay;
  let length = 0;
  for (const reach of ordered) {
    const speed = permittedSpeed(reach, options.speed);
    const entry = cursor;
    const exit = entry + transitMinutes(reach, options.speed);
    legs.push({ reach, entry, exit, speed });
    length += reach.length;
    cursor = exit + (options.holds?.[reach.id] ?? 0);
  }
  return { direction, legs, minutes: cursor + endDelay, length };
}

export function legFor(passage: Passage, reachId: string): Leg | undefined {
  return passage.legs.find((leg) => leg.reach.id === reachId);
}

/** The reach the ship is in at a given number of minutes after the start. */
export function legAt(passage: Passage, offset: number): Leg | undefined {
  return passage.legs.find((leg) => offset >= leg.entry && offset <= leg.exit);
}

/** The controlling reach for a draught: the one with the least planned water. */
export function shallowestLeg(passage: Passage): Leg {
  const first = passage.legs[0];
  if (first === undefined) {
    throw new InputError('an empty passage has no shallowest reach');
  }
  return passage.legs.reduce(
    (worst, leg) => (leg.reach.chartedDepth < worst.reach.chartedDepth ? leg : worst),
    first,
  );
}

/** Distance in nautical miles, which is what the tariff and the log both use. */
export function nauticalMiles(passage: Passage): number {
  return passage.length / 1852;
}

/** Average speed over the ground for the whole passage, in tenths of a knot. */
export function averageSpeed(passage: Passage): number {
  if (passage.minutes === 0) {
    throw new InputError('a passage of no minutes has no average speed');
  }
  return Math.round((nauticalMiles(passage) / (passage.minutes / 60)) * 10);
}

export function stationsUsed(passage: Passage): string[] {
  const stations = new Set(passage.legs.map((leg) => leg.reach.station));
  return [...stations].sort();
}

export function describePassage(passage: Passage): string {
  const first = passage.legs[0]?.reach.id ?? '(none)';
  const last = passage.legs[passage.legs.length - 1]?.reach.id ?? '(none)';
  return `${passage.direction} ${first} to ${last}, ${passage.legs.length} reaches, ${passage.minutes} min`;
}

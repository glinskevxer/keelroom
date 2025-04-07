/**
 * The constraint that faces the other way.
 *
 * A bridge or a cable is passable while the tide is low enough, and the sweep
 * over the reaches wants it high enough, so a ship that is both deep and tall
 * has a window bounded from both sides. On a big spring at this port those two
 * demands can pass each other entirely, and there is no minute in the month
 * when she can go. The district would rather know that on the day the order is
 * placed than on the day she sails.
 */

import type { Interval } from '../../util/interval';
import { clip, intersectSets } from '../../util/interval';
import type { Finding } from '../../util/finding';
import { FindingLog } from '../../util/finding';
import type { Cm } from '../../util/units';
import { requireStation } from '../chart/district';
import type { Overhead } from '../chart/overhead';
import { highestPassableTide, neverPasses } from '../chart/overhead';
import type { Leg } from '../chart/passage';
import { intervalsAtOrBelow } from '../tide/crossing';
import { startsForAll } from './sweep';
import type { TransitPlan } from './sweep';

export interface OverheadWindow {
  readonly overhead: string;
  readonly reach: string;
  /** The most tide the ship can have and still fit under. */
  readonly highestTide: Cm;
  readonly starts: readonly Interval[];
}

export interface OverheadSweep {
  readonly windows: readonly Interval[];
  readonly overheads: readonly OverheadWindow[];
  readonly findings: readonly Finding[];
}

/** Air draught at the draught the ship is presented at, not at her marks. */
export function airDraughtAt(plan: TransitPlan): Cm {
  const lighter = plan.vessel.summerDraught - plan.draught;
  return plan.vessel.airDraught + Math.max(0, lighter);
}

/** The start times that take this ship under one structure. */
export function overheadWindow(
  plan: TransitPlan,
  overhead: Overhead,
  leg: Leg,
  bounds: Interval,
): OverheadWindow {
  const station = requireStation(plan.district, overhead.station);
  const airDraught = airDraughtAt(plan);
  const highestTide = highestPassableTide(overhead, airDraught);
  if (highestTide < 0) {
    return { overhead: overhead.id, reach: leg.reach.id, highestTide, starts: [] };
  }
  const atReach: Interval = { from: bounds.from + leg.entry, to: bounds.to + leg.exit };
  const low = intervalsAtOrBelow(station, atReach, highestTide);
  return {
    overhead: overhead.id,
    reach: leg.reach.id,
    highestTide,
    starts: clip(startsForAll(low, leg), bounds),
  };
}

/** Every structure on the passage, intersected. */
export function sweepOverheads(plan: TransitPlan, bounds: Interval): OverheadSweep {
  const log = new FindingLog();
  const overheads: OverheadWindow[] = [];
  let windows: Interval[] = [{ from: bounds.from, to: bounds.to }];
  const airDraught = airDraughtAt(plan);
  for (const leg of plan.passage.legs) {
    const onThisReach = plan.district.overheads.filter(
      (overhead) => overhead.reach === leg.reach.id,
    );
    for (const overhead of onThisReach) {
      const window = overheadWindow(plan, overhead, leg, bounds);
      overheads.push(window);
      if (neverPasses(overhead, airDraught)) {
        log.block('AIR-NEVER-01', 'the ship is too tall for the structure on any tide', {
          subject: overhead.id,
          detail: { airDraught, clearance: overhead.clearance },
        });
        windows = [];
        continue;
      }
      if (window.starts.length === 0) {
        log.block('AIR-NONE-02', 'the tide never falls far enough to pass under', {
          subject: overhead.id,
          detail: { highestTide: window.highestTide },
        });
      }
      windows = intersectSets(windows, window.starts);
    }
  }
  return { windows, overheads, findings: log.all() };
}

/** The structure with the least room over the masthead. */
export function tightestOverhead(sweep: OverheadSweep): OverheadWindow | undefined {
  return sweep.overheads.reduce<OverheadWindow | undefined>(
    (worst, overhead) =>
      worst === undefined || overhead.highestTide < worst.highestTide ? overhead : worst,
    undefined,
  );
}

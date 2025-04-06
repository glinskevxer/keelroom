/**
 * The sweep: when may this ship start this passage.
 *
 * Every constraint in the district is a statement about a moment on a reach,
 * and what the despatcher needs is a statement about the moment the ship lets
 * go. So each constraint is worked out where it applies and then moved back
 * along the passage by the time it takes to get there. A reach that is passable
 * from 08:00 to 10:00, and which the ship enters ninety minutes after starting
 * and leaves twenty minutes after that, permits starts from 06:30 to 09:40, and
 * not a minute later, because she has to be clear before the water goes.
 *
 * The windows are the intersection of all of them. An empty intersection is a
 * real answer and the commonest one for a deep ship on a neap.
 */

import type { Minute } from '../../util/clock';
import type { Interval } from '../../util/interval';
import { clip, intersectSets, normalise } from '../../util/interval';
import type { Finding } from '../../util/finding';
import { FindingLog } from '../../util/finding';
import type { Cm } from '../../util/units';
import type { District } from '../chart/district';
import { requireStation } from '../chart/district';
import type { Leg, Passage } from '../chart/passage';
import { intervalsAtOrAbove } from '../tide/crossing';
import type { Vessel } from '../vessel/vessel';
import type { UkcPolicy } from '../ukc/policy';
import type { TransitConditions } from '../ukc/assessment';
import { leastTideFor } from '../ukc/solve';

export interface TransitPlan {
  readonly district: District;
  readonly passage: Passage;
  readonly vessel: Vessel;
  readonly draught: Cm;
  readonly policy: UkcPolicy;
  readonly conditions: TransitConditions;
}

export interface ReachWindow {
  readonly reach: string;
  /** Least height of tide the reach needs for this ship, if any will do. */
  readonly leastTide: Cm | undefined;
  /** Start times that clear this reach. */
  readonly starts: readonly Interval[];
}

export interface SweepResult {
  readonly windows: readonly Interval[];
  readonly reaches: readonly ReachWindow[];
  readonly findings: readonly Finding[];
}

/**
 * Move an interval measured at a reach back to the start times that put the
 * ship inside it for her whole traverse.
 */
export function startsFor(interval: Interval, leg: Leg): Interval | undefined {
  const from = interval.from - leg.entry;
  const to = interval.to - leg.exit;
  return to < from ? undefined : { from, to };
}

export function startsForAll(intervals: readonly Interval[], leg: Leg): Interval[] {
  return normalise(
    intervals
      .map((interval) => startsFor(interval, leg))
      .filter((interval): interval is Interval => interval !== undefined),
  );
}

/** The start times that clear one reach of the passage. */
export function reachWindow(plan: TransitPlan, leg: Leg, bounds: Interval): ReachWindow {
  const station = requireStation(plan.district, leg.reach.station);
  const at = Math.round((bounds.from + bounds.to) / 2) + leg.entry;
  const leastTide = leastTideFor(
    {
      reach: leg.reach,
      vessel: plan.vessel,
      policy: plan.policy,
      at,
      conditions: plan.conditions,
    },
    plan.draught,
  );
  if (leastTide === undefined) {
    return { reach: leg.reach.id, leastTide: undefined, starts: [] };
  }
  const atReach: Interval = {
    from: bounds.from + leg.entry,
    to: bounds.to + leg.exit,
  };
  const passable = intervalsAtOrAbove(station, atReach, leastTide);
  return {
    reach: leg.reach.id,
    leastTide,
    starts: clip(startsForAll(passable, leg), bounds),
  };
}

/** Sweep the whole passage and intersect every reach. */
export function sweep(plan: TransitPlan, bounds: Interval): SweepResult {
  if (bounds.to <= bounds.from) {
    throw new Error('the sweep range ends before it starts');
  }
  const log = new FindingLog();
  const reaches: ReachWindow[] = [];
  let windows: Interval[] = [{ from: bounds.from, to: bounds.to }];
  for (const leg of plan.passage.legs) {
    const window = reachWindow(plan, leg, bounds);
    reaches.push(window);
    if (window.leastTide === undefined) {
      log.block('WIN-DEEP-01', 'no height of tide takes this ship over the reach', {
        subject: leg.reach.id,
        detail: { draught: plan.draught },
      });
      windows = [];
      continue;
    }
    if (window.starts.length === 0) {
      log.block('WIN-NONE-02', 'the tide does not reach what the reach needs inside the range', {
        subject: leg.reach.id,
        detail: { leastTide: window.leastTide },
      });
    }
    windows = intersectSets(windows, window.starts);
  }
  if (windows.length === 0 && log.size === 0) {
    log.block('WIN-CROSS-03', 'every reach has a window and no two of them overlap', {
      detail: { reaches: plan.passage.legs.length },
    });
  }
  return { windows, reaches, findings: log.all() };
}

/** The reach that decided the answer: the one with the least room in it. */
export function controllingReach(result: SweepResult): ReachWindow | undefined {
  const impossible = result.reaches.find((reach) => reach.leastTide === undefined);
  if (impossible !== undefined) {
    return impossible;
  }
  return result.reaches.reduce<ReachWindow | undefined>((worst, reach) => {
    if (worst === undefined) {
      return reach;
    }
    const worstTide = worst.leastTide ?? Number.POSITIVE_INFINITY;
    const tide = reach.leastTide ?? Number.POSITIVE_INFINITY;
    return tide > worstTide ? reach : worst;
  }, undefined);
}

export function firstWindow(result: SweepResult): Interval | undefined {
  return result.windows[0];
}

export function windowAt(result: SweepResult, minute: Minute): Interval | undefined {
  return result.windows.find((window) => minute >= window.from && minute <= window.to);
}

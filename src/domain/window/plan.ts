/**
 * The whole answer for one movement: when she can go, and if she cannot, which
 * rule stopped her.
 *
 * Everything below this file answers one question each. This one puts them in
 * order and intersects them, and the order matters only for the reporting: a
 * ship blocked by the wind is told about the wind rather than about a tide she
 * was never going to use.
 */

import type { Minute } from '../../util/clock';
import type { Finding } from '../../util/finding';
import { FindingLog, blocking } from '../../util/finding';
import type { Interval } from '../../util/interval';
import { atLeast, clip, intersectSets, longest, totalMinutes } from '../../util/interval';
import type { Position } from './daylight';
import { daylightWindows } from './daylight';
import type { OverheadSweep } from './overhead';
import { sweepOverheads } from './overhead';
import type { SweepResult, TransitPlan } from './sweep';
import { sweep } from './sweep';
import type { MovementConditions, RestrictionRules, Restrictions } from './restriction';
import { assessRestrictions } from './restriction';

export interface PlanRequest {
  readonly plan: TransitPlan;
  readonly bounds: Interval;
  readonly movement: MovementConditions;
  readonly position: Position;
  readonly rules?: RestrictionRules;
  /** Minutes of twilight the orders allow either side of the sun. */
  readonly twilight?: number;
  /** A window shorter than this is not offered. */
  readonly minimumWindow?: number;
}

export interface PlanResult {
  /** Start times that satisfy every rule, in time order. */
  readonly windows: readonly Interval[];
  readonly depth: SweepResult;
  readonly air: OverheadSweep;
  readonly restrictions: Restrictions;
  readonly daylight: readonly Interval[];
  readonly findings: readonly Finding[];
  readonly passable: boolean;
}

export function planTransit(request: PlanRequest): PlanResult {
  const { plan, bounds } = request;
  const log = new FindingLog();
  const restrictions = assessRestrictions({
    rules: request.rules,
    vessel: plan.vessel,
    draught: plan.draught,
    passage: plan.passage,
    conditions: request.movement,
  });
  log.addAll(restrictions.findings);

  const depth = sweep(plan, bounds);
  log.addAll(depth.findings);
  const air = sweepOverheads(plan, bounds);
  log.addAll(air.findings);

  const daylight = restrictions.daylightOnly
    ? clip(
        daylightWindows(request.position, bounds, plan.district.offset, {
          before: request.twilight ?? 0,
          after: request.twilight ?? 0,
        }),
        bounds,
      )
    : [{ from: bounds.from, to: bounds.to }];

  let windows = intersectSets(depth.windows, air.windows);
  if (restrictions.daylightOnly) {
    const beforeDaylight = totalMinutes(windows);
    windows = intersectSets(windows, daylight);
    if (beforeDaylight > 0 && windows.length === 0) {
      log.block('PLAN-DARK-01', 'every tidal window on this passage falls in the dark');
    }
  }
  const minimum = request.minimumWindow ?? plan.passage.minutes;
  const usable = atLeast(windows, 0);
  const offered = atLeast(windows, Math.max(0, minimum - plan.passage.minutes));
  if (usable.length > 0 && offered.length === 0) {
    log.block('PLAN-SHORT-02', 'no window is long enough to be worth offering', {
      detail: { minimum },
    });
  }
  if (offered.length === 0 && log.size === 0) {
    log.block('PLAN-NONE-03', 'nothing in the range clears every rule');
  }
  const findings = log.all();
  return {
    windows: offered,
    depth,
    air,
    restrictions,
    daylight,
    findings,
    passable: offered.length > 0 && blocking(findings).length === 0,
  };
}

/** The window a despatcher would offer first: the longest one. */
export function bestWindow(result: PlanResult): Interval | undefined {
  return longest(result.windows);
}

/** The first window that starts at or after a moment. */
export function nextWindowFrom(result: PlanResult, minute: Minute): Interval | undefined {
  return result.windows.find((window) => window.to >= minute);
}

/** Total minutes on offer, which is how a plan is compared with another. */
export function windowMinutes(result: PlanResult): number {
  return totalMinutes(result.windows);
}

/** The rule ids that blocked the movement, in the order they were raised. */
export function blockingRules(result: PlanResult): string[] {
  return blocking(result.findings).map((finding) => finding.rule);
}

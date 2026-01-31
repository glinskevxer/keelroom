/**
 * The monthly return, built from the records rather than kept alongside them.
 */

import type { Minute } from '../util/clock';
import { MINUTES_PER_DAY } from '../util/clock';
import type { Interval } from '../util/interval';
import { makeInterval } from '../util/interval';
import type {
  AgentActivity,
  MovementRecord,
  PeriodSummary,
  PilotWorkload,
} from '../domain/statistics/summary';
import {
  activityByAgent,
  summarise,
  waitingHours,
  workloadByPilot,
} from '../domain/statistics/summary';
import { findTimes, movementsInWindow } from '../storage/movement-store';
import type { Context } from './context';
import { quoteMovement } from './settlement';

export interface DistrictReturn {
  readonly summary: PeriodSummary;
  readonly pilots: readonly PilotWorkload[];
  readonly agents: readonly AgentActivity[];
  readonly waitingHours: number;
}

/** Everything that happened in a period, with the money where it is known. */
export function recordsIn(context: Context, period: Interval, priced = true): MovementRecord[] {
  return movementsInWindow(context.db, period.from, period.to).map((movement) => {
    const times = findTimes(context.db, movement.reference);
    let charged: number | undefined;
    if (priced && (movement.status === 'completed' || movement.status === 'cancelled')) {
      try {
        charged = quoteMovement(context, movement.reference).total;
      } catch {
        charged = undefined;
      }
    }
    return {
      movement,
      ...(times === undefined ? {} : { times }),
      ...(charged === undefined ? {} : { charged }),
    };
  });
}

export function districtReturn(context: Context, period: Interval): DistrictReturn {
  const records = recordsIn(context, period);
  return {
    summary: summarise(records, period),
    pilots: workloadByPilot(records),
    agents: activityByAgent(records),
    waitingHours: waitingHours(records),
  };
}

export function returnForDays(context: Context, from: Minute, days: number): DistrictReturn {
  return districtReturn(context, makeInterval(from, from + days * MINUTES_PER_DAY));
}

/** The same period a year earlier, for the comparison the board asks for. */
export function comparePeriods(
  context: Context,
  period: Interval,
  earlier: Interval,
): { now: DistrictReturn; then: DistrictReturn; movementChange: number } {
  const now = districtReturn(context, period);
  const then = districtReturn(context, earlier);
  return {
    now,
    then,
    movementChange: now.summary.ordered - then.summary.ordered,
  };
}

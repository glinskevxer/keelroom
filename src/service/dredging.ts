/**
 * Which reach is costing the port the most water, and what deepening it would
 * buy.
 *
 * The dredging budget is argued about every year and the argument is usually
 * about which reach is shallowest. That is the wrong question: the reach that
 * matters is the one that closes the most windows for the ships that actually
 * come, which is not the same thing once the tide curve and the ships' draughts
 * are in it. This works that out by running the sweep again with one reach
 * deepened and measuring what the district gains.
 */

import type { Cm } from '../util/units';
import type { Interval } from '../util/interval';
import { totalMinutes } from '../util/interval';
import type { Reach } from '../domain/chart/reach';
import { buildPassage } from '../domain/chart/passage';
import { reachesToBerth, requireBerth } from '../domain/chart/district';
import { sweep } from '../domain/window/sweep';
import type { TransitPlan } from '../domain/window/sweep';
import { pilotageUnits } from '../domain/vessel/vessel';
import type { Vessel } from '../domain/vessel/vessel';
import { requireVessel } from '../storage/fleet-store';
import { movementsInWindow } from '../storage/movement-store';
import type { Context } from './context';
import { directionFor, FAIR_WEATHER } from './planning';

export interface ReachCost {
  readonly reach: string;
  /** Minutes of window the reach takes away across the movements looked at. */
  readonly minutesLost: number;
  /** Movements that had no window at all because of this reach. */
  readonly movementsBlocked: number;
  /** Minutes the district would gain from the deepening asked about. */
  readonly minutesGained: number;
}

export interface DredgingStudy {
  readonly period: Interval;
  readonly deepenBy: Cm;
  readonly movements: number;
  readonly reaches: readonly ReachCost[];
}

interface Candidate {
  readonly reference: string;
  readonly vessel: Vessel;
  readonly draught: Cm;
  readonly berth: string;
  readonly direction: 'inbound' | 'outbound';
}

function candidates(context: Context, period: Interval): Candidate[] {
  return movementsInWindow(context.db, period.from, period.to)
    .filter((movement) => movement.status !== 'cancelled' && movement.status !== 'refused')
    .map((movement) => {
      const berth = directionFor(movement) === 'inbound' ? movement.to : movement.from;
      return {
        reference: movement.reference,
        vessel: requireVessel(context.db, movement.vessel),
        draught: movement.draught,
        berth,
        direction: directionFor(movement),
      };
    })
    .filter((candidate) => candidate.berth !== 'SEA');
}

function windowsFor(
  context: Context,
  candidate: Candidate,
  period: Interval,
  deepen: { reach: string; by: Cm } | undefined,
): { minutes: number; blockedBy: string[] } {
  const berth = requireBerth(context.district, candidate.berth);
  const reaches: Reach[] = reachesToBerth(context.district, berth).map((reach) =>
    deepen !== undefined && reach.id === deepen.reach
      ? { ...reach, chartedDepth: reach.chartedDepth + deepen.by }
      : reach,
  );
  const plan: TransitPlan = {
    district: context.district,
    passage: buildPassage(reaches, candidate.direction, {
      speed: context.config.transitSpeed,
      startDelay: 20,
      endDelay: 30,
    }),
    vessel: candidate.vessel,
    draught: candidate.draught,
    policy: context.config.clearance,
    conditions: FAIR_WEATHER.transit,
  };
  const result = sweep(plan, period);
  return {
    minutes: totalMinutes(result.windows),
    blockedBy: result.reaches
      .filter((reach) => reach.starts.length === 0)
      .map((reach) => reach.reach),
  };
}

/**
 * Run the movements in a period against the district as it is, then again with
 * each reach deepened, and report the difference.
 */
export function studyDredging(
  context: Context,
  period: Interval,
  deepenBy: Cm = 30,
): DredgingStudy {
  const fleet = candidates(context, period);
  const costs = new Map<string, ReachCost>();
  for (const reach of context.district.reaches) {
    costs.set(reach.id, {
      reach: reach.id,
      minutesLost: 0,
      movementsBlocked: 0,
      minutesGained: 0,
    });
  }
  for (const candidate of fleet) {
    const base = windowsFor(context, candidate, period, undefined);
    for (const blocked of base.blockedBy) {
      const current = costs.get(blocked);
      if (current !== undefined) {
        costs.set(blocked, {
          ...current,
          movementsBlocked: current.movementsBlocked + 1,
        });
      }
    }
    for (const reach of context.district.reaches) {
      const current = costs.get(reach.id);
      if (current === undefined) {
        continue;
      }
      const deeper = windowsFor(context, candidate, period, { reach: reach.id, by: deepenBy });
      const gained = Math.max(0, deeper.minutes - base.minutes);
      costs.set(reach.id, {
        ...current,
        minutesGained: current.minutesGained + gained,
        minutesLost: current.minutesLost + (gained > 0 ? gained : 0),
      });
    }
  }
  return {
    period,
    deepenBy,
    movements: fleet.length,
    reaches: [...costs.values()].sort(
      (a, b) =>
        b.minutesGained - a.minutesGained ||
        b.movementsBlocked - a.movementsBlocked ||
        a.reach.localeCompare(b.reach),
    ),
  };
}

/** The reach that would buy the most window for the money. */
export function worstReach(study: DredgingStudy): ReachCost | undefined {
  return study.reaches[0];
}

/** Deep ships are what a dredging case is made of, so they are counted apart. */
export function deepMovements(context: Context, period: Interval, over: Cm): string[] {
  return candidates(context, period)
    .filter((candidate) => candidate.draught >= over)
    .map((candidate) => `${candidate.reference} (${pilotageUnits(candidate.vessel)} units)`);
}

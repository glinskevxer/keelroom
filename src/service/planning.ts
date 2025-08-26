/**
 * Planning a movement that has already been ordered.
 *
 * This is the join between the stored record and the rules: it builds the
 * passage the ship will actually run from the district's reaches, hands it to
 * the sweep with the conditions of the day, and turns the answer back into
 * something the despatcher can confirm against.
 *
 * A confirmed movement carries a planned time inside a window that was open when
 * it was planned. Nothing re-checks it afterwards, so a movement replanned after
 * the survey changes is a movement replanned by hand, and the daily report is
 * what tells the despatcher to do it.
 */

import { InputError } from '../util/errors';
import type { Minute } from '../util/clock';
import type { Interval } from '../util/interval';
import { makeInterval } from '../util/interval';
import type { Cm } from '../util/units';
import { reachesToBerth, requireBerth } from '../domain/chart/district';
import type { Direction, Passage } from '../domain/chart/passage';
import { buildPassage } from '../domain/chart/passage';
import type { Movement } from '../domain/movement/movement';
import { apply, replan } from '../domain/movement/lifecycle';
import type { TransitConditions } from '../domain/ukc/assessment';
import type { PlanResult } from '../domain/window/plan';
import { bestWindow, planTransit } from '../domain/window/plan';
import type { MovementConditions } from '../domain/window/restriction';
import type { TransitPlan } from '../domain/window/sweep';
import { requireVessel } from '../storage/fleet-store';
import { requireMovement, saveMovement } from '../storage/movement-store';
import type { Context } from './context';

export interface Conditions {
  readonly transit: TransitConditions;
  readonly movement: MovementConditions;
}

export const FAIR_WEATHER: Conditions = {
  transit: { density: 1025, waveHeight: 40, speed: 80 },
  movement: { wind: 10, visibility: 8000 },
};

export interface PlanRequest {
  readonly reference: string;
  /** The range of start times to look in. */
  readonly bounds?: Interval;
  readonly conditions?: Conditions;
  /** Look this many hours either side of the time the agent asked for. */
  readonly searchHours?: number;
}

export interface MovementPlan {
  readonly movement: Movement;
  readonly passage: Passage;
  readonly result: PlanResult;
}

export function directionFor(movement: Movement): Direction {
  return movement.kind === 'arrival' || movement.kind === 'anchorage' ? 'inbound' : 'outbound';
}

/** The berth that decides how far up the district the passage runs. */
function berthEnd(movement: Movement): string {
  return directionFor(movement) === 'inbound' ? movement.to : movement.from;
}

export function passageFor(
  context: Context,
  movement: Movement,
  speed = context.config.transitSpeed,
): Passage {
  const end = berthEnd(movement);
  if (end === 'SEA') {
    throw new InputError(`movement ${movement.reference} runs between the sea and the sea`);
  }
  const berth = requireBerth(context.district, end);
  const reaches = reachesToBerth(context.district, berth);
  return buildPassage(reaches, directionFor(movement), {
    speed,
    startDelay: 20,
    endDelay: 30,
  });
}

export function planMovement(context: Context, request: PlanRequest): MovementPlan {
  const movement = requireMovement(context.db, request.reference);
  const vessel = requireVessel(context.db, movement.vessel);
  const conditions = request.conditions ?? FAIR_WEATHER;
  const passage = passageFor(context, movement);
  const bounds = request.bounds ?? windowAround(movement.requestedFor, request.searchHours ?? 12);
  const plan: TransitPlan = {
    district: context.district,
    passage,
    vessel,
    draught: movement.draught,
    policy: context.config.clearance,
    conditions: { ...conditions.transit, speed: context.config.transitSpeed },
  };
  const result = planTransit({
    plan,
    bounds,
    movement: conditions.movement,
    position: context.position,
    rules: context.config.restrictions,
    twilight: context.config.twilightMinutes,
  });
  return { movement, passage, result };
}

export function windowAround(at: Minute, hours: number): Interval {
  if (hours <= 0) {
    throw new InputError('the search window has to be some hours wide');
  }
  return makeInterval(at - hours * 60, at + hours * 60);
}

export interface ConfirmRequest extends PlanRequest {
  /** Start at this minute rather than at the best of the windows. */
  readonly startAt?: Minute;
}

export interface Confirmation {
  readonly movement: Movement;
  readonly plan: MovementPlan;
  readonly startAt: Minute;
}

/** Confirm a movement against a window the sweep actually offered. */
export function confirmMovement(context: Context, request: ConfirmRequest): Confirmation {
  const plan = planMovement(context, request);
  if (plan.result.windows.length === 0) {
    throw new InputError(`movement ${request.reference} has no window to confirm against`, {
      findings: plan.result.findings.length,
    });
  }
  const startAt = request.startAt ?? pickStart(plan, plan.movement.requestedFor);
  const inside = plan.result.windows.some(
    (window) => startAt >= window.from && startAt <= window.to,
  );
  if (!inside) {
    throw new InputError('that start time is not inside any window the sweep offered', {
      startAt,
    });
  }
  const confirmed =
    plan.movement.status === 'ordered'
      ? apply(plan.movement, { to: 'confirmed', plannedFor: startAt })
      : replan(plan.movement, startAt);
  saveMovement(context.db, confirmed);
  return { movement: confirmed, plan, startAt };
}

/** The start the despatcher would pick: nearest to what the agent asked for. */
export function pickStart(plan: MovementPlan, wanted: Minute): Minute {
  const windows = plan.result.windows;
  const best = bestWindow(plan.result);
  if (best === undefined) {
    throw new InputError('there is no window to pick a start from');
  }
  let closest = best.from;
  let distance = Number.POSITIVE_INFINITY;
  for (const window of windows) {
    const candidate = Math.min(Math.max(wanted, window.from), window.to);
    const gap = Math.abs(candidate - wanted);
    if (gap < distance) {
      distance = gap;
      closest = candidate;
    }
  }
  return closest;
}

/** How far the offered start is from what the agent asked for, in minutes. */
export function displacement(confirmation: Confirmation): number {
  return confirmation.startAt - confirmation.movement.requestedFor;
}

export function deepestDraughtOffered(plan: MovementPlan): Cm {
  return plan.movement.draught;
}

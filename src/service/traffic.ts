/**
 * The day's traffic, built from the movements that have a planned time.
 *
 * The occupancy comes from each movement's own passage, so a movement planned at
 * a capped speed takes longer in the reach and shows as being in it for longer.
 * That is the whole reason this is a service rather than a query: it needs the
 * planner to lay a movement out, not just the record.
 */

import type { Minute } from '../util/clock';
import { MINUTES_PER_DAY } from '../util/clock';
import type { Interval } from '../util/interval';
import { makeInterval } from '../util/interval';
import { pilotageUnits } from '../domain/vessel/vessel';
import type { Conflict, Occupancy, TrafficRules } from '../domain/traffic/occupancy';
import {
  conflicts,
  occupancyOf,
  STANDARD_TRAFFIC,
  wouldConflict,
} from '../domain/traffic/occupancy';
import { requireVessel } from '../storage/fleet-store';
import { movementsInWindow, requireMovement } from '../storage/movement-store';
import type { Context } from './context';
import { passageFor } from './planning';

export interface TrafficDay {
  readonly period: Interval;
  readonly occupancies: readonly Occupancy[];
  readonly conflicts: readonly Conflict[];
  readonly movements: readonly string[];
}

function rulesFor(context: Context): TrafficRules {
  return {
    oneWayUnits: context.config.restrictions.oneWayUnits,
    crowdedAt: STANDARD_TRAFFIC.crowdedAt,
  };
}

/** Every movement with a planned time inside the period, laid out reach by reach. */
export function trafficFor(context: Context, period: Interval): TrafficDay {
  const movements = movementsInWindow(context.db, period.from, period.to).filter(
    (movement) => movement.plannedFor !== undefined && movement.status !== 'cancelled',
  );
  const occupancies = movements.flatMap((movement) => {
    const vessel = requireVessel(context.db, movement.vessel);
    return occupancyOf({
      movement: movement.reference,
      passage: passageFor(context, movement),
      startAt: movement.plannedFor ?? movement.requestedFor,
      units: pilotageUnits(vessel),
    });
  });
  return {
    period,
    occupancies,
    conflicts: conflicts(occupancies, rulesFor(context)),
    movements: movements.map((movement) => movement.reference),
  };
}

export function trafficDay(context: Context, from: Minute, days = 1): TrafficDay {
  return trafficFor(context, makeInterval(from, from + days * MINUTES_PER_DAY));
}

/** What one movement would run into if it were confirmed for a start time. */
export function checkAgainstTraffic(
  context: Context,
  reference: string,
  startAt: Minute,
): Conflict[] {
  const movement = requireMovement(context.db, reference);
  const vessel = requireVessel(context.db, movement.vessel);
  const period = makeInterval(startAt - MINUTES_PER_DAY, startAt + MINUTES_PER_DAY);
  const day = trafficFor(context, period);
  const existing = day.occupancies.filter((occupancy) => occupancy.movement !== reference);
  const candidate = occupancyOf({
    movement: reference,
    passage: passageFor(context, movement),
    startAt,
    units: pilotageUnits(vessel),
  });
  return wouldConflict(existing, candidate, rulesFor(context));
}

/**
 * The first start at or after a moment that runs into nothing, searched in
 * whole minutes of the step given.
 */
export function firstClearStart(
  context: Context,
  reference: string,
  from: Minute,
  options: { step?: number; tries?: number } = {},
): Minute | undefined {
  const step = options.step ?? 15;
  const tries = options.tries ?? 24;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const candidate = from + attempt * step;
    if (checkAgainstTraffic(context, reference, candidate).length === 0) {
      return candidate;
    }
  }
  return undefined;
}

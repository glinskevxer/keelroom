/**
 * Raising the tugs a movement needs.
 *
 * The count comes from the standing orders, the pull from the ship's size, and
 * what is actually free comes from the bookings other movements already hold.
 * Booking is a replace rather than an add, so replanning a movement onto another
 * tide releases the tugs it held on the first one.
 */

import { InputError } from '../util/errors';
import type { Interval } from '../util/interval';
import type { Allocation, TugDemand } from '../domain/tug/tug';
import { allocateTugs } from '../domain/tug/tug';
import { displacement, pilotageUnits } from '../domain/vessel/vessel';
import { tugsRequired } from '../domain/window/restriction';
import type { MovementConditions } from '../domain/window/restriction';
import { requireVessel } from '../storage/fleet-store';
import { requireMovement } from '../storage/movement-store';
import { saveMovement } from '../storage/movement-store';
import {
  allTugs,
  bookTugs,
  bookingsForMovement,
  bookingsInPeriod,
  releaseTugs,
} from '../storage/tug-store';
import type { Context } from './context';
import { jobPeriod } from './dispatch';

/** Bollard pull the district wants for a ship, from her displacement. */
export function pullFor(displacementTonnes: number): number {
  return Math.max(10, Math.round(displacementTonnes / 1000));
}

export function demandFor(
  context: Context,
  reference: string,
  conditions: MovementConditions = { wind: 10, visibility: 8000 },
): TugDemand & { period: Interval } {
  const movement = requireMovement(context.db, reference);
  const vessel = requireVessel(context.db, movement.vessel);
  const period = jobPeriod(context, movement);
  return {
    count: tugsRequired(context.config.restrictions, vessel, conditions),
    pull: pullFor(displacement(vessel, movement.draught)),
    escort: pilotageUnits(vessel) >= context.config.restrictions.oneWayUnits,
    period,
  };
}

export interface TowageResult extends Allocation {
  readonly reference: string;
  readonly demand: TugDemand;
}

/** What could be raised, without booking anything. */
export function offerTugs(
  context: Context,
  reference: string,
  conditions?: MovementConditions,
): TowageResult {
  const demand = demandFor(context, reference, conditions);
  const held = bookingsInPeriod(context.db, demand.period).filter(
    (booking) => booking.movement !== reference,
  );
  const allocation = allocateTugs(allTugs(context.db), held, demand);
  return { ...allocation, reference, demand };
}

/** Take them, and write the count onto the movement. */
export function bookForMovement(
  context: Context,
  reference: string,
  conditions?: MovementConditions,
): TowageResult {
  const offer = offerTugs(context, reference, conditions);
  if (!offer.met) {
    throw new InputError(
      `the tugs for ${reference} cannot be raised: ${offer.reason ?? 'unknown'}`,
    );
  }
  bookTugs(
    context.db,
    reference,
    offer.tugs.map((tug) => ({ tug: tug.id, movement: reference, period: offer.demand.period })),
  );
  const movement = requireMovement(context.db, reference);
  saveMovement(context.db, { ...movement, tugs: offer.tugs.length });
  return offer;
}

export function releaseForMovement(context: Context, reference: string): number {
  const released = releaseTugs(context.db, reference);
  const movement = requireMovement(context.db, reference);
  saveMovement(context.db, { ...movement, tugs: 0 });
  return released;
}

export function heldBy(context: Context, reference: string): string[] {
  return bookingsForMovement(context.db, reference).map((booking) => booking.tug);
}

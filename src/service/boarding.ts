/**
 * Booking the launch for a movement.
 */

import { InputError } from '../util/errors';
import { MINUTES_PER_DAY } from '../util/clock';
import { makeInterval } from '../util/interval';
import type { BoardingOffer, Trip } from '../domain/boat/boarding';
import { planBoarding } from '../domain/boat/boarding';
import { isDaylight } from '../domain/window/daylight';
import { requireMovement } from '../storage/movement-store';
import {
  allBoats,
  allGrounds,
  cancelTrips,
  requireBoat,
  requireGround,
  saveTrip,
  tripsInPeriod,
} from '../storage/boarding-store';
import type { Context } from './context';
import { conditionsFromLog } from './planning';

export interface BoardingRequest {
  readonly movement: string;
  readonly ground?: string;
  readonly boat?: string;
  /** When the pilot has to be aboard, which defaults to the planned time. */
  readonly boards?: number;
}

/** What the launch could do, without booking anything. */
export function offerBoarding(context: Context, request: BoardingRequest): BoardingOffer {
  const movement = requireMovement(context.db, request.movement);
  const boards = request.boards ?? movement.plannedFor;
  if (boards === undefined) {
    throw new InputError(`movement ${request.movement} has no planned time to board against`);
  }
  const pilot = movement.pilot;
  if (pilot === undefined) {
    throw new InputError(`movement ${request.movement} has no pilot to take out`);
  }
  const grounds =
    request.ground === undefined
      ? allGrounds(context.db)
      : [requireGround(context.db, request.ground)];
  if (grounds.length === 0) {
    throw new InputError('the district has no boarding grounds');
  }
  const boats =
    request.boat === undefined ? allBoats(context.db) : [requireBoat(context.db, request.boat)];
  if (boats.length === 0) {
    throw new InputError('the district has no pilot boats');
  }
  const swell = conditionsFromLog(context, boards).conditions.transit.waveHeight;
  const night = !isDaylight(context.position, boards, context.district.offset);
  const booked = tripsInPeriod(
    context.db,
    makeInterval(boards - MINUTES_PER_DAY, boards + MINUTES_PER_DAY),
  ).filter((trip) => trip.movement !== request.movement);
  let last: BoardingOffer = {
    trip: undefined,
    refusal: undefined,
    detail: 'nothing was tried',
  };
  for (const ground of grounds) {
    for (const boat of boats) {
      last = planBoarding({
        movement: request.movement,
        pilot,
        boat,
        ground,
        boards,
        swell,
        night,
        booked,
      });
      if (last.trip !== undefined) {
        return last;
      }
    }
  }
  return last;
}

/** Take it, which replaces whatever was booked for the movement before. */
export function bookBoarding(context: Context, request: BoardingRequest): Trip {
  const offer = offerBoarding(context, request);
  if (offer.trip === undefined) {
    throw new InputError(`the launch cannot take her: ${offer.detail}`, {
      refusal: offer.refusal ?? 'unknown',
    });
  }
  cancelTrips(context.db, request.movement);
  saveTrip(context.db, offer.trip);
  return offer.trip;
}

export function releaseBoarding(context: Context, movement: string): number {
  return cancelTrips(context.db, movement);
}

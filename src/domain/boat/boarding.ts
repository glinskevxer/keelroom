/**
 * Getting the pilot to the ship.
 *
 * The plan says when she wants a pilot at the sea buoy. Somebody still has to
 * take him there, and the launch has a passage of its own, a sea state it will
 * not work in, and a berth it has to be back at. On a rough day the binding
 * constraint on a movement is not the tide at all, it is whether the boat can
 * put a man on board.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import type { Interval } from '../../util/interval';
import { makeInterval, overlaps } from '../../util/interval';
import type { Cm } from '../../util/units';
import { assertCm } from '../../util/units';

export interface BoardingGround {
  readonly id: string;
  readonly name: string;
  /** Minutes the launch takes from the station to the ground. */
  readonly passageMinutes: number;
  /** Most swell the district will board in here. */
  readonly swellLimit: Cm;
  /** Whether it is sheltered enough to use at night. */
  readonly nightBoarding: boolean;
}

export interface PilotBoat {
  readonly id: string;
  readonly name: string;
  /** Most swell she will work in, whatever the ground allows. */
  readonly swellLimit: Cm;
  /** How many pilots she carries in one trip. */
  readonly berths: number;
  readonly active: boolean;
}

const GROUND_ID = /^[A-Z][A-Z0-9-]{1,15}$/;
const BOAT_ID = /^B[0-9]{1,3}$/;

export function makeGround(input: {
  id: string;
  name: string;
  passageMinutes: number;
  swellLimit: number;
  nightBoarding?: boolean;
}): BoardingGround {
  if (!GROUND_ID.test(input.id)) {
    throw new InputError(`boarding ground id must be upper case, got ${JSON.stringify(input.id)}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`boarding ground ${input.id} has no name`);
  }
  if (!Number.isInteger(input.passageMinutes) || input.passageMinutes <= 0) {
    throw new InputError(`boarding ground ${input.id} is no distance from the station`);
  }
  const swellLimit = assertCm(input.swellLimit, 'swell limit');
  if (swellLimit <= 0) {
    throw new InputError(`boarding ground ${input.id} would never be workable`);
  }
  return {
    id: input.id,
    name: input.name.trim(),
    passageMinutes: input.passageMinutes,
    swellLimit,
    nightBoarding: input.nightBoarding ?? true,
  };
}

export function makeBoat(input: {
  id: string;
  name: string;
  swellLimit: number;
  berths?: number;
  active?: boolean;
}): PilotBoat {
  if (!BOAT_ID.test(input.id)) {
    throw new InputError(`pilot boat id must look like B1, got ${JSON.stringify(input.id)}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`pilot boat ${input.id} has no name`);
  }
  const swellLimit = assertCm(input.swellLimit, 'swell limit');
  if (swellLimit <= 0) {
    throw new InputError(`pilot boat ${input.id} would never go out`);
  }
  const berths = input.berths ?? 2;
  if (!Number.isInteger(berths) || berths <= 0) {
    throw new InputError(`pilot boat ${input.id} carries nobody`);
  }
  return {
    id: input.id,
    name: input.name.trim(),
    swellLimit,
    berths,
    active: input.active ?? true,
  };
}

export interface Trip {
  readonly boat: string;
  readonly ground: string;
  readonly movement: string;
  readonly pilot: string;
  /** When the launch leaves the station. */
  readonly departs: Minute;
  /** When the pilot steps aboard. */
  readonly boards: Minute;
  readonly returns: Minute;
}

export function tripPeriod(trip: Trip): Interval {
  return makeInterval(trip.departs, trip.returns);
}

export interface BoardingRequest {
  readonly movement: string;
  readonly pilot: string;
  readonly boat: PilotBoat;
  readonly ground: BoardingGround;
  /** When the pilot has to be on board. */
  readonly boards: Minute;
  readonly swell: Cm;
  readonly night: boolean;
  readonly booked: readonly Trip[];
}

export type BoardingRefusal = 'swell' | 'night' | 'boat-busy' | 'boat-laid-up';

export interface BoardingOffer {
  readonly trip: Trip | undefined;
  readonly refusal: BoardingRefusal | undefined;
  readonly detail: string;
}

/** Work the launch backwards from the moment the pilot has to be aboard. */
export function planBoarding(request: BoardingRequest): BoardingOffer {
  if (!request.boat.active) {
    return { trip: undefined, refusal: 'boat-laid-up', detail: `${request.boat.id} is laid up` };
  }
  const limit = Math.min(request.boat.swellLimit, request.ground.swellLimit);
  if (request.swell > limit) {
    return {
      trip: undefined,
      refusal: 'swell',
      detail: `${request.swell} cm of swell against a limit of ${limit} cm`,
    };
  }
  if (request.night && !request.ground.nightBoarding) {
    return {
      trip: undefined,
      refusal: 'night',
      detail: `${request.ground.id} is not a night boarding ground`,
    };
  }
  const trip: Trip = {
    boat: request.boat.id,
    ground: request.ground.id,
    movement: request.movement,
    pilot: request.pilot,
    departs: request.boards - request.ground.passageMinutes,
    boards: request.boards,
    returns: request.boards + request.ground.passageMinutes,
  };
  const clash = request.booked.find(
    (booked) => booked.boat === request.boat.id && overlaps(tripPeriod(booked), tripPeriod(trip)),
  );
  if (clash !== undefined) {
    return {
      trip: undefined,
      refusal: 'boat-busy',
      detail: `${request.boat.id} is out to ${clash.movement}`,
    };
  }
  return { trip, refusal: undefined, detail: 'the launch can make it' };
}

/** Trips that could be run together: same ground, close in time, room aboard. */
export function couldShare(first: Trip, second: Trip, boat: PilotBoat, within = 20): boolean {
  return (
    first.boat === second.boat &&
    first.ground === second.ground &&
    Math.abs(first.boards - second.boards) <= within &&
    boat.berths > 1
  );
}

export function tripsFor(trips: readonly Trip[], boat: string): Trip[] {
  return trips.filter((trip) => trip.boat === boat).sort((a, b) => a.departs - b.departs);
}

export function describeGround(ground: BoardingGround): string {
  const night = ground.nightBoarding ? '' : ', daylight only';
  return `${ground.id} ${ground.name}, ${ground.passageMinutes} min out, ${ground.swellLimit} cm limit${night}`;
}

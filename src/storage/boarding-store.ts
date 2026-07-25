/**
 * The grounds, the launches and the trips.
 */

import type { Interval } from '../util/interval';
import type { Db } from './database';
import { requiring } from './lookup';
import type { BoardingGround, PilotBoat, Trip } from '../domain/boat/boarding';
import { makeBoat, makeGround } from '../domain/boat/boarding';

interface GroundRow {
  id: string;
  name: string;
  passage_minutes: number;
  swell_limit_cm: number;
  night_boarding: number;
}

interface BoatRow {
  id: string;
  name: string;
  swell_limit_cm: number;
  berths: number;
  active: number;
}

interface TripRow {
  movement: string;
  boat: string;
  ground: string;
  pilot: string;
  departs: number;
  boards: number;
  returns_at: number;
}

export function saveGround(db: Db, ground: BoardingGround): void {
  db.prepare(
    `insert into boarding_ground (id, name, passage_minutes, swell_limit_cm, night_boarding)
     values (?, ?, ?, ?, ?)
     on conflict(id) do update set
       name = excluded.name,
       passage_minutes = excluded.passage_minutes,
       swell_limit_cm = excluded.swell_limit_cm,
       night_boarding = excluded.night_boarding`,
  ).run(
    ground.id,
    ground.name,
    ground.passageMinutes,
    ground.swellLimit,
    ground.nightBoarding ? 1 : 0,
  );
}

export function allGrounds(db: Db): BoardingGround[] {
  const rows = db.prepare('select * from boarding_ground order by id').all() as GroundRow[];
  return rows.map((row) =>
    makeGround({
      id: row.id,
      name: row.name,
      passageMinutes: row.passage_minutes,
      swellLimit: row.swell_limit_cm,
      nightBoarding: row.night_boarding === 1,
    }),
  );
}

export const requireGround = requiring(
  (db: Db, id: string) => allGrounds(db).find((ground) => ground.id === id),
  'boarding ground',
  (_db, id) => id,
);

export function saveBoat(db: Db, boat: PilotBoat): void {
  db.prepare(
    `insert into pilot_boat (id, name, swell_limit_cm, berths, active) values (?, ?, ?, ?, ?)
     on conflict(id) do update set
       name = excluded.name,
       swell_limit_cm = excluded.swell_limit_cm,
       berths = excluded.berths,
       active = excluded.active`,
  ).run(boat.id, boat.name, boat.swellLimit, boat.berths, boat.active ? 1 : 0);
}

export function allBoats(db: Db): PilotBoat[] {
  const rows = db.prepare('select * from pilot_boat order by id').all() as BoatRow[];
  return rows.map((row) =>
    makeBoat({
      id: row.id,
      name: row.name,
      swellLimit: row.swell_limit_cm,
      berths: row.berths,
      active: row.active === 1,
    }),
  );
}

export const requireBoat = requiring(
  (db: Db, id: string) => allBoats(db).find((boat) => boat.id === id),
  'pilot boat',
  (_db, id) => id,
);

function toTrip(row: TripRow): Trip {
  return {
    movement: row.movement,
    boat: row.boat,
    ground: row.ground,
    pilot: row.pilot,
    departs: row.departs,
    boards: row.boards,
    returns: row.returns_at,
  };
}

export function saveTrip(db: Db, trip: Trip): void {
  db.prepare(
    `insert into boat_trip (movement, boat, ground, pilot, departs, boards, returns_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(movement, boat) do update set
       ground = excluded.ground,
       pilot = excluded.pilot,
       departs = excluded.departs,
       boards = excluded.boards,
       returns_at = excluded.returns_at`,
  ).run(trip.movement, trip.boat, trip.ground, trip.pilot, trip.departs, trip.boards, trip.returns);
}

export function tripsInPeriod(db: Db, period: Interval): Trip[] {
  const rows = db
    .prepare('select * from boat_trip where departs <= ? and returns_at >= ? order by departs')
    .all(period.to, period.from) as TripRow[];
  return rows.map(toTrip);
}

export function tripsForMovement(db: Db, movement: string): Trip[] {
  const rows = db
    .prepare('select * from boat_trip where movement = ? order by departs')
    .all(movement) as TripRow[];
  return rows.map(toTrip);
}

export function cancelTrips(db: Db, movement: string): number {
  return db.prepare('delete from boat_trip where movement = ?').run(movement).changes;
}

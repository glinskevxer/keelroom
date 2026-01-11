/**
 * The tug list and the bookings against it.
 */

import { NotFoundError } from '../util/errors';
import type { Interval } from '../util/interval';
import { makeInterval } from '../util/interval';
import type { Db } from './database';
import { inTransaction } from './database';
import type { Tug, TugBooking } from '../domain/tug/tug';
import { makeTug } from '../domain/tug/tug';

interface TugRow {
  id: string;
  name: string;
  owner: string;
  pull_t: number;
  escort: number;
  active: number;
}

interface BookingRow {
  tug: string;
  movement: string;
  from_at: number;
  to_at: number;
}

function toTug(row: TugRow): Tug {
  return makeTug({
    id: row.id,
    name: row.name,
    owner: row.owner,
    pull: row.pull_t,
    escort: row.escort === 1,
    active: row.active === 1,
  });
}

export function saveTug(db: Db, tug: Tug): void {
  db.prepare(
    `insert into tug (id, name, owner, pull_t, escort, active) values (?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       name = excluded.name,
       owner = excluded.owner,
       pull_t = excluded.pull_t,
       escort = excluded.escort,
       active = excluded.active`,
  ).run(tug.id, tug.name, tug.owner, tug.pull, tug.escort ? 1 : 0, tug.active ? 1 : 0);
}

export function allTugs(db: Db): Tug[] {
  const rows = db.prepare('select * from tug order by id').all() as TugRow[];
  return rows.map(toTug);
}

export function findTug(db: Db, id: string): Tug | undefined {
  const row = db.prepare('select * from tug where id = ?').get(id) as TugRow | undefined;
  return row === undefined ? undefined : toTug(row);
}

export function requireTug(db: Db, id: string): Tug {
  const tug = findTug(db, id);
  if (tug === undefined) {
    throw new NotFoundError('tug', id);
  }
  return tug;
}

export function bookingsInPeriod(db: Db, period: Interval): TugBooking[] {
  const rows = db
    .prepare('select * from tug_booking where from_at <= ? and to_at >= ? order by from_at, tug')
    .all(period.to, period.from) as BookingRow[];
  return rows.map((row) => ({
    tug: row.tug,
    movement: row.movement,
    period: makeInterval(row.from_at, row.to_at),
  }));
}

export function bookingsForMovement(db: Db, movement: string): TugBooking[] {
  const rows = db
    .prepare('select * from tug_booking where movement = ? order by tug')
    .all(movement) as BookingRow[];
  return rows.map((row) => ({
    tug: row.tug,
    movement: row.movement,
    period: makeInterval(row.from_at, row.to_at),
  }));
}

/** Replace the bookings for one movement, which is what a replan does. */
export function bookTugs(db: Db, movement: string, bookings: readonly TugBooking[]): void {
  inTransaction(db, (inner) => {
    inner.prepare('delete from tug_booking where movement = ?').run(movement);
    const insert = inner.prepare(
      'insert into tug_booking (tug, movement, from_at, to_at) values (?, ?, ?, ?)',
    );
    for (const booking of bookings) {
      insert.run(booking.tug, movement, booking.period.from, booking.period.to);
    }
  });
}

export function releaseTugs(db: Db, movement: string): number {
  return db.prepare('delete from tug_booking where movement = ?').run(movement).changes;
}

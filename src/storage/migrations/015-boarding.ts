import type { Db } from '../database';

/** The boarding grounds, the launches, and the trips they run. */
export function up(db: Db): void {
  db.exec(`
    create table boarding_ground (
      id              text primary key,
      name            text not null,
      passage_minutes integer not null,
      swell_limit_cm  integer not null,
      night_boarding  integer not null default 1 check (night_boarding in (0, 1))
    );

    create table pilot_boat (
      id              text primary key,
      name            text not null,
      swell_limit_cm  integer not null,
      berths          integer not null default 2,
      active          integer not null default 1 check (active in (0, 1))
    );

    create table boat_trip (
      movement  text not null references movement(reference),
      boat      text not null references pilot_boat(id),
      ground    text not null references boarding_ground(id),
      pilot     text not null,
      departs   integer not null,
      boards    integer not null,
      returns_at integer not null,
      primary key (movement, boat)
    );

    create index trip_by_boat on boat_trip (boat, departs);
  `);
}

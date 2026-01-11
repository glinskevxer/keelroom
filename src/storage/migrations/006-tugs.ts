import type { Db } from '../database';

/** The tugs the towage companies lend, and who has them when. */
export function up(db: Db): void {
  db.exec(`
    create table tug (
      id      text primary key,
      name    text not null,
      owner   text not null,
      pull_t  integer not null,
      escort  integer not null default 0 check (escort in (0, 1)),
      active  integer not null default 1 check (active in (0, 1))
    );

    create table tug_booking (
      tug       text not null references tug(id),
      movement  text not null references movement(reference),
      from_at   integer not null,
      to_at     integer not null,
      primary key (tug, movement)
    );

    create index tug_booking_by_time on tug_booking (from_at, to_at);
  `);
}

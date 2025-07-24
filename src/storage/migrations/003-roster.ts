import type { Db } from '../database';

/** The pilots, what they are signed off for, and what they have worked. */
export function up(db: Db): void {
  db.exec(`
    create table pilot (
      id                text primary key,
      name              text not null,
      grade             text not null check (grade in ('apprentice', 'limited', 'unlimited')),
      seniority         integer not null,
      draught_limit_cm  integer not null,
      unit_limit        integer not null,
      active            integer not null default 1 check (active in (0, 1))
    );

    create unique index pilot_seniority on pilot (seniority);

    create table pilot_endorsement (
      pilot       text not null references pilot(id),
      endorsement text not null,
      granted_at  integer not null,
      primary key (pilot, endorsement)
    );

    create table duty_entry (
      pilot     text not null references pilot(id),
      movement  text not null,
      from_at   integer not null,
      to_at     integer not null,
      primary key (pilot, movement)
    );

    create index duty_by_time on duty_entry (pilot, to_at);

    create table pilot_leave (
      pilot   text not null references pilot(id),
      seq     integer not null,
      from_at integer not null,
      to_at   integer not null,
      reason  text,
      primary key (pilot, seq)
    );

    create table board_entry (
      pilot           text primary key references pilot(id),
      turn            integer not null,
      last_job_ended  integer,
      passes          integer not null default 0,
      jobs            integer not null default 0
    );
  `);
}

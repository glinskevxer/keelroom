import type { Db } from '../database';

/** The weather log, observed and forecast. */
export function up(db: Db): void {
  db.exec(`
    create table weather (
      at          integer not null,
      source      text not null check (source in ('observed', 'forecast')),
      wind_kn     integer not null,
      direction   integer not null default 0,
      visibility  integer not null,
      swell_cm    integer not null default 0,
      density     integer not null default 1025,
      primary key (at, source)
    );
  `);
}

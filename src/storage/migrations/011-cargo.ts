import type { Db } from '../database';

/** What each movement declared she was carrying. */
export function up(db: Db): void {
  db.exec(`
    create table movement_cargo (
      movement    text primary key references movement(reference),
      hazard      text not null,
      un_number   text,
      tonnes      integer not null default 0,
      in_ballast  integer not null default 0 check (in_ballast in (0, 1)),
      note        text
    );
  `);
}

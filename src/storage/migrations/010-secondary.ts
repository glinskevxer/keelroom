import type { Db } from '../database';

/** Secondary ports, as corrections to a standard one. */
export function up(db: Db): void {
  db.exec(`
    create table secondary_port (
      id                  text primary key,
      name                text not null,
      standard            text not null references tide_station(id),
      hw_offset           integer not null,
      lw_offset           integer not null,
      hw_factor           integer not null default 1000,
      lw_factor           integer not null default 1000,
      datum_shift_cm      integer not null default 0
    );

    create index secondary_by_standard on secondary_port (standard);
  `);
}

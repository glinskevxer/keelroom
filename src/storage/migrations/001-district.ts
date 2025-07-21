import type { Db } from '../database';

/** The district itself: gauges, channel, berths and what crosses over them. */
export function up(db: Db): void {
  db.exec(`
    create table district (
      code            text primary key,
      name            text not null,
      utc_offset      integer not null,
      latitude        real not null,
      longitude       real not null
    );

    create table tide_station (
      id              text primary key,
      name            text not null,
      mean_level_cm   integer not null,
      district        text not null references district(code)
    );

    create table tide_term (
      station         text not null references tide_station(id),
      constituent     text not null,
      amplitude_cm    integer not null,
      phase_degrees   real not null,
      primary key (station, constituent)
    );

    create table reach (
      id                  text primary key,
      name                text not null,
      district            text not null references district(code),
      seaward_order       integer not null,
      charted_depth_cm    integer not null,
      length_m            real not null,
      width_m             real not null,
      channel             text not null check (channel in ('open', 'restricted', 'canal')),
      station             text not null references tide_station(id),
      surveyed_at         integer not null,
      shoaling_cm_year    real not null default 0,
      survey_tolerance_cm integer not null default 10,
      speed_limit_tenths  integer not null
    );

    create unique index reach_order on reach (district, seaward_order);

    create table berth (
      id                    text primary key,
      name                  text not null,
      kind                  text not null check (kind in ('quay', 'anchorage', 'buoys', 'sea')),
      reach                 text not null references reach(id),
      depth_cm              integer not null,
      max_length_cm         integer not null,
      resting_clearance_cm  integer not null default 30,
      terminal              text not null default 'unassigned'
    );

    create table overhead (
      id            text primary key,
      name          text not null,
      kind          text not null check (kind in ('bridge', 'cable', 'pipeline')),
      reach         text not null references reach(id),
      clearance_cm  integer not null,
      station       text not null references tide_station(id),
      air_gap_cm    integer not null default 200
    );

    create index berth_by_reach on berth (reach);
    create index overhead_by_reach on overhead (reach);
  `);
}

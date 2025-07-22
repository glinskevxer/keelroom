import type { Db } from '../database';

/** The ships, the agents who order for them, and the movements themselves. */
export function up(db: Db): void {
  db.exec(`
    create table vessel (
      imo               text primary key,
      name              text not null,
      type              text not null check (
        type in ('bulk', 'container', 'tanker', 'gas', 'general', 'roro', 'passenger', 'other')
      ),
      length_cm         integer not null,
      beam_cm           integer not null,
      summer_draught_cm integer not null,
      air_draught_cm    integer not null,
      gross_tonnage     integer not null,
      deadweight        integer not null default 0,
      block_coefficient integer not null,
      bow_thruster      integer not null default 0 check (bow_thruster in (0, 1))
    );

    create index vessel_by_name on vessel (name);

    create table account (
      agent             text primary key,
      name              text not null,
      terms_days        integer not null default 30,
      discount_bps      integer not null default 0,
      credit_limit      integer not null default 0,
      stopped           integer not null default 0 check (stopped in (0, 1)),
      requires_deposit  integer not null default 0 check (requires_deposit in (0, 1))
    );

    create table movement (
      reference     text primary key,
      kind          text not null check (
        kind in ('arrival', 'departure', 'shift', 'anchorage', 'swing')
      ),
      status        text not null check (
        status in ('ordered', 'confirmed', 'assigned', 'boarded', 'underway', 'completed',
                   'cancelled', 'refused')
      ),
      vessel        text not null references vessel(imo),
      agent         text not null references account(agent),
      from_place    text not null,
      to_place      text not null,
      draught_cm    integer not null,
      ordered_at    integer not null,
      requested_for integer not null,
      planned_for   integer,
      pilot         text,
      tugs          integer not null default 0,
      tariff_book   text
    );

    create index movement_by_vessel on movement (vessel);
    create index movement_by_agent on movement (agent);
    create index movement_by_status on movement (status, requested_for);

    create table movement_note (
      movement  text not null references movement(reference),
      seq       integer not null,
      body      text not null,
      primary key (movement, seq)
    );

    create table movement_time (
      movement    text primary key references movement(reference),
      ordered_for integer not null,
      boarded     integer,
      let_go      integer,
      all_fast    integer
    );

    create table movement_delay (
      movement  text not null references movement(reference),
      seq       integer not null,
      cause     text not null check (
        cause in ('vessel', 'berth', 'tug', 'weather', 'district', 'traffic')
      ),
      from_at   integer not null,
      to_at     integer not null,
      note      text,
      primary key (movement, seq)
    );
  `);
}

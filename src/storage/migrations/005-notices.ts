import type { Db } from '../database';

/** Notices to mariners: what binds on a reach or a berth, and when. */
export function up(db: Db): void {
  db.exec(`
    create table notice (
      id        text primary key,
      kind      text not null check (
        kind in ('closure', 'draught-cap', 'daylight-only', 'speed-cap', 'no-overtaking',
                 'information')
      ),
      subject   text not null,
      from_at   integer not null,
      to_at     integer not null,
      body      text not null,
      value     integer,
      issued_at integer not null,
      withdrawn integer not null default 0 check (withdrawn in (0, 1))
    );

    create index notice_by_subject on notice (subject, from_at);
    create index notice_by_period on notice (from_at, to_at);
  `);
}

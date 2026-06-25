import type { Db } from '../database';

/** The people behind an agent code. */
export function up(db: Db): void {
  db.exec(`
    create table contact (
      agent         text not null references account(agent),
      name          text not null,
      role          text not null check (
        role in ('operations', 'accounts', 'master', 'emergency')
      ),
      email         text,
      telephone     text,
      takes_notices integer not null default 0 check (takes_notices in (0, 1)),
      primary key (agent, name, role)
    );

    create index contact_by_role on contact (role);
  `);
}

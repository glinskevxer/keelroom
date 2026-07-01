import type { Db } from '../database';

/** What an agent says is wrong with an invoice, and what came of it. */
export function up(db: Db): void {
  db.exec(`
    create table dispute (
      invoice     text not null references invoice(number),
      agent       text not null references account(agent),
      ground      text not null,
      amount      integer not null,
      raised_at   integer not null,
      note        text not null,
      outcome     text not null check (
        outcome in ('open', 'upheld', 'rejected', 'withdrawn')
      ),
      settled_at  integer,
      answer      text,
      primary key (invoice, raised_at)
    );

    create index dispute_by_agent on dispute (agent, outcome);
  `);
}

import type { Db } from '../database';

/** Money lodged before a movement, and what has been drawn against it. */
export function up(db: Db): void {
  db.exec(`
    create table deposit (
      reference   text primary key,
      agent       text not null references account(agent),
      amount      integer not null,
      lodged_at   integer not null,
      movement    text,
      note        text
    );

    create table deposit_draw (
      deposit   text not null references deposit(reference),
      movement  text not null,
      amount    integer not null,
      at        integer not null,
      primary key (deposit, movement)
    );

    create index deposit_by_agent on deposit (agent);
  `);
}

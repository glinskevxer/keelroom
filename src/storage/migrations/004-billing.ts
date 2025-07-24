import type { Db } from '../database';

/** The tariff books, the invoices raised on them, and the money against them. */
export function up(db: Db): void {
  db.exec(`
    create table tariff_book (
      id              text primary key,
      effective_from  integer not null,
      currency        text not null default 'USD',
      minimum_charge  integer not null,
      detention_block integer not null,
      boat_fee        integer not null default 0,
      admin_fee       integer not null default 0
    );

    create table tariff_band (
      book      text not null references tariff_book(id),
      up_to     integer not null,
      charge    integer not null,
      per_unit  integer not null,
      primary key (book, up_to)
    );

    create table tariff_multiplier (
      book        text not null references tariff_book(id),
      kind        text not null,
      multiplier  integer not null,
      primary key (book, kind)
    );

    create table invoice (
      number      text primary key,
      agent       text not null references account(agent),
      status      text not null check (
        status in ('draft', 'issued', 'paid', 'disputed', 'written-off')
      ),
      raised_at   integer not null,
      due_at      integer not null,
      currency    text not null default 'USD',
      tax_bps     integer not null default 0
    );

    create index invoice_by_agent on invoice (agent, status);

    create table invoice_line (
      invoice     text not null references invoice(number),
      seq         integer not null,
      movement    text not null,
      code        text not null,
      description text not null,
      amount      integer not null,
      primary key (invoice, seq)
    );

    create table credit_note (
      number    text primary key,
      invoice   text not null references invoice(number),
      agent     text not null references account(agent),
      reason    text not null,
      amount    integer not null,
      raised_at integer not null,
      note      text not null
    );

    create table payment (
      reference   text primary key,
      agent       text not null references account(agent),
      amount      integer not null,
      received_at integer not null
    );

    create table payment_allocation (
      payment text not null references payment(reference),
      invoice text not null references invoice(number),
      amount  integer not null,
      primary key (payment, invoice)
    );
  `);
}

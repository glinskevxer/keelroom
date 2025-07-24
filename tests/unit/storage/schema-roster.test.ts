import { afterEach, describe, expect, it } from 'vitest';
import { countRows, tableExists } from '../../../src/storage/database';
import { migrate } from '../../../src/storage/migrate';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

function ready(): TempDatabase {
  temp = temporaryDatabase();
  migrate(temp.db);
  temp.db
    .prepare(
      `insert into pilot (id, name, grade, seniority, draught_limit_cm, unit_limit)
       values (?, ?, 'unlimited', ?, 9999, 99999)`,
    )
    .run('P07', 'A Ferrier', 3);
  return temp;
}

describe('the roster tables', () => {
  it('are all there', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    for (const table of [
      'pilot',
      'pilot_endorsement',
      'duty_entry',
      'pilot_leave',
      'board_entry',
    ]) {
      expect(tableExists(temp.db, table)).toBe(true);
    }
  });

  it('refuse two pilots at the same seniority', () => {
    const one = ready();
    expect(() =>
      one.db
        .prepare(
          `insert into pilot (id, name, grade, seniority, draught_limit_cm, unit_limit)
           values ('P11', 'B Mate', 'limited', 3, 1100, 500)`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it('refuse a grade that is not a grade', () => {
    const one = ready();
    expect(() =>
      one.db
        .prepare(
          `insert into pilot (id, name, grade, seniority, draught_limit_cm, unit_limit)
           values ('P11', 'B Mate', 'master', 4, 1100, 500)`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('hang endorsements, leave and duty off a pilot', () => {
    const one = ready();
    one.db
      .prepare('insert into pilot_endorsement (pilot, endorsement, granted_at) values (?, ?, ?)')
      .run('P07', 'NIGHT', 1000);
    one.db
      .prepare('insert into duty_entry (pilot, movement, from_at, to_at) values (?, ?, ?, ?)')
      .run('P07', 'M-2025-0004', 1000, 1200);
    one.db
      .prepare('insert into pilot_leave (pilot, seq, from_at, to_at) values (?, 1, ?, ?)')
      .run('P07', 2000, 3000);
    expect(countRows(one.db, 'pilot_endorsement')).toBe(1);
    expect(countRows(one.db, 'duty_entry')).toBe(1);
    expect(() =>
      one.db
        .prepare('insert into duty_entry (pilot, movement, from_at, to_at) values (?, ?, ?, ?)')
        .run('P99', 'M-2025-0005', 1, 2),
    ).toThrow(/FOREIGN KEY/);
  });

  it('take one board entry per pilot', () => {
    const one = ready();
    const insert = one.db.prepare('insert into board_entry (pilot, turn) values (?, ?)');
    insert.run('P07', 1);
    expect(() => insert.run('P07', 2)).toThrow(/UNIQUE/);
  });

  it('take the same endorsement only once', () => {
    const one = ready();
    const insert = one.db.prepare(
      'insert into pilot_endorsement (pilot, endorsement, granted_at) values (?, ?, ?)',
    );
    insert.run('P07', 'NIGHT', 1000);
    expect(() => insert.run('P07', 'NIGHT', 2000)).toThrow(/UNIQUE/);
  });
});

describe('the billing tables', () => {
  it('are all there', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    for (const table of [
      'tariff_book',
      'tariff_band',
      'tariff_multiplier',
      'invoice',
      'invoice_line',
      'credit_note',
      'payment',
      'payment_allocation',
    ]) {
      expect(tableExists(temp.db, table)).toBe(true);
    }
  });

  it('refuse an invoice against an agent nobody has', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    expect(() =>
      temp!.db
        .prepare(
          `insert into invoice (number, agent, status, raised_at, due_at)
           values ('INV-2025-00001', 'NOBODY', 'draft', 1, 2)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('refuse an invoice status that is not one', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    temp.db.prepare('insert into account (agent, name) values (?, ?)').run('SEAWAY', 'Seaway');
    expect(() =>
      temp!.db
        .prepare(
          `insert into invoice (number, agent, status, raised_at, due_at)
           values ('INV-2025-00001', 'SEAWAY', 'lost', 1, 2)`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('carry the bands against a book', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    temp.db
      .prepare(
        `insert into tariff_book (id, effective_from, minimum_charge, detention_block)
         values ('T-2025-A', 100, 40000, 12000)`,
      )
      .run();
    temp.db
      .prepare('insert into tariff_band (book, up_to, charge, per_unit) values (?, ?, ?, ?)')
      .run('T-2025-A', 100, 45000, 0);
    expect(countRows(temp.db, 'tariff_band')).toBe(1);
    expect(() =>
      temp!.db
        .prepare('insert into tariff_band (book, up_to, charge, per_unit) values (?, ?, ?, ?)')
        .run('T-1999-A', 100, 1, 0),
    ).toThrow(/FOREIGN KEY/);
  });
});

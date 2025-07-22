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
      `insert into vessel (imo, name, type, length_cm, beam_cm, summer_draught_cm,
        air_draught_cm, gross_tonnage, block_coefficient)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('9074729', 'ATLANTIC CROWN', 'bulk', 22500, 3220, 1180, 4200, 43000, 830);
  temp.db
    .prepare('insert into account (agent, name) values (?, ?)')
    .run('SEAWAY', 'Seaway Agencies');
  return temp;
}

function insertMovement(temp: TempDatabase, reference: string, vessel = '9074729'): void {
  temp.db
    .prepare(
      `insert into movement (reference, kind, status, vessel, agent, from_place, to_place,
        draught_cm, ordered_at, requested_for)
       values (?, 'arrival', 'ordered', ?, 'SEAWAY', 'SEA', 'GRAIN-3', 1150, 100, 200)`,
    )
    .run(reference, vessel);
}

describe('the fleet tables', () => {
  it('are all there', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    for (const table of ['vessel', 'account', 'movement', 'movement_time', 'movement_delay']) {
      expect(tableExists(temp.db, table)).toBe(true);
    }
  });

  it('take a ship, an agent and a movement', () => {
    const ready_ = ready();
    insertMovement(ready_, 'M-2025-0004');
    expect(countRows(ready_.db, 'movement')).toBe(1);
  });

  it('refuse a movement against a ship that is not on the books', () => {
    const ready_ = ready();
    expect(() => insertMovement(ready_, 'M-2025-0004', '9999999')).toThrow(/FOREIGN KEY/);
  });

  it('refuse a status the lifecycle does not have', () => {
    const ready_ = ready();
    insertMovement(ready_, 'M-2025-0004');
    expect(() =>
      ready_.db
        .prepare('update movement set status = ? where reference = ?')
        .run('sunk', 'M-2025-0004'),
    ).toThrow(/CHECK/);
  });

  it('refuse a vessel type nobody carries', () => {
    const ready_ = ready();
    expect(() =>
      ready_.db
        .prepare(
          `insert into vessel (imo, name, type, length_cm, beam_cm, summer_draught_cm,
            air_draught_cm, gross_tonnage, block_coefficient)
           values ('9074730', 'X', 'submarine', 1, 1, 1, 1, 1, 800)`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('refuse two ships with the same imo number', () => {
    const ready_ = ready();
    expect(() =>
      ready_.db
        .prepare(
          `insert into vessel (imo, name, type, length_cm, beam_cm, summer_draught_cm,
            air_draught_cm, gross_tonnage, block_coefficient)
           values ('9074729', 'OTHER', 'bulk', 1, 1, 1, 1, 1, 800)`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it('hang the times and the delays off the movement', () => {
    const ready_ = ready();
    insertMovement(ready_, 'M-2025-0004');
    ready_.db
      .prepare('insert into movement_time (movement, ordered_for, boarded) values (?, ?, ?)')
      .run('M-2025-0004', 200, 215);
    ready_.db
      .prepare(
        `insert into movement_delay (movement, seq, cause, from_at, to_at)
         values (?, 1, 'vessel', 220, 260)`,
      )
      .run('M-2025-0004');
    expect(countRows(ready_.db, 'movement_delay')).toBe(1);
    expect(() =>
      ready_.db
        .prepare(
          `insert into movement_delay (movement, seq, cause, from_at, to_at)
           values ('M-2025-9999', 1, 'vessel', 1, 2)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('refuse a delay with a cause nobody records', () => {
    const ready_ = ready();
    insertMovement(ready_, 'M-2025-0004');
    expect(() =>
      ready_.db
        .prepare(
          `insert into movement_delay (movement, seq, cause, from_at, to_at)
           values ('M-2025-0004', 1, 'sunspots', 1, 2)`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('only take one times row per movement', () => {
    const ready_ = ready();
    insertMovement(ready_, 'M-2025-0004');
    const insert = ready_.db.prepare(
      'insert into movement_time (movement, ordered_for) values (?, ?)',
    );
    insert.run('M-2025-0004', 200);
    expect(() => insert.run('M-2025-0004', 300)).toThrow(/UNIQUE/);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InternalError } from '../../../src/util/errors';
import { closeDatabase, openDatabase } from '../../../src/storage/database';
import { migrate } from '../../../src/storage/migrate';
import { backupTo, checkDatabase, checkDomain, summarise } from '../../../src/storage/backup';
import { saveAccount, saveVessel } from '../../../src/storage/fleet-store';
import { makeAccount } from '../../../src/domain/billing/account';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

let temp: TempDatabase | undefined;
let scratch: string | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
  if (scratch !== undefined) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
});

function ready(): TempDatabase {
  temp = temporaryDatabase();
  migrate(temp.db);
  saveAccount(temp.db, makeAccount({ agent: 'SEAWAY', name: 'Seaway Agencies' }));
  saveVessel(
    temp.db,
    makeVessel({
      imo: '9074729',
      name: 'atlantic crown',
      type: 'bulk',
      length: 22500,
      beam: 3220,
      summerDraught: 1180,
      airDraught: 4200,
      grossTonnage: 43000,
    }),
  );
  return temp;
}

function addMovement(
  one: TempDatabase,
  from = 'SEA',
  to = 'GRAIN-3',
  pilot: string | null = null,
): void {
  one.db
    .prepare(
      `insert into movement (reference, kind, status, vessel, agent, from_place, to_place,
        draught_cm, ordered_at, requested_for, pilot)
       values ('M-2025-0004', 'arrival', 'ordered', '9074729', 'SEAWAY', ?, ?, 1150, 100, 200, ?)`,
    )
    .run(from, to, pilot);
}

describe('backing up', () => {
  it('writes a file that opens and carries the same rows', async () => {
    const one = ready();
    scratch = mkdtempSync(join(tmpdir(), 'keelroom-backup-'));
    const path = join(scratch, 'copy.sqlite');
    const result = await backupTo(one.db, path);
    expect(existsSync(path)).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.version).toBeGreaterThan(0);
    const copy = openDatabase(path, { readonly: true });
    const row = copy.prepare('select count(*) as n from vessel').get() as { n: number };
    expect(row.n).toBe(1);
    closeDatabase(copy);
  });

  it('counts the tables it copied', async () => {
    const one = ready();
    scratch = mkdtempSync(join(tmpdir(), 'keelroom-backup-'));
    const result = await backupTo(one.db, join(scratch, 'copy.sqlite'));
    expect(result.tables).toBeGreaterThan(10);
  });
});

describe('checking a district file', () => {
  it('finds nothing wrong with a healthy one', () => {
    const one = ready();
    addMovement(one, 'SEA', 'SEA');
    expect(checkDatabase(one.db)).toEqual([]);
  });

  it('finds a movement naming a berth the district does not have', () => {
    const one = ready();
    addMovement(one);
    const problems = checkDomain(one.db);
    expect(problems.map((problem) => problem.check)).toContain('DOM-PLACE');
    expect(problems[0]?.detail).toContain('GRAIN-3');
  });

  it('finds a movement naming a pilot who is not on the roster', () => {
    const one = ready();
    addMovement(one, 'SEA', 'SEA', 'P99');
    expect(checkDomain(one.db).map((problem) => problem.check)).toContain('DOM-PILOT');
  });

  it('finds a movement assigned with nobody on it', () => {
    const one = ready();
    addMovement(one, 'SEA', 'SEA');
    one.db.prepare("update movement set status = 'assigned'").run();
    expect(checkDomain(one.db).map((problem) => problem.check)).toContain('DOM-ASSIGN');
  });

  it('finds a board entry for a pilot who has gone', () => {
    const one = ready();
    one.db
      .prepare(
        `insert into pilot (id, name, grade, seniority, draught_limit_cm, unit_limit)
         values ('P07', 'A Ferrier', 'unlimited', 1, 9999, 99999)`,
      )
      .run();
    one.db.prepare('insert into board_entry (pilot, turn) values (?, ?)').run('P07', 1);
    one.db.pragma('foreign_keys = OFF');
    one.db.prepare('delete from pilot where id = ?').run('P07');
    one.db.pragma('foreign_keys = ON');
    const checks = checkDatabase(one.db).map((problem) => problem.check);
    expect(checks).toContain('DOM-BOARD');
    expect(checks).toContain('DB-REFERENCE');
  });

  it('says a file with no schema at all has none', () => {
    temp = temporaryDatabase();
    const problems = checkDatabase(temp.db);
    expect(problems.map((problem) => problem.check)).toEqual(['DB-SCHEMA']);
  });
});

describe('summarising', () => {
  it('counts what is in the file', () => {
    const one = ready();
    addMovement(one, 'SEA', 'SEA');
    const summary = summarise(one.db);
    expect(summary.movements).toBe(1);
    expect(summary.vessels).toBe(1);
    expect(summary.pilots).toBe(0);
    expect(summary.invoices).toBe(0);
  });

  it('refuses a file that was never migrated', () => {
    temp = temporaryDatabase();
    expect(() => summarise(temp!.db)).toThrow(InternalError);
  });
});

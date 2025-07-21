/**
 * The migration runner.
 *
 * Each migration has a number, a name and a function, and the numbers it has
 * run are written into the database. A migration is applied in a transaction of
 * its own, so a failure part way leaves the earlier ones in place and the
 * failing one rolled back, which is the state that can be fixed by hand.
 *
 * There is no down. A district that needs a schema change reversed restores the
 * backup taken before the upgrade, because a down migration for anything that
 * drops data is a lie.
 */

import { InternalError } from '../util/errors';
import type { Db } from './database';
import { inTransaction, tableExists } from './database';
import type { Migration } from './migrations';
import { MIGRATIONS } from './migrations';

const LEDGER = `
  create table if not exists schema_migration (
    id          integer primary key,
    name        text not null,
    applied_at  text not null
  )
`;

export function ensureLedger(db: Db): void {
  db.exec(LEDGER);
}

export function appliedIds(db: Db): number[] {
  if (!tableExists(db, 'schema_migration')) {
    return [];
  }
  const rows = db.prepare('select id from schema_migration order by id').all() as { id: number }[];
  return rows.map((row) => row.id);
}

export function currentVersion(db: Db): number {
  return appliedIds(db).reduce((highest, id) => Math.max(highest, id), 0);
}

export function pending(db: Db, migrations: readonly Migration[] = MIGRATIONS): Migration[] {
  const applied = new Set(appliedIds(db));
  return [...migrations]
    .sort((a, b) => a.id - b.id)
    .filter((migration) => !applied.has(migration.id));
}

export function checkOrder(migrations: readonly Migration[] = MIGRATIONS): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.id) || migration.id <= previous) {
      throw new InternalError('the migrations are not in ascending order', {
        at: migration.id,
      });
    }
    previous = migration.id;
  }
}

export interface MigrationRun {
  readonly applied: readonly number[];
  readonly version: number;
}

/** Bring a database up to the current schema. Safe to run on one already there. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): MigrationRun {
  checkOrder(migrations);
  ensureLedger(db);
  const applied: number[] = [];
  for (const migration of pending(db, migrations)) {
    inTransaction(db, (inner) => {
      migration.up(inner);
      inner
        .prepare('insert into schema_migration (id, name, applied_at) values (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString());
    });
    applied.push(migration.id);
  }
  return { applied, version: currentVersion(db) };
}

/** Whether the database is at the version the code expects. */
export function isCurrent(db: Db, migrations: readonly Migration[] = MIGRATIONS): boolean {
  return pending(db, migrations).length === 0;
}

export function latestVersion(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.reduce((highest, migration) => Math.max(highest, migration.id), 0);
}

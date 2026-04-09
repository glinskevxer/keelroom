/**
 * Backups, and the checks that say whether a district file is still sound.
 *
 * sqlite's own backup api copies a live database safely, which matters because
 * the despatcher never closes the terminal and there is no window in which
 * nothing is open. The checks are the other half: a file that copies cleanly
 * and has a movement pointing at a berth that no longer exists is not a good
 * backup, it is a fast copy of a broken district.
 */

import { copyFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { InternalError } from '../util/errors';
import type { Db } from './database';
import { brokenReferences, countRows, integrityProblems, tableExists } from './database';
import { currentVersion } from './migrate';
import { openDatabase } from './database';

function openBackup(path: string): Db {
  return openDatabase(path, { readonly: true });
}

export interface BackupResult {
  readonly path: string;
  readonly bytes: number;
  readonly tables: number;
  readonly version: number;
}

export async function backupTo(db: Db, path: string): Promise<BackupResult> {
  await db.backup(path);
  const stats = statSync(path);
  const tables = (
    db.prepare(`select count(*) as n from sqlite_master where type = 'table'`).get() as {
      n: number;
    }
  ).n;
  return { path, bytes: stats.size, tables, version: currentVersion(db) };
}

export interface RestoreResult {
  readonly from: string;
  readonly to: string;
  readonly bytes: number;
  readonly kept: string | undefined;
}

/**
 * Put a backup back. The file being replaced is moved aside first rather than
 * overwritten, because the commonest reason to restore is that somebody is
 * already having a bad day and a restore from the wrong backup should not be
 * the end of the district.
 */
export function restoreFrom(
  source: string,
  target: string,
  options: { keep?: boolean } = {},
): RestoreResult {
  if (!existsSync(source)) {
    throw new InternalError('there is no backup at that path', { source });
  }
  const check = openBackup(source);
  try {
    if (integrityProblems(check).length > 0) {
      throw new InternalError('the backup does not pass its own integrity check', { source });
    }
  } finally {
    check.close();
  }
  let kept: string | undefined;
  if (existsSync(target)) {
    if (options.keep === false) {
      unlinkSync(target);
    } else {
      kept = `${target}.replaced`;
      renameSync(target, kept);
    }
  }
  copyFileSync(source, target);
  return { from: source, to: target, bytes: statSync(target).size, kept };
}

export interface Problem {
  readonly check: string;
  readonly detail: string;
}

/** Every structural check the district runs against its own file. */
export function checkDatabase(db: Db): Problem[] {
  const problems: Problem[] = [];
  for (const line of integrityProblems(db)) {
    problems.push({ check: 'DB-INTEGRITY', detail: line });
  }
  for (const broken of brokenReferences(db)) {
    problems.push({
      check: 'DB-REFERENCE',
      detail: `${broken.table} row ${broken.rowid} points at a missing ${broken.parent}`,
    });
  }
  if (!tableExists(db, 'schema_migration')) {
    problems.push({ check: 'DB-SCHEMA', detail: 'the migration ledger is missing' });
    return problems;
  }
  problems.push(...checkDomain(db));
  return problems;
}

/**
 * The checks the schema cannot make: places are named by text rather than by a
 * reference, because a movement can name a berth, an anchorage or the sea.
 */
export function checkDomain(db: Db): Problem[] {
  const problems: Problem[] = [];
  if (!tableExists(db, 'movement')) {
    return problems;
  }
  const places = new Set<string>([
    'SEA',
    ...(db.prepare('select id from berth').all() as { id: string }[]).map((row) => row.id),
  ]);
  const movements = db
    .prepare('select reference, from_place, to_place, pilot, status from movement')
    .all() as {
    reference: string;
    from_place: string;
    to_place: string;
    pilot: string | null;
    status: string;
  }[];
  const pilots = new Set(
    (db.prepare('select id from pilot').all() as { id: string }[]).map((row) => row.id),
  );
  for (const movement of movements) {
    for (const place of [movement.from_place, movement.to_place]) {
      if (!places.has(place)) {
        problems.push({
          check: 'DOM-PLACE',
          detail: `${movement.reference} names ${place}, which is not a berth in this district`,
        });
      }
    }
    if (movement.pilot !== null && !pilots.has(movement.pilot)) {
      problems.push({
        check: 'DOM-PILOT',
        detail: `${movement.reference} names pilot ${movement.pilot}, who is not on the roster`,
      });
    }
    if (movement.status === 'assigned' && movement.pilot === null) {
      problems.push({
        check: 'DOM-ASSIGN',
        detail: `${movement.reference} is assigned with no pilot on it`,
      });
    }
  }
  const boarded = db
    .prepare(
      `select b.pilot as pilot from board_entry b
       left join pilot p on p.id = b.pilot
       where p.id is null`,
    )
    .all() as { pilot: string }[];
  for (const row of boarded) {
    problems.push({
      check: 'DOM-BOARD',
      detail: `the board carries ${row.pilot}, who is not on the roster`,
    });
  }
  return problems;
}

export interface DatabaseSummary {
  readonly version: number;
  readonly movements: number;
  readonly vessels: number;
  readonly pilots: number;
  readonly invoices: number;
}

export function summarise(db: Db): DatabaseSummary {
  for (const table of ['movement', 'vessel', 'pilot', 'invoice']) {
    if (!tableExists(db, table)) {
      throw new InternalError('the district file has not been migrated', { table });
    }
  }
  return {
    version: currentVersion(db),
    movements: countRows(db, 'movement'),
    vessels: countRows(db, 'vessel'),
    pilots: countRows(db, 'pilot'),
    invoices: countRows(db, 'invoice'),
  };
}

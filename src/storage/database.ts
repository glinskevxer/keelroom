/**
 * The sqlite handle, and the settings that have to be right before anything is
 * written.
 *
 * Foreign keys are off by default in sqlite, which means every reference in the
 * schema is decorative unless the pragma is set on the connection rather than in
 * the file. Write ahead logging is on because the reporting side reads while the
 * despatch side writes. Busy timeout is set because two processes on the same
 * file is normal here: the despatcher has the terminal open and the api serves
 * the agents at the same time.
 */

import Database from 'better-sqlite3';
import { InternalError } from '../util/errors';

export type Db = Database.Database;

export interface OpenOptions {
  /** Open the file without allowing writes. */
  readonly readonly?: boolean;
  /** Milliseconds to wait on a locked database before giving up. */
  readonly busyTimeout?: number;
}

export function openDatabase(path: string, options: OpenOptions = {}): Db {
  const db = new Database(path, { readonly: options.readonly === true });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma(`busy_timeout = ${options.busyTimeout ?? 5000}`);
  return db;
}

export function openMemory(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

export function closeDatabase(db: Db): void {
  if (db.open) {
    db.close();
  }
}

/** Whether the connection is actually enforcing references. */
export function foreignKeysOn(db: Db): boolean {
  const rows = db.pragma('foreign_keys') as { foreign_keys: number }[];
  return rows[0]?.foreign_keys === 1;
}

export function journalMode(db: Db): string {
  const rows = db.pragma('journal_mode') as { journal_mode: string }[];
  return rows[0]?.journal_mode ?? 'unknown';
}

/**
 * Run a unit of work in one transaction. Anything thrown rolls the whole thing
 * back, which is the only reason the repositories can leave consistency to the
 * caller.
 */
export function inTransaction<T>(db: Db, work: (db: Db) => T): T {
  const run = db.transaction(work);
  return run(db);
}

/** Any foreign key that no longer resolves, which the doctor command reads. */
export function brokenReferences(db: Db): { table: string; rowid: number; parent: string }[] {
  const rows = db.pragma('foreign_key_check') as {
    table: string;
    rowid: number;
    parent: string;
  }[];
  return rows.map((row) => ({ table: row.table, rowid: row.rowid, parent: row.parent }));
}

export function integrityProblems(db: Db): string[] {
  const rows = db.pragma('integrity_check') as { integrity_check: string }[];
  return rows.map((row) => row.integrity_check).filter((line) => line !== 'ok');
}

export function tableNames(db: Db): string[] {
  const rows = db
    .prepare(
      `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
    )
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

export function tableExists(db: Db, name: string): boolean {
  return tableNames(db).includes(name);
}

export function countRows(db: Db, table: string): number {
  if (!tableExists(db, table)) {
    throw new InternalError(`there is no table called ${table}`);
  }
  const row = db.prepare(`select count(*) as n from "${table}"`).get() as { n: number };
  return row.n;
}

/** Reclaim the space a long running district leaves behind. */
export function compact(db: Db): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('vacuum');
}

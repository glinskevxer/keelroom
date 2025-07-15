import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../src/storage/database';
import { closeDatabase, openDatabase } from '../../src/storage/database';

export interface TempDatabase {
  readonly db: Db;
  readonly path: string;
  close(): void;
}

/** A real file on disk, because the pragmas under test do nothing in memory. */
export function temporaryDatabase(): TempDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'keelroom-'));
  const path = join(directory, 'district.sqlite');
  const db = openDatabase(path);
  return {
    db,
    path,
    close(): void {
      closeDatabase(db);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

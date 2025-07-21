import { afterEach, describe, expect, it } from 'vitest';
import { InternalError } from '../../../src/util/errors';
import { tableExists, tableNames } from '../../../src/storage/database';
import {
  appliedIds,
  checkOrder,
  currentVersion,
  isCurrent,
  latestVersion,
  migrate,
  pending,
} from '../../../src/storage/migrate';
import { MIGRATIONS } from '../../../src/storage/migrations';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

describe('the list itself', () => {
  it('climbs in order with no gaps in the numbering', () => {
    expect(() => checkOrder()).not.toThrow();
    expect(latestVersion()).toBe(MIGRATIONS.length);
  });

  it('refuses a list that does not climb', () => {
    const backwards = [
      { id: 2, name: 'b', up: (): void => {} },
      { id: 1, name: 'a', up: (): void => {} },
    ];
    expect(() => checkOrder(backwards)).toThrow(InternalError);
  });

  it('gives every migration a name', () => {
    for (const migration of MIGRATIONS) {
      expect(migration.name).not.toBe('');
    }
  });
});

describe('running them', () => {
  it('starts at nothing', () => {
    temp = temporaryDatabase();
    expect(currentVersion(temp.db)).toBe(0);
    expect(appliedIds(temp.db)).toEqual([]);
    expect(isCurrent(temp.db)).toBe(false);
  });

  it('applies everything and records what it applied', () => {
    temp = temporaryDatabase();
    const run = migrate(temp.db);
    expect(run.applied).toEqual(MIGRATIONS.map((migration) => migration.id));
    expect(run.version).toBe(latestVersion());
    expect(isCurrent(temp.db)).toBe(true);
  });

  it('does nothing the second time', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    expect(migrate(temp.db).applied).toEqual([]);
    expect(pending(temp.db)).toEqual([]);
  });

  it('builds the district tables', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    for (const table of ['district', 'tide_station', 'tide_term', 'reach', 'berth', 'overhead']) {
      expect(tableExists(temp.db, table)).toBe(true);
    }
    expect(tableNames(temp.db)).toContain('schema_migration');
  });

  it('rolls a failing migration back and leaves the earlier ones', () => {
    temp = temporaryDatabase();
    const broken = [
      ...MIGRATIONS,
      {
        id: 999,
        name: 'broken',
        up: (db: import('../../../src/storage/database').Db): void => {
          db.exec('create table half_built (id integer primary key)');
          db.exec('this is not sql');
        },
      },
    ];
    expect(() => migrate(temp!.db, broken)).toThrow();
    expect(tableExists(temp.db, 'half_built')).toBe(false);
    expect(currentVersion(temp.db)).toBe(latestVersion());
  });

  it('applies a later migration to a database that stopped part way', () => {
    temp = temporaryDatabase();
    migrate(temp.db, MIGRATIONS.slice(0, 1));
    const run = migrate(temp.db);
    expect(run.applied).toEqual(MIGRATIONS.slice(1).map((migration) => migration.id));
  });
});

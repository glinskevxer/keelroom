import { afterEach, describe, expect, it } from 'vitest';
import { InternalError } from '../../../src/util/errors';
import {
  brokenReferences,
  closeDatabase,
  compact,
  countRows,
  foreignKeysOn,
  inTransaction,
  integrityProblems,
  journalMode,
  openMemory,
  tableExists,
  tableNames,
} from '../../../src/storage/database';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

describe('opening', () => {
  it('turns foreign keys on and write ahead logging with it', () => {
    temp = temporaryDatabase();
    expect(foreignKeysOn(temp.db)).toBe(true);
    expect(journalMode(temp.db)).toBe('wal');
  });

  it('enforces the references it was told to enforce', () => {
    temp = temporaryDatabase();
    temp.db.exec(`
      create table berth (id text primary key);
      create table movement (id text primary key, berth text references berth(id));
    `);
    expect(() =>
      temp!.db.prepare('insert into movement values (?, ?)').run('M-1', 'NOWHERE'),
    ).toThrow(/FOREIGN KEY/);
  });

  it('closes without complaining twice', () => {
    const another = openMemory();
    closeDatabase(another);
    expect(() => closeDatabase(another)).not.toThrow();
  });

  it('opens in memory for the tests that do not need a file', () => {
    const memory = openMemory();
    expect(foreignKeysOn(memory)).toBe(true);
    closeDatabase(memory);
  });
});

describe('transactions', () => {
  it('commits work that finishes', () => {
    temp = temporaryDatabase();
    temp.db.exec('create table note (id integer primary key, body text)');
    inTransaction(temp.db, (db) => {
      db.prepare('insert into note (body) values (?)').run('first');
      db.prepare('insert into note (body) values (?)').run('second');
    });
    expect(countRows(temp.db, 'note')).toBe(2);
  });

  it('rolls back the whole thing when anything throws', () => {
    temp = temporaryDatabase();
    temp.db.exec('create table note (id integer primary key, body text)');
    expect(() =>
      inTransaction(temp!.db, (db) => {
        db.prepare('insert into note (body) values (?)').run('first');
        throw new Error('changed my mind');
      }),
    ).toThrow('changed my mind');
    expect(countRows(temp.db, 'note')).toBe(0);
  });

  it('hands back what the work returned', () => {
    temp = temporaryDatabase();
    expect(inTransaction(temp!.db, () => 42)).toBe(42);
  });
});

describe('reading the shape of a database', () => {
  it('lists the tables in order and leaves the sqlite ones out', () => {
    temp = temporaryDatabase();
    temp.db.exec(
      'create table zebra (id integer primary key); create table alpha (id integer primary key)',
    );
    expect(tableNames(temp.db)).toEqual(['alpha', 'zebra']);
    expect(tableExists(temp.db, 'alpha')).toBe(true);
    expect(tableExists(temp.db, 'nothing')).toBe(false);
  });

  it('counts a table and refuses one that is not there', () => {
    temp = temporaryDatabase();
    temp.db.exec('create table note (id integer primary key)');
    expect(countRows(temp.db, 'note')).toBe(0);
    expect(() => countRows(temp!.db, 'nothing')).toThrow(InternalError);
  });

  it('finds nothing wrong with a healthy database', () => {
    temp = temporaryDatabase();
    temp.db.exec('create table note (id integer primary key)');
    expect(integrityProblems(temp.db)).toEqual([]);
    expect(brokenReferences(temp.db)).toEqual([]);
  });

  it('finds a reference broken while the pragma was off', () => {
    temp = temporaryDatabase();
    temp.db.exec(`
      create table berth (id text primary key);
      create table movement (id text primary key, berth text references berth(id));
    `);
    temp.db.pragma('foreign_keys = OFF');
    temp.db.prepare('insert into movement values (?, ?)').run('M-1', 'NOWHERE');
    temp.db.pragma('foreign_keys = ON');
    const broken = brokenReferences(temp.db);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.table).toBe('movement');
    expect(broken[0]?.parent).toBe('berth');
  });

  it('compacts without losing anything', () => {
    temp = temporaryDatabase();
    temp.db.exec('create table note (id integer primary key, body text)');
    temp.db.prepare('insert into note (body) values (?)').run('kept');
    compact(temp.db);
    expect(countRows(temp.db, 'note')).toBe(1);
  });
});

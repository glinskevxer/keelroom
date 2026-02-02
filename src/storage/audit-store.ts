/**
 * Writing and reading the trail. There is no update and no delete, on purpose.
 */

import type { Minute } from '../util/clock';
import type { Db } from './database';
import type { AuditEntry } from '../domain/audit/entry';
import { makeEntry } from '../domain/audit/entry';

interface EntryRow {
  seq: number;
  at: number;
  action: string;
  subject: string;
  by_whom: string;
  note: string;
  detail: string | null;
}

function toEntry(row: EntryRow): AuditEntry {
  return makeEntry({
    at: row.at,
    action: row.action,
    subject: row.subject,
    by: row.by_whom,
    note: row.note,
    ...(row.detail === null
      ? {}
      : { detail: JSON.parse(row.detail) as Record<string, string | number> }),
  });
}

export function record(db: Db, entry: AuditEntry): void {
  db.prepare(
    `insert into audit_entry (at, action, subject, by_whom, note, detail)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.at,
    entry.action,
    entry.subject,
    entry.by,
    entry.note,
    entry.detail === undefined ? null : JSON.stringify(entry.detail),
  );
}

export function trailFor(db: Db, subject: string): AuditEntry[] {
  const rows = db
    .prepare('select * from audit_entry where subject = ? order by at, seq')
    .all(subject) as EntryRow[];
  return rows.map(toEntry);
}

export function trailBetween(db: Db, from: Minute, to: Minute): AuditEntry[] {
  const rows = db
    .prepare('select * from audit_entry where at between ? and ? order by at, seq')
    .all(from, to) as EntryRow[];
  return rows.map(toEntry);
}

export function trailBy(db: Db, by: string): AuditEntry[] {
  const rows = db
    .prepare('select * from audit_entry where by_whom = ? order by at, seq')
    .all(by) as EntryRow[];
  return rows.map(toEntry);
}

export function lastEntries(db: Db, limit = 20): AuditEntry[] {
  const rows = db
    .prepare('select * from audit_entry order by seq desc limit ?')
    .all(limit) as EntryRow[];
  return rows.reverse().map(toEntry);
}

export function entryCount(db: Db): number {
  const row = db.prepare('select count(*) as n from audit_entry').get() as { n: number };
  return row.n;
}

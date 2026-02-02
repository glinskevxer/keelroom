import type { Db } from '../database';

/** The audit trail, which is appended to and never updated. */
export function up(db: Db): void {
  db.exec(`
    create table audit_entry (
      seq       integer primary key autoincrement,
      at        integer not null,
      action    text not null,
      subject   text not null,
      by_whom   text not null,
      note      text not null default '',
      detail    text
    );

    create index audit_by_subject on audit_entry (subject, at);
    create index audit_by_time on audit_entry (at);
  `);
}

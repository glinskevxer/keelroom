/**
 * Notices, and the fact that they are withdrawn rather than deleted.
 *
 * A notice that bound on a movement last week has to stay readable, because the
 * argument about why that ship was held is had a month later. So a notice that
 * is lifted early is marked withdrawn and keeps its number, and only the current
 * queries filter it out.
 */

import type { Minute } from '../util/clock';
import type { Interval } from '../util/interval';
import type { Db } from './database';
import { requiring } from './lookup';
import type { Notice, NoticeKind } from '../domain/notice/notice';
import { makeNotice, makeNoticeId } from '../domain/notice/notice';

interface NoticeRow {
  id: string;
  kind: NoticeKind;
  subject: string;
  from_at: number;
  to_at: number;
  body: string;
  value: number | null;
  issued_at: number;
  withdrawn: number;
}

function toNotice(row: NoticeRow): Notice {
  return makeNotice({
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    from: row.from_at,
    to: row.to_at,
    text: row.body,
    ...(row.value === null ? {} : { value: row.value }),
    issuedAt: row.issued_at,
  });
}

export function saveNotice(db: Db, notice: Notice): void {
  db.prepare(
    `insert into notice (id, kind, subject, from_at, to_at, body, value, issued_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       kind = excluded.kind,
       subject = excluded.subject,
       from_at = excluded.from_at,
       to_at = excluded.to_at,
       body = excluded.body,
       value = excluded.value,
       issued_at = excluded.issued_at`,
  ).run(
    notice.id,
    notice.kind,
    notice.subject,
    notice.period.from,
    notice.period.to,
    notice.text,
    notice.value ?? null,
    notice.issuedAt,
  );
}

export function findNotice(db: Db, id: string): Notice | undefined {
  const row = db.prepare('select * from notice where id = ?').get(id) as NoticeRow | undefined;
  return row === undefined ? undefined : toNotice(row);
}

export const requireNotice = requiring(findNotice, 'notice', (_db, id) => id);

/** Every notice that has not been withdrawn, whatever its dates. */
export function standingNotices(db: Db): Notice[] {
  const rows = db
    .prepare('select * from notice where withdrawn = 0 order by from_at, id')
    .all() as NoticeRow[];
  return rows.map(toNotice);
}

/** The notices that could bind on anything planned inside a period. */
export function noticesInPeriod(db: Db, period: Interval): Notice[] {
  const rows = db
    .prepare(
      `select * from notice
       where withdrawn = 0 and from_at <= ? and to_at >= ?
       order by from_at, id`,
    )
    .all(period.to, period.from) as NoticeRow[];
  return rows.map(toNotice);
}

export function noticesOn(db: Db, subject: string): Notice[] {
  const rows = db
    .prepare('select * from notice where subject = ? and withdrawn = 0 order by from_at, id')
    .all(subject) as NoticeRow[];
  return rows.map(toNotice);
}

export function withdrawNotice(db: Db, id: string): boolean {
  return db.prepare('update notice set withdrawn = 1 where id = ?').run(id).changes > 0;
}

export function isWithdrawn(db: Db, id: string): boolean {
  const row = db.prepare('select withdrawn from notice where id = ?').get(id) as
    | { withdrawn: number }
    | undefined;
  return row?.withdrawn === 1;
}

/** The next notice number for a year, counting the withdrawn ones. */
export function nextNoticeId(db: Db, year: number): string {
  const rows = db
    .prepare('select id from notice where id like ? order by id')
    .all(`N-${year}-%`) as { id: string }[];
  const highest = rows.reduce((worst, row) => Math.max(worst, Number(row.id.slice(7))), 0);
  return makeNoticeId(year, highest + 1);
}

export function withdrawnNotices(db: Db): Notice[] {
  const rows = db
    .prepare('select * from notice where withdrawn = 1 order by from_at, id')
    .all() as NoticeRow[];
  return rows.map(toNotice);
}

export function noticesIssuedSince(db: Db, since: Minute): Notice[] {
  const rows = db
    .prepare('select * from notice where issued_at >= ? and withdrawn = 0 order by issued_at, id')
    .all(since) as NoticeRow[];
  return rows.map(toNotice);
}

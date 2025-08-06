/**
 * Pilots, what they hold, what they have worked and where they stand on the
 * board.
 *
 * The board is stored as one row per pilot rather than as an ordered list,
 * because the turn number is the order and rewriting a list every time somebody
 * takes a ship is how two despatchers end up with different boards.
 */

import { NotFoundError } from '../util/errors';
import type { Minute } from '../util/clock';
import type { Interval } from '../util/interval';
import { makeInterval } from '../util/interval';
import type { Db } from './database';
import { inTransaction } from './database';
import type { Grade, Pilot } from '../domain/roster/pilot';
import { makePilot } from '../domain/roster/pilot';
import type { DutyEntry } from '../domain/roster/duty';
import { makeDutyEntry } from '../domain/roster/duty';
import type { TurnBoard } from '../domain/roster/board';

interface PilotRow {
  id: string;
  name: string;
  grade: Grade;
  seniority: number;
  draught_limit_cm: number;
  unit_limit: number;
  active: number;
}

interface DutyRow {
  pilot: string;
  movement: string;
  from_at: number;
  to_at: number;
}

interface LeaveRow {
  pilot: string;
  seq: number;
  from_at: number;
  to_at: number;
  reason: string | null;
}

interface BoardRow {
  pilot: string;
  turn: number;
  last_job_ended: number | null;
  passes: number;
  jobs: number;
}

function toPilot(row: PilotRow, endorsements: readonly string[]): Pilot {
  return makePilot({
    id: row.id,
    name: row.name,
    grade: row.grade,
    seniority: row.seniority,
    endorsements,
    limits: { draught: row.draught_limit_cm, units: row.unit_limit },
    active: row.active === 1,
  });
}

export function savePilot(db: Db, pilot: Pilot, grantedAt: Minute = 0): void {
  inTransaction(db, (inner) => {
    inner
      .prepare(
        `insert into pilot (id, name, grade, seniority, draught_limit_cm, unit_limit, active)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           name = excluded.name,
           grade = excluded.grade,
           seniority = excluded.seniority,
           draught_limit_cm = excluded.draught_limit_cm,
           unit_limit = excluded.unit_limit,
           active = excluded.active`,
      )
      .run(
        pilot.id,
        pilot.name,
        pilot.grade,
        pilot.seniority,
        pilot.limits.draught,
        pilot.limits.units,
        pilot.active ? 1 : 0,
      );
    inner.prepare('delete from pilot_endorsement where pilot = ?').run(pilot.id);
    const endorsement = inner.prepare(
      'insert into pilot_endorsement (pilot, endorsement, granted_at) values (?, ?, ?)',
    );
    for (const held of pilot.endorsements) {
      endorsement.run(pilot.id, held, grantedAt);
    }
  });
}

function endorsementsFor(db: Db, pilot: string): string[] {
  const rows = db
    .prepare('select endorsement from pilot_endorsement where pilot = ? order by endorsement')
    .all(pilot) as { endorsement: string }[];
  return rows.map((row) => row.endorsement);
}

export function findPilot(db: Db, id: string): Pilot | undefined {
  const row = db.prepare('select * from pilot where id = ?').get(id) as PilotRow | undefined;
  return row === undefined ? undefined : toPilot(row, endorsementsFor(db, id));
}

export function requirePilot(db: Db, id: string): Pilot {
  const pilot = findPilot(db, id);
  if (pilot === undefined) {
    throw new NotFoundError('pilot', id);
  }
  return pilot;
}

export function allPilots(db: Db): Pilot[] {
  const rows = db.prepare('select * from pilot order by seniority').all() as PilotRow[];
  return rows.map((row) => toPilot(row, endorsementsFor(db, row.id)));
}

export function activePilots(db: Db): Pilot[] {
  return allPilots(db).filter((pilot) => pilot.active);
}

export function recordDuty(db: Db, entry: DutyEntry): void {
  db.prepare(
    `insert into duty_entry (pilot, movement, from_at, to_at) values (?, ?, ?, ?)
     on conflict(pilot, movement) do update set
       from_at = excluded.from_at,
       to_at = excluded.to_at`,
  ).run(entry.pilot, entry.movement, entry.period.from, entry.period.to);
}

export function dutyFor(db: Db, pilot: string, since?: Minute): DutyEntry[] {
  const rows = (
    since === undefined
      ? db.prepare('select * from duty_entry where pilot = ? order by from_at').all(pilot)
      : db
          .prepare('select * from duty_entry where pilot = ? and to_at >= ? order by from_at')
          .all(pilot, since)
  ) as DutyRow[];
  return rows.map((row) => makeDutyEntry(row.pilot, row.movement, row.from_at, row.to_at));
}

export function allDuty(db: Db, since?: Minute): DutyEntry[] {
  const rows = (
    since === undefined
      ? db.prepare('select * from duty_entry order by from_at').all()
      : db.prepare('select * from duty_entry where to_at >= ? order by from_at').all(since)
  ) as DutyRow[];
  return rows.map((row) => makeDutyEntry(row.pilot, row.movement, row.from_at, row.to_at));
}

export function recordLeave(db: Db, pilot: string, period: Interval, reason?: string): void {
  const row = db
    .prepare('select coalesce(max(seq), 0) as top from pilot_leave where pilot = ?')
    .get(pilot) as { top: number };
  db.prepare(
    'insert into pilot_leave (pilot, seq, from_at, to_at, reason) values (?, ?, ?, ?, ?)',
  ).run(pilot, row.top + 1, period.from, period.to, reason ?? null);
}

export function leaveFor(db: Db, pilot: string): Interval[] {
  const rows = db
    .prepare('select * from pilot_leave where pilot = ? order by from_at')
    .all(pilot) as LeaveRow[];
  return rows.map((row) => makeInterval(row.from_at, row.to_at));
}

export function leaveByPilot(db: Db): Record<string, Interval[]> {
  const rows = db.prepare('select * from pilot_leave order by pilot, from_at').all() as LeaveRow[];
  const grouped: Record<string, Interval[]> = {};
  for (const row of rows) {
    const held = grouped[row.pilot] ?? [];
    held.push(makeInterval(row.from_at, row.to_at));
    grouped[row.pilot] = held;
  }
  return grouped;
}

export function saveBoard(db: Db, board: TurnBoard): void {
  inTransaction(db, (inner) => {
    inner.prepare('delete from board_entry').run();
    const entry = inner.prepare(
      `insert into board_entry (pilot, turn, last_job_ended, passes, jobs)
       values (?, ?, ?, ?, ?)`,
    );
    for (const row of board.entries) {
      entry.run(row.pilot, row.turn, row.lastJobEnded ?? null, row.passes, row.jobs);
    }
  });
}

export function loadBoard(db: Db): TurnBoard {
  const rows = db.prepare('select * from board_entry order by turn').all() as BoardRow[];
  return {
    entries: rows.map((row) => ({
      pilot: row.pilot,
      turn: row.turn,
      lastJobEnded: row.last_job_ended ?? undefined,
      passes: row.passes,
      jobs: row.jobs,
    })),
  };
}

export function boardIsEmpty(db: Db): boolean {
  return loadBoard(db).entries.length === 0;
}

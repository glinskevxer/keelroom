/**
 * Movements, with the notes, the card and the delays that hang off them.
 *
 * A movement is written whole: the row, its notes and its times all go in one
 * transaction, and the notes are replaced rather than appended to, because the
 * domain object carries the whole list and reconciling two lists is how notes
 * get duplicated.
 */

import type { Minute } from '../util/clock';
import type { Db } from './database';
import { requiring } from './lookup';
import { inTransaction } from './database';
import type { Movement, MovementKind, MovementStatus } from '../domain/movement/movement';
import { makeMovement } from '../domain/movement/movement';
import type { Delay, DelayCause, MovementTimes } from '../domain/movement/times';
import { makeDelay } from '../domain/movement/times';
import type { CargoDeclaration } from '../domain/vessel/cargo';
import { makeDeclaration } from '../domain/vessel/cargo';

interface MovementRow {
  reference: string;
  kind: MovementKind;
  status: MovementStatus;
  vessel: string;
  agent: string;
  from_place: string;
  to_place: string;
  draught_cm: number;
  ordered_at: number;
  requested_for: number;
  planned_for: number | null;
  pilot: string | null;
  tugs: number;
  tariff_book: string | null;
}

interface TimeRow {
  movement: string;
  ordered_for: number;
  boarded: number | null;
  let_go: number | null;
  all_fast: number | null;
}

interface DelayRow {
  movement: string;
  seq: number;
  cause: DelayCause;
  from_at: number;
  to_at: number;
  note: string | null;
}

function toMovement(row: MovementRow, notes: readonly string[]): Movement {
  return makeMovement({
    reference: row.reference,
    kind: row.kind,
    status: row.status,
    vessel: row.vessel,
    agent: row.agent,
    from: row.from_place,
    to: row.to_place,
    draught: row.draught_cm,
    orderedAt: row.ordered_at,
    requestedFor: row.requested_for,
    plannedFor: row.planned_for ?? undefined,
    pilot: row.pilot ?? undefined,
    tugs: row.tugs,
    notes,
  });
}

export function saveMovement(db: Db, movement: Movement, tariffBook?: string): void {
  inTransaction(db, (inner) => {
    inner
      .prepare(
        `insert into movement (reference, kind, status, vessel, agent, from_place, to_place,
          draught_cm, ordered_at, requested_for, planned_for, pilot, tugs, tariff_book)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(reference) do update set
           kind = excluded.kind,
           status = excluded.status,
           vessel = excluded.vessel,
           agent = excluded.agent,
           from_place = excluded.from_place,
           to_place = excluded.to_place,
           draught_cm = excluded.draught_cm,
           ordered_at = excluded.ordered_at,
           requested_for = excluded.requested_for,
           planned_for = excluded.planned_for,
           pilot = excluded.pilot,
           tugs = excluded.tugs,
           tariff_book = excluded.tariff_book`,
      )
      .run(
        movement.reference,
        movement.kind,
        movement.status,
        movement.vessel,
        movement.agent,
        movement.from,
        movement.to,
        movement.draught,
        movement.orderedAt,
        movement.requestedFor,
        movement.plannedFor ?? null,
        movement.pilot ?? null,
        movement.tugs,
        tariffBook ?? null,
      );
    inner.prepare('delete from movement_note where movement = ?').run(movement.reference);
    const note = inner.prepare('insert into movement_note (movement, seq, body) values (?, ?, ?)');
    movement.notes.forEach((body, index) => {
      note.run(movement.reference, index + 1, body);
    });
  });
}

export function findMovement(db: Db, reference: string): Movement | undefined {
  const row = db.prepare('select * from movement where reference = ?').get(reference) as
    | MovementRow
    | undefined;
  if (row === undefined) {
    return undefined;
  }
  const notes = (
    db.prepare('select body from movement_note where movement = ? order by seq').all(reference) as {
      body: string;
    }[]
  ).map((note) => note.body);
  return toMovement(row, notes);
}

export const requireMovement: (db: Db, reference: string) => Movement = requiring(
  findMovement,
  'movement',
  (_db, reference) => reference,
);

function movementsFrom(db: Db, rows: readonly MovementRow[]): Movement[] {
  return rows.map((row) => requireMovement(db, row.reference));
}

export function movementsByStatus(db: Db, status: MovementStatus): Movement[] {
  const rows = db
    .prepare('select * from movement where status = ? order by requested_for, reference')
    .all(status) as MovementRow[];
  return movementsFrom(db, rows);
}

export function movementsInWindow(db: Db, from: Minute, to: Minute): Movement[] {
  const rows = db
    .prepare(
      `select * from movement
       where coalesce(planned_for, requested_for) between ? and ?
       order by coalesce(planned_for, requested_for), reference`,
    )
    .all(from, to) as MovementRow[];
  return movementsFrom(db, rows);
}

export function movementsForVessel(db: Db, imo: string): Movement[] {
  const rows = db
    .prepare('select * from movement where vessel = ? order by requested_for, reference')
    .all(imo) as MovementRow[];
  return movementsFrom(db, rows);
}

export function movementsForAgent(db: Db, agent: string): Movement[] {
  const rows = db
    .prepare('select * from movement where agent = ? order by requested_for, reference')
    .all(agent) as MovementRow[];
  return movementsFrom(db, rows);
}

export function referencesIssuedIn(db: Db, year: number): string[] {
  const rows = db
    .prepare('select reference from movement where reference like ? order by reference')
    .all(`M-${year}-%`) as { reference: string }[];
  return rows.map((row) => row.reference);
}

export function tariffBookFor(db: Db, reference: string): string | undefined {
  const row = db.prepare('select tariff_book from movement where reference = ?').get(reference) as
    | { tariff_book: string | null }
    | undefined;
  return row?.tariff_book ?? undefined;
}

export function saveTimes(db: Db, reference: string, times: MovementTimes): void {
  inTransaction(db, (inner) => {
    inner
      .prepare(
        `insert into movement_time (movement, ordered_for, boarded, let_go, all_fast)
         values (?, ?, ?, ?, ?)
         on conflict(movement) do update set
           ordered_for = excluded.ordered_for,
           boarded = excluded.boarded,
           let_go = excluded.let_go,
           all_fast = excluded.all_fast`,
      )
      .run(
        reference,
        times.orderedFor,
        times.boarded ?? null,
        times.letGo ?? null,
        times.allFast ?? null,
      );
    inner.prepare('delete from movement_delay where movement = ?').run(reference);
    const delay = inner.prepare(
      `insert into movement_delay (movement, seq, cause, from_at, to_at, note)
       values (?, ?, ?, ?, ?, ?)`,
    );
    (times.delays ?? []).forEach((one, index) => {
      delay.run(reference, index + 1, one.cause, one.from, one.to, one.note ?? null);
    });
  });
}

export function findTimes(db: Db, reference: string): MovementTimes | undefined {
  const row = db.prepare('select * from movement_time where movement = ?').get(reference) as
    | TimeRow
    | undefined;
  if (row === undefined) {
    return undefined;
  }
  const delays: Delay[] = (
    db
      .prepare('select * from movement_delay where movement = ? order by seq')
      .all(reference) as DelayRow[]
  ).map((delay) => makeDelay(delay.cause, delay.from_at, delay.to_at, delay.note ?? undefined));
  return {
    orderedFor: row.ordered_for,
    ...(row.boarded === null ? {} : { boarded: row.boarded }),
    ...(row.let_go === null ? {} : { letGo: row.let_go }),
    ...(row.all_fast === null ? {} : { allFast: row.all_fast }),
    ...(delays.length === 0 ? {} : { delays }),
  };
}

interface CargoRow {
  movement: string;
  hazard: string;
  un_number: string | null;
  tonnes: number;
  in_ballast: number;
  note: string | null;
}

export function saveDeclaration(db: Db, declaration: CargoDeclaration): void {
  db.prepare(
    `insert into movement_cargo (movement, hazard, un_number, tonnes, in_ballast, note)
     values (?, ?, ?, ?, ?, ?)
     on conflict(movement) do update set
       hazard = excluded.hazard,
       un_number = excluded.un_number,
       tonnes = excluded.tonnes,
       in_ballast = excluded.in_ballast,
       note = excluded.note`,
  ).run(
    declaration.movement,
    declaration.hazard,
    declaration.unNumber ?? null,
    declaration.tonnes,
    declaration.inBallast ? 1 : 0,
    declaration.note ?? null,
  );
}

export function findDeclaration(db: Db, reference: string): CargoDeclaration | undefined {
  const row = db.prepare('select * from movement_cargo where movement = ?').get(reference) as
    | CargoRow
    | undefined;
  if (row === undefined) {
    return undefined;
  }
  return makeDeclaration({
    movement: row.movement,
    hazard: row.hazard,
    ...(row.un_number === null ? {} : { unNumber: row.un_number }),
    tonnes: row.tonnes,
    inBallast: row.in_ballast === 1,
    ...(row.note === null ? {} : { note: row.note }),
  });
}

export function deleteMovement(db: Db, reference: string): boolean {
  return inTransaction(db, (inner) => {
    inner.prepare('delete from movement_cargo where movement = ?').run(reference);
    inner.prepare('delete from movement_delay where movement = ?').run(reference);
    inner.prepare('delete from movement_time where movement = ?').run(reference);
    inner.prepare('delete from movement_note where movement = ?').run(reference);
    return inner.prepare('delete from movement where reference = ?').run(reference).changes > 0;
  });
}

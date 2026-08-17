/**
 * The deposits and the draws against them.
 */

import type { Db } from './database';
import { requiring } from './lookup';
import { inTransaction } from './database';
import type { Deposit, DepositDraw } from '../domain/billing/deposit';
import { makeDeposit } from '../domain/billing/deposit';

interface DepositRow {
  reference: string;
  agent: string;
  amount: number;
  lodged_at: number;
  movement: string | null;
  note: string | null;
}

interface DrawRow {
  deposit: string;
  movement: string;
  amount: number;
  at: number;
}

function toDeposit(row: DepositRow): Deposit {
  return makeDeposit({
    reference: row.reference,
    agent: row.agent,
    amount: row.amount,
    lodgedAt: row.lodged_at,
    ...(row.movement === null ? {} : { movement: row.movement }),
    ...(row.note === null ? {} : { note: row.note }),
  });
}

export function saveDeposit(db: Db, deposit: Deposit): void {
  db.prepare(
    `insert into deposit (reference, agent, amount, lodged_at, movement, note)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(
    deposit.reference,
    deposit.agent,
    deposit.amount,
    deposit.lodgedAt,
    deposit.movement ?? null,
    deposit.note ?? null,
  );
}

export function depositsFor(db: Db, agent: string): Deposit[] {
  const rows = db
    .prepare('select * from deposit where agent = ? order by lodged_at, reference')
    .all(agent) as DepositRow[];
  return rows.map(toDeposit);
}

export function findDeposit(db: Db, reference: string): Deposit | undefined {
  const row = db.prepare('select * from deposit where reference = ?').get(reference) as
    | DepositRow
    | undefined;
  return row === undefined ? undefined : toDeposit(row);
}

export const requireDeposit: (db: Db, reference: string) => Deposit = requiring(
  findDeposit,
  'deposit',
  (_db, reference) => reference,
);

export function drawsFor(db: Db, agent: string): DepositDraw[] {
  const rows = db
    .prepare(
      `select d.* from deposit_draw d join deposit p on p.reference = d.deposit
       where p.agent = ? order by d.at, d.deposit`,
    )
    .all(agent) as DrawRow[];
  return rows.map((row) => ({
    deposit: row.deposit,
    movement: row.movement,
    amount: row.amount,
    at: row.at,
  }));
}

export function recordDraws(db: Db, draws: readonly DepositDraw[]): void {
  inTransaction(db, (inner) => {
    const insert = inner.prepare(
      `insert into deposit_draw (deposit, movement, amount, at) values (?, ?, ?, ?)
       on conflict(deposit, movement) do update set amount = excluded.amount, at = excluded.at`,
    );
    for (const draw of draws) {
      insert.run(draw.deposit, draw.movement, draw.amount, draw.at);
    }
  });
}

export function drawsAgainst(db: Db, movement: string): DepositDraw[] {
  const rows = db
    .prepare('select * from deposit_draw where movement = ? order by deposit')
    .all(movement) as DrawRow[];
  return rows.map((row) => ({
    deposit: row.deposit,
    movement: row.movement,
    amount: row.amount,
    at: row.at,
  }));
}

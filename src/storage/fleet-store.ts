/**
 * Ships and agent accounts.
 *
 * Both are small aggregates that are read constantly and written rarely, so the
 * store is an upsert and a handful of finders. The domain constructors run on
 * the way out as well as on the way in: a row written by an older version of
 * this code has to satisfy today's rules or the load fails loudly rather than
 * feeding a bad ship into a clearance calculation.
 */

import type { Db } from './database';
import { requiring } from './lookup';
import type { Account } from '../domain/billing/account';
import { makeAccount } from '../domain/billing/account';
import type { Contact } from '../domain/billing/contact';
import { makeContact } from '../domain/billing/contact';
import type { Vessel, VesselType } from '../domain/vessel/vessel';
import { makeVessel } from '../domain/vessel/vessel';

interface VesselRow {
  imo: string;
  name: string;
  type: VesselType;
  length_cm: number;
  beam_cm: number;
  summer_draught_cm: number;
  air_draught_cm: number;
  gross_tonnage: number;
  deadweight: number;
  block_coefficient: number;
  bow_thruster: number;
}

interface AccountRow {
  agent: string;
  name: string;
  terms_days: number;
  discount_bps: number;
  credit_limit: number;
  stopped: number;
  requires_deposit: number;
}

function toVessel(row: VesselRow): Vessel {
  return makeVessel({
    imo: row.imo,
    name: row.name,
    type: row.type,
    length: row.length_cm,
    beam: row.beam_cm,
    summerDraught: row.summer_draught_cm,
    airDraught: row.air_draught_cm,
    grossTonnage: row.gross_tonnage,
    deadweight: row.deadweight,
    blockCoefficient: row.block_coefficient,
    bowThruster: row.bow_thruster === 1,
  });
}

export function saveVessel(db: Db, vessel: Vessel): void {
  db.prepare(
    `insert into vessel (imo, name, type, length_cm, beam_cm, summer_draught_cm, air_draught_cm,
      gross_tonnage, deadweight, block_coefficient, bow_thruster)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(imo) do update set
       name = excluded.name,
       type = excluded.type,
       length_cm = excluded.length_cm,
       beam_cm = excluded.beam_cm,
       summer_draught_cm = excluded.summer_draught_cm,
       air_draught_cm = excluded.air_draught_cm,
       gross_tonnage = excluded.gross_tonnage,
       deadweight = excluded.deadweight,
       block_coefficient = excluded.block_coefficient,
       bow_thruster = excluded.bow_thruster`,
  ).run(
    vessel.imo,
    vessel.name,
    vessel.type,
    vessel.length,
    vessel.beam,
    vessel.summerDraught,
    vessel.airDraught,
    vessel.grossTonnage,
    vessel.deadweight,
    vessel.blockCoefficient,
    vessel.bowThruster ? 1 : 0,
  );
}

export function findVessel(db: Db, imo: string): Vessel | undefined {
  const row = db.prepare('select * from vessel where imo = ?').get(imo) as VesselRow | undefined;
  return row === undefined ? undefined : toVessel(row);
}

export const requireVessel = requiring(findVessel, 'vessel', (_db, imo) => imo);

export function allVessels(db: Db): Vessel[] {
  const rows = db.prepare('select * from vessel order by name, imo').all() as VesselRow[];
  return rows.map(toVessel);
}

/** Ships whose name starts with what was typed, which is how the desk searches. */
export function vesselsNamed(db: Db, prefix: string): Vessel[] {
  const rows = db
    .prepare('select * from vessel where name like ? order by name')
    .all(`${prefix.toUpperCase()}%`) as VesselRow[];
  return rows.map(toVessel);
}

export function deleteVessel(db: Db, imo: string): boolean {
  return db.prepare('delete from vessel where imo = ?').run(imo).changes > 0;
}

function toAccount(row: AccountRow): Account {
  return makeAccount({
    agent: row.agent,
    name: row.name,
    termsDays: row.terms_days,
    discount: row.discount_bps,
    creditLimit: row.credit_limit,
    stopped: row.stopped === 1,
    requiresDeposit: row.requires_deposit === 1,
  });
}

export function saveAccount(db: Db, account: Account): void {
  db.prepare(
    `insert into account (agent, name, terms_days, discount_bps, credit_limit, stopped, requires_deposit)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(agent) do update set
       name = excluded.name,
       terms_days = excluded.terms_days,
       discount_bps = excluded.discount_bps,
       credit_limit = excluded.credit_limit,
       stopped = excluded.stopped,
       requires_deposit = excluded.requires_deposit`,
  ).run(
    account.agent,
    account.name,
    account.termsDays,
    account.discount,
    account.creditLimit,
    account.stopped ? 1 : 0,
    account.requiresDeposit ? 1 : 0,
  );
}

export function findAccount(db: Db, agent: string): Account | undefined {
  const row = db.prepare('select * from account where agent = ?').get(agent) as
    | AccountRow
    | undefined;
  return row === undefined ? undefined : toAccount(row);
}

export const requireAccount = requiring(findAccount, 'account', (_db, agent) => agent);

export function allAccounts(db: Db): Account[] {
  const rows = db.prepare('select * from account order by agent').all() as AccountRow[];
  return rows.map(toAccount);
}

export function stoppedAccounts(db: Db): Account[] {
  return allAccounts(db).filter((account) => account.stopped);
}

interface ContactRow {
  agent: string;
  name: string;
  role: string;
  email: string | null;
  telephone: string | null;
  takes_notices: number;
}

function toContact(row: ContactRow): Contact {
  return makeContact({
    agent: row.agent,
    name: row.name,
    role: row.role,
    ...(row.email === null ? {} : { email: row.email }),
    ...(row.telephone === null ? {} : { telephone: row.telephone }),
    takesNotices: row.takes_notices === 1,
  });
}

export function saveContact(db: Db, contact: Contact): void {
  db.prepare(
    `insert into contact (agent, name, role, email, telephone, takes_notices)
     values (?, ?, ?, ?, ?, ?)
     on conflict(agent, name, role) do update set
       email = excluded.email,
       telephone = excluded.telephone,
       takes_notices = excluded.takes_notices`,
  ).run(
    contact.agent,
    contact.name,
    contact.role,
    contact.email ?? null,
    contact.telephone ?? null,
    contact.takesNotices ? 1 : 0,
  );
}

export function allContacts(db: Db): Contact[] {
  const rows = db.prepare('select * from contact order by agent, role, name').all() as ContactRow[];
  return rows.map(toContact);
}

export function contactsForAgent(db: Db, agent: string): Contact[] {
  const rows = db
    .prepare('select * from contact where agent = ? order by role, name')
    .all(agent) as ContactRow[];
  return rows.map(toContact);
}

export function deleteContact(db: Db, agent: string, name: string, role: string): boolean {
  return (
    db
      .prepare('delete from contact where agent = ? and name = ? and role = ?')
      .run(agent, name, role).changes > 0
  );
}

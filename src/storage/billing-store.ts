/**
 * Tariff books, invoices, credit notes and money received.
 *
 * The invoices are the part of this system that has to be reproducible years
 * later, so nothing here updates an issued invoice's lines. The only column
 * that moves on an issued invoice is its status, and there is a method for that
 * and no other way in.
 */

import { InputError, NotFoundError } from '../util/errors';
import type { Minute } from '../util/clock';
import type { Db } from './database';
import { inTransaction } from './database';
import type { TariffBook, UnitBand } from '../domain/tariff/book';
import { makeBook } from '../domain/tariff/book';
import type { Invoice, InvoiceItem, InvoiceStatus } from '../domain/billing/invoice';
import { makeInvoice } from '../domain/billing/invoice';
import type { CreditNote, CreditReason } from '../domain/billing/credit';
import type { Allocation, Payment } from '../domain/billing/ledger';
import { makePayment } from '../domain/billing/ledger';

interface BookRow {
  id: string;
  effective_from: number;
  currency: string;
  minimum_charge: number;
  detention_block: number;
  boat_fee: number;
  admin_fee: number;
}

interface BandRow {
  book: string;
  up_to: number;
  charge: number;
  per_unit: number;
}

interface MultiplierRow {
  book: string;
  kind: string;
  multiplier: number;
}

interface InvoiceRow {
  number: string;
  agent: string;
  status: InvoiceStatus;
  raised_at: number;
  due_at: number;
  currency: string;
  tax_bps: number;
}

interface LineRow {
  invoice: string;
  seq: number;
  movement: string;
  code: string;
  description: string;
  amount: number;
}

interface CreditRow {
  number: string;
  invoice: string;
  agent: string;
  reason: CreditReason;
  amount: number;
  raised_at: number;
  note: string;
}

interface PaymentRow {
  reference: string;
  agent: string;
  amount: number;
  received_at: number;
}

export function saveBook(db: Db, book: TariffBook): void {
  inTransaction(db, (inner) => {
    inner
      .prepare(
        `insert into tariff_book (id, effective_from, currency, minimum_charge, detention_block,
          boat_fee, admin_fee)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           effective_from = excluded.effective_from,
           currency = excluded.currency,
           minimum_charge = excluded.minimum_charge,
           detention_block = excluded.detention_block,
           boat_fee = excluded.boat_fee,
           admin_fee = excluded.admin_fee`,
      )
      .run(
        book.id,
        book.effectiveFrom,
        book.currency,
        book.minimumCharge,
        book.detentionBlock,
        book.boatFee,
        book.adminFee,
      );
    inner.prepare('delete from tariff_band where book = ?').run(book.id);
    inner.prepare('delete from tariff_multiplier where book = ?').run(book.id);
    const band = inner.prepare(
      'insert into tariff_band (book, up_to, charge, per_unit) values (?, ?, ?, ?)',
    );
    for (const each of book.bands) {
      band.run(book.id, each.upTo, each.charge, each.perUnit);
    }
    const multiplier = inner.prepare(
      'insert into tariff_multiplier (book, kind, multiplier) values (?, ?, ?)',
    );
    for (const [kind, value] of Object.entries(book.kindMultiplier)) {
      multiplier.run(book.id, kind, value);
    }
  });
}

function toBook(db: Db, row: BookRow): TariffBook {
  const bands: UnitBand[] = (
    db.prepare('select * from tariff_band where book = ? order by up_to').all(row.id) as BandRow[]
  ).map((band) => ({ upTo: band.up_to, charge: band.charge, perUnit: band.per_unit }));
  const multipliers = db
    .prepare('select * from tariff_multiplier where book = ? order by kind')
    .all(row.id) as MultiplierRow[];
  return makeBook({
    id: row.id,
    effectiveFrom: row.effective_from,
    currency: row.currency,
    bands,
    minimumCharge: row.minimum_charge,
    detentionBlock: row.detention_block,
    boatFee: row.boat_fee,
    adminFee: row.admin_fee,
    kindMultiplier: Object.fromEntries(multipliers.map((each) => [each.kind, each.multiplier])),
  });
}

export function allBooks(db: Db): TariffBook[] {
  const rows = db.prepare('select * from tariff_book order by effective_from').all() as BookRow[];
  return rows.map((row) => toBook(db, row));
}

export function findBookById(db: Db, id: string): TariffBook | undefined {
  const row = db.prepare('select * from tariff_book where id = ?').get(id) as BookRow | undefined;
  return row === undefined ? undefined : toBook(db, row);
}

export function saveInvoice(db: Db, invoice: Invoice): void {
  const existing = db.prepare('select status from invoice where number = ?').get(invoice.number) as
    | { status: InvoiceStatus }
    | undefined;
  if (existing !== undefined && existing.status !== 'draft') {
    throw new InputError(`invoice ${invoice.number} has been issued and cannot be rewritten`, {
      status: existing.status,
    });
  }
  inTransaction(db, (inner) => {
    inner
      .prepare(
        `insert into invoice (number, agent, status, raised_at, due_at, currency, tax_bps)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(number) do update set
           agent = excluded.agent,
           status = excluded.status,
           raised_at = excluded.raised_at,
           due_at = excluded.due_at,
           currency = excluded.currency,
           tax_bps = excluded.tax_bps`,
      )
      .run(
        invoice.number,
        invoice.agent,
        invoice.status,
        invoice.raisedAt,
        invoice.dueAt,
        invoice.currency,
        invoice.taxRate,
      );
    inner.prepare('delete from invoice_line where invoice = ?').run(invoice.number);
    const line = inner.prepare(
      `insert into invoice_line (invoice, seq, movement, code, description, amount)
       values (?, ?, ?, ?, ?, ?)`,
    );
    let seq = 0;
    for (const item of invoice.items) {
      for (const each of item.lines) {
        seq += 1;
        line.run(invoice.number, seq, item.movement, each.code, each.description, each.amount);
      }
    }
  });
}

/** The only change allowed to an issued invoice. */
export function setInvoiceStatus(db: Db, number: string, status: InvoiceStatus): void {
  const changed = db
    .prepare('update invoice set status = ? where number = ?')
    .run(status, number).changes;
  if (changed === 0) {
    throw new NotFoundError('invoice', number);
  }
}

function toInvoice(db: Db, row: InvoiceRow): Invoice {
  const lines = db
    .prepare('select * from invoice_line where invoice = ? order by seq')
    .all(row.number) as LineRow[];
  const items: InvoiceItem[] = [];
  for (const line of lines) {
    const current = items.at(-1);
    if (current !== undefined && current.movement === line.movement) {
      items[items.length - 1] = {
        movement: current.movement,
        lines: [
          ...current.lines,
          { code: line.code, description: line.description, amount: line.amount },
        ],
      };
      continue;
    }
    items.push({
      movement: line.movement,
      lines: [{ code: line.code, description: line.description, amount: line.amount }],
    });
  }
  return makeInvoice({
    number: row.number,
    agent: row.agent,
    status: row.status,
    raisedAt: row.raised_at,
    dueAt: row.due_at,
    currency: row.currency,
    taxRate: row.tax_bps,
    items,
  });
}

export function findInvoice(db: Db, number: string): Invoice | undefined {
  const row = db.prepare('select * from invoice where number = ?').get(number) as
    | InvoiceRow
    | undefined;
  return row === undefined ? undefined : toInvoice(db, row);
}

export function invoicesForAgent(db: Db, agent: string): Invoice[] {
  const rows = db
    .prepare('select * from invoice where agent = ? order by raised_at, number')
    .all(agent) as InvoiceRow[];
  return rows.map((row) => toInvoice(db, row));
}

export function invoicesRaisedIn(db: Db, from: Minute, to: Minute): Invoice[] {
  const rows = db
    .prepare('select * from invoice where raised_at between ? and ? order by raised_at, number')
    .all(from, to) as InvoiceRow[];
  return rows.map((row) => toInvoice(db, row));
}

export function invoiceNumbersIssuedIn(db: Db, year: number): string[] {
  const rows = db
    .prepare('select number from invoice where number like ? order by number')
    .all(`INV-${year}-%`) as { number: string }[];
  return rows.map((row) => row.number);
}

export function saveCredit(db: Db, credit: CreditNote): void {
  db.prepare(
    `insert into credit_note (number, invoice, agent, reason, amount, raised_at, note)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    credit.number,
    credit.invoice,
    credit.agent,
    credit.reason,
    credit.amount,
    credit.raisedAt,
    credit.note,
  );
}

export function creditsForAgent(db: Db, agent: string): CreditNote[] {
  const rows = db
    .prepare('select * from credit_note where agent = ? order by raised_at, number')
    .all(agent) as CreditRow[];
  return rows.map((row) => ({
    number: row.number,
    invoice: row.invoice,
    agent: row.agent,
    reason: row.reason,
    amount: row.amount,
    raisedAt: row.raised_at,
    note: row.note,
  }));
}

export function savePayment(db: Db, payment: Payment, allocations: readonly Allocation[]): void {
  inTransaction(db, (inner) => {
    inner
      .prepare('insert into payment (reference, agent, amount, received_at) values (?, ?, ?, ?)')
      .run(payment.reference, payment.agent, payment.amount, payment.receivedAt);
    const allocation = inner.prepare(
      'insert into payment_allocation (payment, invoice, amount) values (?, ?, ?)',
    );
    for (const each of allocations) {
      allocation.run(payment.reference, each.invoice, each.amount);
    }
  });
}

export function paymentsForAgent(db: Db, agent: string): Payment[] {
  const rows = db
    .prepare('select * from payment where agent = ? order by received_at, reference')
    .all(agent) as PaymentRow[];
  return rows.map((row) =>
    makePayment({
      reference: row.reference,
      agent: row.agent,
      amount: row.amount,
      receivedAt: row.received_at,
    }),
  );
}

export function allocationsFor(db: Db, agent: string): Allocation[] {
  const rows = db
    .prepare(
      `select a.invoice as invoice, a.amount as amount
       from payment_allocation a join payment p on p.reference = a.payment
       where p.agent = ?
       order by a.invoice`,
    )
    .all(agent) as { invoice: string; amount: number }[];
  return rows.map((row) => ({ invoice: row.invoice, amount: row.amount }));
}

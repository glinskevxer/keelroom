/**
 * Turning finished movements into money.
 *
 * Pricing is done against the tariff book in force when the ship moved, and the
 * book id is written onto the movement the first time it is priced. That is what
 * makes an invoice reproducible: reprinting one raised two years ago prices it
 * on the book it was priced on then, whatever books have been published since.
 */

import { InputError, NotFoundError } from '../util/errors';
import type { Minute } from '../util/clock';
import type { Cents } from '../util/units';
import { bookAt, requireBook } from '../domain/tariff/book';
import type { TariffBook } from '../domain/tariff/book';
import type { Assessment } from '../domain/tariff/assess';
import { assessMovement } from '../domain/tariff/assess';
import { detentionBlocks } from '../domain/movement/times';
import type { Movement } from '../domain/movement/movement';
import { noticeHours } from '../domain/movement/movement';
import type { Invoice, InvoiceItem } from '../domain/billing/invoice';
import { makeInvoice, nextInvoiceNumber } from '../domain/billing/invoice';
import { dueDate } from '../domain/billing/account';
import { requireAccount, requireVessel } from '../storage/fleet-store';
import { drawDown } from '../domain/billing/deposit';
import { depositsFor, drawsFor, recordDraws } from '../storage/deposit-store';
import { allBooks, invoiceNumbersIssuedIn, saveInvoice } from '../storage/billing-store';
import {
  findTimes,
  movementsInWindow,
  requireMovement,
  saveMovement,
} from '../storage/movement-store';
import type { Context } from './context';
import { localYear } from './context';

export function booksFor(context: Context): TariffBook[] {
  const books = allBooks(context.db);
  if (books.length === 0) {
    throw new NotFoundError('tariff book', context.config.district);
  }
  return books;
}

export function bookForMovement(context: Context, movement: Movement, held?: string): TariffBook {
  const books = booksFor(context);
  if (held !== undefined) {
    return requireBook(books, held);
  }
  return bookAt(books, movement.plannedFor ?? movement.requestedFor);
}

export interface PriceResult {
  readonly movement: Movement;
  readonly assessment: Assessment;
}

/** Price one movement, and remember which book it was priced on. */
export function priceMovement(context: Context, reference: string): PriceResult {
  const movement = requireMovement(context.db, reference);
  const vessel = requireVessel(context.db, movement.vessel);
  const account = requireAccount(context.db, movement.agent);
  const book = bookForMovement(context, movement);
  const times = findTimes(context.db, reference);
  const at = movement.plannedFor ?? movement.requestedFor;
  const cancelled =
    movement.status === 'cancelled'
      ? { status: movement.status, byDistrict: cancelledByDistrict(movement) }
      : undefined;
  const assessment = assessMovement({
    book,
    calendar: context.config.calendar,
    offset: context.district.offset,
    vessel,
    kind: movement.kind,
    draught: movement.draught,
    at,
    noticeHours: noticeHours(movement),
    detentionBlocks: times === undefined ? 0 : detentionBlocks(times, context.config.detention),
    discount: account.discount,
    surcharges: context.config.surcharges,
    penalties: context.config.penalties,
    ...(cancelled === undefined ? {} : { cancelled }),
  });
  saveMovement(context.db, movement, book.id);
  return { movement, assessment };
}

function cancelledByDistrict(movement: Movement): boolean {
  return movement.notes.some((note) => note.toLowerCase().includes('district'));
}

export interface InvoiceRequest {
  readonly agent: string;
  /** Movements finishing inside this window are billed. */
  readonly from: Minute;
  readonly to: Minute;
  readonly raisedAt?: Minute;
}

export interface InvoiceResult {
  readonly invoice: Invoice;
  readonly movements: readonly string[];
  readonly total: Cents;
}

/** Raise one invoice for everything an agent has run in a period. */
export function raiseInvoice(context: Context, request: InvoiceRequest): InvoiceResult {
  const account = requireAccount(context.db, request.agent);
  const billable = movementsInWindow(context.db, request.from, request.to).filter(
    (movement) =>
      movement.agent === request.agent &&
      (movement.status === 'completed' || movement.status === 'cancelled'),
  );
  if (billable.length === 0) {
    throw new InputError(`there is nothing to bill ${request.agent} for that period`);
  }
  const raisedAt = request.raisedAt ?? context.now();
  const items: InvoiceItem[] = billable.map((movement) => ({
    movement: movement.reference,
    lines: priceMovement(context, movement.reference).assessment.lines,
  }));
  const year = localYear(context, raisedAt);
  const invoice = makeInvoice({
    number: nextInvoiceNumber(year, invoiceNumbersIssuedIn(context.db, year)),
    agent: account.agent,
    raisedAt,
    dueAt: dueDate(account, raisedAt),
    items,
    taxRate: context.config.taxRate,
  });
  saveInvoice(context.db, invoice);
  return {
    invoice,
    movements: billable.map((movement) => movement.reference),
    total: items.reduce(
      (sum, item) => sum + item.lines.reduce((lines, line) => lines + line.amount, 0),
      0,
    ),
  };
}

/** What one movement would cost, without writing anything. */
export interface DrawResult {
  readonly drawn: Cents;
  readonly short: Cents;
}

/**
 * Run a movement's charge down against whatever the agent has lodged, and say
 * what is left to invoice. A movement that a deposit covers in full is still
 * invoiced; the invoice simply reads as paid the moment it is issued.
 */
export function drawFromDeposits(context: Context, reference: string): DrawResult {
  const movement = requireMovement(context.db, reference);
  const assessment = quoteMovement(context, reference);
  const result = drawDown({
    agent: movement.agent,
    movement: reference,
    amount: assessment.total,
    at: context.now(),
    deposits: depositsFor(context.db, movement.agent),
    draws: drawsFor(context.db, movement.agent),
  });
  recordDraws(context.db, result.draws);
  return {
    drawn: result.draws.reduce((total, draw) => total + draw.amount, 0),
    short: result.short,
  };
}

export function quoteMovement(context: Context, reference: string): Assessment {
  const movement = requireMovement(context.db, reference);
  const vessel = requireVessel(context.db, movement.vessel);
  const account = requireAccount(context.db, movement.agent);
  const book = bookForMovement(context, movement);
  return assessMovement({
    book,
    calendar: context.config.calendar,
    offset: context.district.offset,
    vessel,
    kind: movement.kind,
    draught: movement.draught,
    at: movement.plannedFor ?? movement.requestedFor,
    noticeHours: noticeHours(movement),
    discount: account.discount,
    surcharges: context.config.surcharges,
    penalties: context.config.penalties,
  });
}

import { afterEach, describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { NotFoundError } from '../../../src/util/errors';
import { makeAccount } from '../../../src/domain/billing/account';
import { makeBook } from '../../../src/domain/tariff/book';
import { makeLine } from '../../../src/domain/tariff/charge';
import { makeInvoice, moveTo, netTotal } from '../../../src/domain/billing/invoice';
import type { Invoice } from '../../../src/domain/billing/invoice';
import { raiseCredit } from '../../../src/domain/billing/credit';
import { allocate, makePayment } from '../../../src/domain/billing/ledger';
import { migrate } from '../../../src/storage/migrate';
import { saveAccount } from '../../../src/storage/fleet-store';
import {
  allBooks,
  allocationsFor,
  creditsForAgent,
  findBookById,
  findInvoice,
  invoiceNumbersIssuedIn,
  invoicesForAgent,
  invoicesRaisedIn,
  paymentsForAgent,
  saveBook,
  saveCredit,
  saveInvoice,
  savePayment,
  setInvoiceStatus,
} from '../../../src/storage/billing-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

const JAN = parseInstant('2025-01-01T00:00Z');
const JUN = parseInstant('2025-06-30T09:00Z');

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

const BOOK = makeBook({
  id: 'T-2025-A',
  effectiveFrom: JAN,
  bands: [
    { upTo: 100, charge: 45000, perUnit: 0 },
    { upTo: 1000, charge: 45000, perUnit: 320 },
  ],
  minimumCharge: 40000,
  detentionBlock: 12000,
  boatFee: 25000,
  adminFee: 3500,
  kindMultiplier: { shift: 700 },
});

function ready(): TempDatabase {
  temp = temporaryDatabase();
  migrate(temp.db);
  saveAccount(temp.db, makeAccount({ agent: 'SEAWAY', name: 'Seaway Agencies' }));
  return temp;
}

function invoice(number = 'INV-2025-00042', raised = JUN): Invoice {
  return makeInvoice({
    number,
    agent: 'SEAWAY',
    raisedAt: raised,
    dueAt: raised + 30 * 1440,
    taxRate: 1500,
    items: [
      {
        movement: 'M-2025-0004',
        lines: [makeLine('PILOTAGE', 'pilotage', 100000), makeLine('BOAT', 'boat', 25000)],
      },
      { movement: 'M-2025-0005', lines: [makeLine('PILOTAGE', 'pilotage', 60000)] },
    ],
  });
}

describe('tariff books', () => {
  it('come back with their bands and multipliers', () => {
    const one = ready();
    saveBook(one.db, BOOK);
    const loaded = findBookById(one.db, 'T-2025-A')!;
    expect(loaded).toEqual(BOOK);
  });

  it('replace the bands on a second save', () => {
    const one = ready();
    saveBook(one.db, BOOK);
    saveBook(one.db, makeBook({ ...BOOK, bands: [{ upTo: 500, charge: 1000, perUnit: 10 }] }));
    expect(findBookById(one.db, 'T-2025-A')?.bands).toHaveLength(1);
  });

  it('list in the order they took effect', () => {
    const one = ready();
    saveBook(one.db, makeBook({ ...BOOK, id: 'T-2026-A', effectiveFrom: JAN + 400000 }));
    saveBook(one.db, BOOK);
    expect(allBooks(one.db).map((book) => book.id)).toEqual(['T-2025-A', 'T-2026-A']);
    expect(findBookById(one.db, 'T-1999-A')).toBeUndefined();
  });
});

describe('invoices', () => {
  it('come back with their items grouped by movement', () => {
    const one = ready();
    saveInvoice(one.db, invoice());
    const loaded = findInvoice(one.db, 'INV-2025-00042')!;
    expect(loaded.items.map((item) => item.movement)).toEqual(['M-2025-0004', 'M-2025-0005']);
    expect(loaded.items[0]?.lines).toHaveLength(2);
    expect(netTotal(loaded)).toBe(netTotal(invoice()));
  });

  it('refuse to rewrite one that has been issued', () => {
    const one = ready();
    saveInvoice(one.db, invoice());
    setInvoiceStatus(one.db, 'INV-2025-00042', 'issued');
    expect(() => saveInvoice(one.db, invoice())).toThrow(/cannot be rewritten/);
  });

  it('let the status move on an issued one', () => {
    const one = ready();
    saveInvoice(one.db, moveTo(invoice(), 'issued'));
    setInvoiceStatus(one.db, 'INV-2025-00042', 'paid');
    expect(findInvoice(one.db, 'INV-2025-00042')?.status).toBe('paid');
    expect(() => setInvoiceStatus(one.db, 'INV-2025-99999', 'paid')).toThrow(NotFoundError);
  });

  it('are found by agent, by date and by year', () => {
    const one = ready();
    saveInvoice(one.db, invoice());
    saveInvoice(one.db, invoice('INV-2025-00043', JUN + 10000));
    expect(invoicesForAgent(one.db, 'SEAWAY')).toHaveLength(2);
    expect(invoicesRaisedIn(one.db, JUN - 10, JUN + 10)).toHaveLength(1);
    expect(invoiceNumbersIssuedIn(one.db, 2025)).toEqual(['INV-2025-00042', 'INV-2025-00043']);
    expect(invoiceNumbersIssuedIn(one.db, 2026)).toEqual([]);
  });

  it('give nothing for one that is not there', () => {
    const one = ready();
    expect(findInvoice(one.db, 'INV-2025-00001')).toBeUndefined();
  });
});

describe('credits and payments', () => {
  it('store a credit note against its invoice', () => {
    const one = ready();
    const issued = moveTo(invoice(), 'issued');
    saveInvoice(one.db, issued);
    const credit = raiseCredit({
      number: 'CRN-2025-00001',
      invoice: issued,
      reason: 'goodwill',
      amount: 10000,
      raisedAt: JUN,
      note: 'delay was ours',
    });
    saveCredit(one.db, credit);
    expect(creditsForAgent(one.db, 'SEAWAY')).toEqual([credit]);
    expect(creditsForAgent(one.db, 'NOBODY')).toEqual([]);
  });

  it('store a payment with what it was set against', () => {
    const one = ready();
    const issued = moveTo(invoice(), 'issued');
    saveInvoice(one.db, issued);
    const payment = makePayment({
      reference: 'TT 44812',
      agent: 'SEAWAY',
      amount: 100000,
      receivedAt: JUN + 1440,
    });
    const result = allocate(payment, [issued]);
    savePayment(one.db, payment, result.allocations);
    expect(paymentsForAgent(one.db, 'SEAWAY')).toEqual([payment]);
    expect(allocationsFor(one.db, 'SEAWAY')).toEqual([
      { invoice: 'INV-2025-00042', amount: 100000 },
    ]);
  });

  it('refuse a payment reference twice', () => {
    const one = ready();
    const payment = makePayment({
      reference: 'TT 44812',
      agent: 'SEAWAY',
      amount: 1000,
      receivedAt: JUN,
    });
    savePayment(one.db, payment, []);
    expect(() => savePayment(one.db, payment, [])).toThrow(/UNIQUE/);
  });
});

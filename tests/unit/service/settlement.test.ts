import { afterEach, describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError, NotFoundError } from '../../../src/util/errors';
import { makeBook } from '../../../src/domain/tariff/book';
import { netTotal } from '../../../src/domain/billing/invoice';
import { saveBook, findInvoice } from '../../../src/storage/billing-store';
import { tariffBookFor } from '../../../src/storage/movement-store';
import { placeOrder, cancelOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import {
  assignPilot,
  boardVessel,
  completeMovement,
  getUnderway,
} from '../../../src/service/dispatch';
import {
  bookForMovement,
  booksFor,
  priceMovement,
  quoteMovement,
  raiseInvoice,
} from '../../../src/service/settlement';
import { requireMovement } from '../../../src/storage/movement-store';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

const BOOK = makeBook({
  id: 'T-2025-A',
  effectiveFrom: parseInstant('2025-01-01T00:00Z'),
  bands: [
    { upTo: 100, charge: 45000, perUnit: 0 },
    { upTo: 400, charge: 45000, perUnit: 320 },
    { upTo: 1200, charge: 141000, perUnit: 260 },
  ],
  minimumCharge: 40000,
  detentionBlock: 12000,
  boatFee: 25000,
  adminFee: 3500,
  kindMultiplier: { shift: 700 },
});

function ready(): TestContext {
  harness = testContext();
  saveBook(harness.temp.db, BOOK);
  return harness;
}

function ranMovement(draught = 1000, boardedLate = 0): string {
  const context = harness!.context;
  const reference = placeOrder(context, {
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught,
    requestedFor: NOW + 2880,
  }).movement.reference;
  const confirmation = confirmMovement(context, { reference });
  assignPilot(context, { reference });
  const start = confirmation.startAt;
  boardVessel(context, reference, start + boardedLate);
  getUnderway(context, reference, start + boardedLate + 15);
  completeMovement(context, reference, start + boardedLate + 180);
  return reference;
}

describe('the book a movement is priced on', () => {
  it('is the one in force when she moved', () => {
    ready();
    const reference = ranMovement();
    const movement = requireMovement(harness!.temp.db, reference);
    expect(bookForMovement(harness!.context, movement).id).toBe('T-2025-A');
  });

  it('is remembered on the movement once it is priced', () => {
    ready();
    const reference = ranMovement();
    priceMovement(harness!.context, reference);
    expect(tariffBookFor(harness!.temp.db, reference)).toBe('T-2025-A');
  });

  it('is refused when the district has published no book at all', () => {
    harness = testContext();
    expect(() => booksFor(harness!.context)).toThrow(NotFoundError);
  });

  it('is the later book for a movement after it took effect', () => {
    ready();
    saveBook(
      harness!.temp.db,
      makeBook({ ...BOOK, id: 'T-2025-B', effectiveFrom: NOW - 1440, minimumCharge: 50000 }),
    );
    const reference = ranMovement();
    const movement = requireMovement(harness!.temp.db, reference);
    expect(bookForMovement(harness!.context, movement).id).toBe('T-2025-B');
  });
});

describe('pricing', () => {
  it('prices a completed movement with its lines', () => {
    ready();
    const result = priceMovement(harness!.context, ranMovement());
    expect(result.assessment.lines.map((line) => line.code)).toContain('PILOTAGE');
    expect(result.assessment.total).toBeGreaterThan(0);
  });

  it('charges detention when the pilot waited', () => {
    ready();
    const plain = priceMovement(harness!.context, ranMovement()).assessment;
    const waited = priceMovement(harness!.context, ranMovement(1000, 120)).assessment;
    expect(waited.detention).toBeGreaterThan(0);
    expect(plain.detention).toBe(0);
  });

  it('quotes without writing anything', () => {
    ready();
    const reference = ranMovement();
    const quote = quoteMovement(harness!.context, reference);
    expect(quote.total).toBeGreaterThan(0);
    expect(tariffBookFor(harness!.temp.db, reference)).toBeUndefined();
  });

  it('prices a cancelled movement on the cancellation scale', () => {
    ready();
    const reference = placeOrder(harness!.context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 1000,
      requestedFor: NOW + 2880,
    }).movement.reference;
    confirmMovement(harness!.context, { reference });
    cancelOrder(harness!.context, reference, 'ship delayed at sea');
    const assessment = priceMovement(harness!.context, reference).assessment;
    expect(assessment.lines.map((line) => line.code)).not.toContain('PILOTAGE');
    expect(assessment.surcharges).toBe(0);
  });
});

describe('raising an invoice', () => {
  it('bills everything the agent ran in the period', () => {
    ready();
    const first = ranMovement();
    const second = ranMovement();
    const result = raiseInvoice(harness!.context, {
      agent: 'SEAWAY',
      from: NOW,
      to: NOW + 10000,
      raisedAt: NOW + 10000,
    });
    expect(result.movements).toEqual([first, second]);
    expect(result.invoice.number).toBe('INV-2025-00001');
    expect(netTotal(result.invoice)).toBe(result.total);
  });

  it('saves it as a draft that can be read back', () => {
    ready();
    ranMovement();
    const result = raiseInvoice(harness!.context, {
      agent: 'SEAWAY',
      from: NOW,
      to: NOW + 10000,
      raisedAt: NOW + 10000,
    });
    const loaded = findInvoice(harness!.temp.db, result.invoice.number)!;
    expect(loaded.status).toBe('draft');
    expect(loaded.items).toHaveLength(1);
  });

  it('puts the due date on the agent terms', () => {
    ready();
    ranMovement();
    const result = raiseInvoice(harness!.context, {
      agent: 'SEAWAY',
      from: NOW,
      to: NOW + 10000,
      raisedAt: NOW + 10000,
    });
    expect(result.invoice.dueAt - result.invoice.raisedAt).toBe(30 * 1440);
  });

  it('numbers the invoices in sequence', () => {
    ready();
    ranMovement();
    raiseInvoice(harness!.context, {
      agent: 'SEAWAY',
      from: NOW,
      to: NOW + 10000,
      raisedAt: NOW + 10000,
    });
    ranMovement();
    const second = raiseInvoice(harness!.context, {
      agent: 'SEAWAY',
      from: NOW,
      to: NOW + 20000,
      raisedAt: NOW + 20000,
    });
    expect(second.invoice.number).toBe('INV-2025-00002');
  });

  it('refuses a period with nothing in it', () => {
    ready();
    expect(() =>
      raiseInvoice(harness!.context, { agent: 'SEAWAY', from: NOW, to: NOW + 100 }),
    ).toThrow(InputError);
  });

  it('leaves another agent movements alone', () => {
    ready();
    ranMovement();
    expect(() =>
      raiseInvoice(harness!.context, { agent: 'NORTH', from: NOW, to: NOW + 10000 }),
    ).toThrow(/nothing to bill NORTH/);
  });

  it('does not bill a movement that has not run', () => {
    ready();
    placeOrder(harness!.context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 1000,
      requestedFor: NOW + 2880,
    });
    expect(() =>
      raiseInvoice(harness!.context, { agent: 'SEAWAY', from: NOW, to: NOW + 10000 }),
    ).toThrow(/nothing to bill/);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeBook } from '../../../src/domain/tariff/book';
import { grossTotal } from '../../../src/domain/billing/invoice';
import { findInvoice, saveBook } from '../../../src/storage/billing-store';
import { placeOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import {
  assignPilot,
  boardVessel,
  completeMovement,
  getUnderway,
} from '../../../src/service/dispatch';
import { raiseInvoice } from '../../../src/service/settlement';
import {
  creditInvoice,
  debtors,
  issueInvoice,
  statementFor,
  takePayment,
} from '../../../src/service/collections';
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
  bands: [{ upTo: 1200, charge: 45000, perUnit: 320 }],
  minimumCharge: 40000,
  detentionBlock: 12000,
  boatFee: 25000,
  adminFee: 3500,
});

function ranMovement(): string {
  const context = harness!.context;
  const reference = placeOrder(context, {
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught: 1000,
    requestedFor: NOW + 2880,
  }).movement.reference;
  const confirmation = confirmMovement(context, { reference });
  assignPilot(context, { reference });
  boardVessel(context, reference, confirmation.startAt);
  getUnderway(context, reference, confirmation.startAt + 15);
  completeMovement(context, reference, confirmation.startAt + 180);
  return reference;
}

function billed(): string {
  harness = harness ?? testContext();
  saveBook(harness.temp.db, BOOK);
  ranMovement();
  const result = raiseInvoice(harness.context, {
    agent: 'SEAWAY',
    from: NOW,
    to: NOW + 10000,
    raisedAt: NOW + 10000,
  });
  return result.invoice.number;
}

describe('issuing', () => {
  it('moves a draft to issued', () => {
    harness = testContext();
    const number = billed();
    expect(issueInvoice(harness.context, number).status).toBe('issued');
    expect(findInvoice(harness.temp.db, number)?.status).toBe('issued');
  });

  it('refuses an invoice nobody raised', () => {
    harness = testContext();
    expect(() => issueInvoice(harness!.context, 'INV-2025-09999')).toThrow(/no invoice/);
  });

  it('refuses to issue the same invoice twice', () => {
    harness = testContext();
    const number = billed();
    issueInvoice(harness.context, number);
    expect(() => issueInvoice(harness!.context, number)).toThrow(/does not go that way/);
  });
});

describe('payments', () => {
  it('clear an invoice paid in full', () => {
    harness = testContext();
    const number = billed();
    const invoice = issueInvoice(harness.context, number);
    const result = takePayment(harness.context, {
      reference: 'TT 44812',
      agent: 'SEAWAY',
      amount: grossTotal(invoice),
      receivedAt: NOW + 20000,
    });
    expect(result.cleared).toEqual([number]);
    expect(findInvoice(harness.temp.db, number)?.status).toBe('paid');
    expect(result.unallocated).toBe(0);
  });

  it('leave a part paid invoice open', () => {
    harness = testContext();
    const number = billed();
    const invoice = issueInvoice(harness.context, number);
    const result = takePayment(harness.context, {
      reference: 'TT 44812',
      agent: 'SEAWAY',
      amount: Math.floor(grossTotal(invoice) / 2),
      receivedAt: NOW + 20000,
    });
    expect(result.cleared).toEqual([]);
    expect(findInvoice(harness.temp.db, number)?.status).toBe('issued');
  });

  it('report what is left over', () => {
    harness = testContext();
    const number = billed();
    const invoice = issueInvoice(harness.context, number);
    const result = takePayment(harness.context, {
      reference: 'TT 44812',
      agent: 'SEAWAY',
      amount: grossTotal(invoice) + 50000,
      receivedAt: NOW + 20000,
    });
    expect(result.unallocated).toBe(50000);
  });

  it('refuse a payment with nothing to set it against', () => {
    harness = testContext();
    expect(() =>
      takePayment(harness!.context, { reference: 'TT 1', agent: 'SEAWAY', amount: 1000 }),
    ).toThrow(/nothing outstanding/);
  });

  it('refuse a payment from an agent nobody has', () => {
    harness = testContext();
    expect(() =>
      takePayment(harness!.context, { reference: 'TT 1', agent: 'NOBODY', amount: 1000 }),
    ).toThrow(/no account with reference/);
  });
});

describe('credits', () => {
  it('take an amount off what is owed', () => {
    harness = testContext();
    const number = billed();
    const invoice = issueInvoice(harness.context, number);
    creditInvoice(harness.context, {
      invoice: number,
      reason: 'rate-in-error',
      amount: 10000,
      note: 'charged on the wrong band',
      raisedAt: NOW + 20000,
    });
    const statement = statementFor(harness.context, 'SEAWAY', NOW + 20000);
    expect(statement.balance).toBe(grossTotal(invoice) - 10000);
  });

  it('close an invoice credited in full', () => {
    harness = testContext();
    const number = billed();
    const invoice = issueInvoice(harness.context, number);
    creditInvoice(harness.context, {
      invoice: number,
      reason: 'movement-not-run',
      amount: grossTotal(invoice),
      note: 'ship sailed without a pilot',
      raisedAt: NOW + 20000,
    });
    expect(findInvoice(harness.temp.db, number)?.status).toBe('paid');
  });

  it('refuse a credit against an invoice nobody raised', () => {
    harness = testContext();
    expect(() =>
      creditInvoice(harness!.context, {
        invoice: 'INV-2025-09999',
        reason: 'goodwill',
        amount: 100,
        note: 'x',
      }),
    ).toThrow(InputError);
  });
});

describe('statements', () => {
  it('carry the balance, the ageing and the standing', () => {
    harness = testContext();
    const number = billed();
    const invoice = issueInvoice(harness.context, number);
    const statement = statementFor(harness.context, 'SEAWAY', NOW + 20000);
    expect(statement.balance).toBe(grossTotal(invoice));
    expect(statement.ageing.total).toBe(statement.balance);
    expect(statement.standing.canOrder).toBe(true);
    expect(statement.open).toHaveLength(1);
  });

  it('read nothing for an agent who has run nothing', () => {
    harness = testContext();
    const statement = statementFor(harness.context, 'NORTH');
    expect(statement.balance).toBe(0);
    expect(statement.open).toEqual([]);
  });

  it('list the debtors worst first', () => {
    harness = testContext();
    const number = billed();
    issueInvoice(harness.context, number);
    const list = debtors(harness.context, ['SEAWAY', 'NORTH'], NOW + 20000);
    expect(list.map((statement) => statement.agent)).toEqual(['SEAWAY']);
  });
});

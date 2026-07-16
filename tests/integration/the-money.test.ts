/**
 * The money, from a deposit to a settled dispute.
 *
 * Each piece has its own tests. This is about the joins: that a deposit is not a
 * payment, that a credit note and a payment do not both clear the same money,
 * that a dispute stops the chasing without losing the debt, and that the ledger
 * still adds up at the end of it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY } from '../../src/util/clock';
import { grossTotal, netTotal } from '../../src/domain/billing/invoice';
import { heldFor } from '../../src/domain/billing/deposit';
import { openFor } from '../../src/domain/billing/dispute';
import { saveBook, disputesForAgent, findInvoice } from '../../src/storage/billing-store';
import { depositsFor, drawsFor, saveDeposit } from '../../src/storage/deposit-store';
import { makeDeposit } from '../../src/domain/billing/deposit';
import { placeOrder } from '../../src/service/ordering';
import { confirmMovement } from '../../src/service/planning';
import {
  assignPilot,
  boardVessel,
  completeMovement,
  getUnderway,
} from '../../src/service/dispatch';
import { drawFromDeposits, raiseInvoice } from '../../src/service/settlement';
import {
  creditInvoice,
  disputeInvoice,
  issueInvoice,
  settleDispute,
  statementFor,
  takePayment,
} from '../../src/service/collections';
import { checkDatabase } from '../../src/storage/backup';
import { NOW, testContext } from '../support/context';
import type { TestContext } from '../support/context';
import { TARIFF } from '../support/cli';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function ready(): TestContext {
  harness = testContext();
  saveBook(harness.temp.db, TARIFF);
  return harness;
}

function ranMovement(agent = 'SEAWAY', draught = 1000, offsetDays = 1): string {
  const context = harness!.context;
  const reference = placeOrder(context, {
    kind: 'arrival',
    vessel: '9074729',
    agent,
    from: 'SEA',
    to: 'GRAIN-3',
    draught,
    requestedFor: NOW + offsetDays * MINUTES_PER_DAY,
  }).movement.reference;
  const confirmation = confirmMovement(context, { reference });
  assignPilot(context, { reference });
  boardVessel(context, reference, confirmation.startAt);
  getUnderway(context, reference, confirmation.startAt + 15);
  completeMovement(context, reference, confirmation.startAt + 190);
  return reference;
}

function billed(agent = 'SEAWAY'): string {
  const result = raiseInvoice(harness!.context, {
    agent,
    from: NOW,
    to: NOW + 5 * MINUTES_PER_DAY,
    raisedAt: NOW + 5 * MINUTES_PER_DAY,
  });
  return result.invoice.number;
}

describe('a deposit is not a payment', () => {
  it('is drawn down by a movement and what is left is still the agent money', () => {
    ready();
    saveDeposit(
      harness!.temp.db,
      makeDeposit({ reference: 'DEP-001', agent: 'NORTH', amount: 1000000, lodgedAt: NOW }),
    );
    const reference = ranMovement('NORTH');
    const drawn = drawFromDeposits(harness!.context, reference);
    expect(drawn.drawn).toBeGreaterThan(0);
    expect(drawn.short).toBe(0);
    const left = heldFor(
      'NORTH',
      depositsFor(harness!.temp.db, 'NORTH'),
      drawsFor(harness!.temp.db, 'NORTH'),
    );
    expect(left).toBe(1000000 - drawn.drawn);
  });

  it('leaves the rest to invoice when it does not cover the movement', () => {
    ready();
    saveDeposit(
      harness!.temp.db,
      makeDeposit({ reference: 'DEP-002', agent: 'NORTH', amount: 5000, lodgedAt: NOW }),
    );
    const reference = ranMovement('NORTH');
    const drawn = drawFromDeposits(harness!.context, reference);
    expect(drawn.drawn).toBe(5000);
    expect(drawn.short).toBeGreaterThan(0);
  });
});

describe('a credit and a payment do not clear the same money twice', () => {
  it('leaves the balance at nothing and no more', () => {
    ready();
    ranMovement();
    const number = billed();
    const invoice = issueInvoice(harness!.context, number);
    const gross = grossTotal(invoice);
    creditInvoice(harness!.context, {
      invoice: number,
      reason: 'rate-in-error',
      amount: 10000,
      note: 'charged on the wrong band',
      raisedAt: NOW + 6 * MINUTES_PER_DAY,
    });
    const payment = takePayment(harness!.context, {
      reference: 'TT 70001',
      agent: 'SEAWAY',
      amount: gross - 10000,
      receivedAt: NOW + 7 * MINUTES_PER_DAY,
    });
    expect(payment.cleared).toEqual([number]);
    expect(payment.unallocated).toBe(0);
    expect(statementFor(harness!.context, 'SEAWAY', NOW + 7 * MINUTES_PER_DAY).balance).toBe(0);
  });

  it('refuses a payment once there is nothing left to set it against', () => {
    ready();
    ranMovement();
    const number = billed();
    const invoice = issueInvoice(harness!.context, number);
    takePayment(harness!.context, {
      reference: 'TT 70002',
      agent: 'SEAWAY',
      amount: grossTotal(invoice),
      receivedAt: NOW + 7 * MINUTES_PER_DAY,
    });
    expect(() =>
      takePayment(harness!.context, {
        reference: 'TT 70003',
        agent: 'SEAWAY',
        amount: 1000,
        receivedAt: NOW + 8 * MINUTES_PER_DAY,
      }),
    ).toThrow(/nothing outstanding/);
  });
});

describe('a dispute stops the chasing without losing the debt', () => {
  it('shows on the statement as disputed and still in the balance', () => {
    ready();
    ranMovement();
    const number = billed();
    const invoice = issueInvoice(harness!.context, number);
    disputeInvoice(harness!.context, {
      invoice: number,
      ground: 'wrong-units',
      amount: 25000,
      note: 'her units are read off the wrong beam',
      raisedAt: NOW + 6 * MINUTES_PER_DAY,
    });
    const statement = statementFor(harness!.context, 'SEAWAY', NOW + 6 * MINUTES_PER_DAY);
    expect(statement.disputed).toBe(25000);
    expect(statement.balance).toBe(grossTotal(invoice));
    expect(findInvoice(harness!.temp.db, number)?.status).toBe('disputed');
  });

  it('goes back on the chasing list when it is answered', () => {
    ready();
    ranMovement();
    const number = billed();
    issueInvoice(harness!.context, number);
    disputeInvoice(harness!.context, {
      invoice: number,
      ground: 'wrong-rate',
      amount: 25000,
      note: 'the rate is not the one we agreed',
      raisedAt: NOW + 6 * MINUTES_PER_DAY,
    });
    settleDispute(harness!.context, number, 'rejected', 'the rate is the published one');
    expect(findInvoice(harness!.temp.db, number)?.status).toBe('issued');
    expect(openFor(disputesForAgent(harness!.temp.db, 'SEAWAY'), 'SEAWAY')).toEqual([]);
    expect(statementFor(harness!.context, 'SEAWAY', NOW + 7 * MINUTES_PER_DAY).disputed).toBe(0);
  });

  it('is settled by a credit when the agent was right', () => {
    ready();
    ranMovement();
    const number = billed();
    const invoice = issueInvoice(harness!.context, number);
    disputeInvoice(harness!.context, {
      invoice: number,
      ground: 'detention-not-ours',
      amount: 12000,
      note: 'the tug was late and that is the district',
      raisedAt: NOW + 6 * MINUTES_PER_DAY,
    });
    settleDispute(harness!.context, number, 'upheld', 'the tug was ours, credit raised');
    creditInvoice(harness!.context, {
      invoice: number,
      reason: 'rate-in-error',
      amount: 12000,
      note: 'the detention was ours',
      raisedAt: NOW + 7 * MINUTES_PER_DAY,
    });
    const statement = statementFor(harness!.context, 'SEAWAY', NOW + 7 * MINUTES_PER_DAY);
    expect(statement.balance).toBe(grossTotal(invoice) - 12000);
    expect(statement.disputed).toBe(0);
  });
});

describe('the ledger adds up', () => {
  it('after a month of movements, credits, payments and a dispute', () => {
    ready();
    for (let day = 1; day <= 3; day += 1) {
      ranMovement('SEAWAY', 1000 + day * 10, day);
    }
    const number = billed();
    const invoice = issueInvoice(harness!.context, number);
    expect(netTotal(invoice)).toBeGreaterThan(0);
    creditInvoice(harness!.context, {
      invoice: number,
      reason: 'goodwill',
      amount: 5000,
      note: 'the delay on the second one was ours',
      raisedAt: NOW + 6 * MINUTES_PER_DAY,
    });
    disputeInvoice(harness!.context, {
      invoice: number,
      ground: 'other',
      amount: 1000,
      note: 'the boat fee is charged twice on the third movement',
      raisedAt: NOW + 6 * MINUTES_PER_DAY,
    });
    settleDispute(harness!.context, number, 'withdrawn', 'the agent read the wrong line');
    takePayment(harness!.context, {
      reference: 'TT 70010',
      agent: 'SEAWAY',
      amount: grossTotal(invoice) - 5000,
      receivedAt: NOW + 8 * MINUTES_PER_DAY,
    });
    const statement = statementFor(harness!.context, 'SEAWAY', NOW + 8 * MINUTES_PER_DAY);
    expect(statement.balance).toBe(0);
    expect(statement.open).toEqual([]);
    expect(checkDatabase(harness!.temp.db)).toEqual([]);
  });
});

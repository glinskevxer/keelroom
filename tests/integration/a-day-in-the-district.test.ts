import { afterEach, describe, expect, it } from 'vitest';
import { formatLocal } from '../../src/util/clock';
import { grossTotal } from '../../src/domain/billing/invoice';
import { placeOrder } from '../../src/service/ordering';
import { confirmMovement, planMovement } from '../../src/service/planning';
import {
  assignPilot,
  boardVessel,
  completeMovement,
  getUnderway,
} from '../../src/service/dispatch';
import { priceMovement, raiseInvoice } from '../../src/service/settlement';
import { issueInvoice, statementFor, takePayment } from '../../src/service/collections';
import { saveBook } from '../../src/storage/billing-store';
import { findTimes, requireMovement } from '../../src/storage/movement-store';
import { loadBoard } from '../../src/storage/roster-store';
import { order } from '../../src/domain/roster/board';
import { checkDatabase } from '../../src/storage/backup';
import { NOW, testContext } from '../support/context';
import type { TestContext } from '../support/context';
import { TARIFF } from '../support/cli';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('one ship, ordered to paid', () => {
  it('runs the whole way through and leaves the district sound', () => {
    harness = testContext();
    const context = harness.context;
    saveBook(context.db, TARIFF);

    // the agent orders two days out
    const order_ = placeOrder(context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 1100,
      requestedFor: NOW + 2880,
    });
    expect(order_.movement.reference).toBe('M-2025-0001');
    const reference = order_.movement.reference;

    // the planner finds her a window and the desk confirms it
    const plan = planMovement(context, { reference });
    expect(plan.result.passable).toBe(true);
    const confirmation = confirmMovement(context, { reference });
    expect(confirmation.movement.status).toBe('confirmed');
    expect(
      plan.result.windows.some(
        (window) => confirmation.startAt >= window.from && confirmation.startAt <= window.to,
      ),
    ).toBe(true);

    // a pilot is given the job and goes to the bottom of the board
    const assignment = assignPilot(context, { reference });
    expect(assignment.pilot.id).toBe('P02');
    expect(order(loadBoard(context.db)).at(-1)).toBe('P02');

    // she runs, forty minutes late on the ship's account
    const start = confirmation.startAt;
    boardVessel(context, reference, start + 40);
    getUnderway(context, reference, start + 55);
    completeMovement(context, reference, start + 210);
    const times = findTimes(context.db, reference)!;
    expect(times.allFast).toBe(start + 210);
    expect(requireMovement(context.db, reference).status).toBe('completed');

    // the job is priced on the book in force, with the detention on it
    const priced = priceMovement(context, reference);
    expect(priced.assessment.book).toBe('T-2025-A');
    expect(priced.assessment.detention).toBeGreaterThan(0);

    // and billed, issued, paid and cleared
    const invoice = raiseInvoice(context, {
      agent: 'SEAWAY',
      from: NOW,
      to: NOW + 4320,
      raisedAt: NOW + 4320,
    });
    expect(invoice.movements).toEqual([reference]);
    const issued = issueInvoice(context, invoice.invoice.number);
    const payment = takePayment(context, {
      reference: 'TT 44812',
      agent: 'SEAWAY',
      amount: grossTotal(issued),
      receivedAt: NOW + 5760,
    });
    expect(payment.cleared).toEqual([invoice.invoice.number]);
    expect(statementFor(context, 'SEAWAY', NOW + 5760).balance).toBe(0);

    // nothing in the district file is inconsistent afterwards
    expect(checkDatabase(context.db)).toEqual([]);
  });

  it('refuses a ship the tide will not take and leaves nothing half done', () => {
    harness = testContext();
    const context = harness.context;
    const order_ = placeOrder(context, {
      kind: 'anchorage',
      vessel: '9319466',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'ANCH-A',
      draught: 2000,
      requestedFor: NOW + 2880,
    });
    expect(() => confirmMovement(context, { reference: order_.movement.reference })).toThrow(
      /no window to confirm against/,
    );
    expect(requireMovement(context.db, order_.movement.reference).status).toBe('ordered');
    expect(checkDatabase(context.db)).toEqual([]);
  });

  it('keeps two movements on the same tide apart on the board', () => {
    harness = testContext();
    const context = harness.context;
    const references = ['9074729', '9074705'].map(
      (vessel, index) =>
        placeOrder(context, {
          kind: 'arrival',
          vessel,
          agent: 'SEAWAY',
          from: 'SEA',
          to: 'GRAIN-3',
          draught: index === 0 ? 1100 : 600,
          requestedFor: NOW + 2880 + index * 60,
        }).movement.reference,
    );
    const pilots = references.map((reference) => {
      confirmMovement(context, { reference });
      return assignPilot(context, { reference }).pilot.id;
    });
    expect(new Set(pilots).size).toBe(2);
    expect(formatLocal(NOW, context.district.offset)).toContain('2025-04-01');
  });
});

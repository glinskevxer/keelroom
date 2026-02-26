import { afterEach, describe, expect, it } from 'vitest';
import { makeInterval } from '../../../src/util/interval';
import { parseCsv } from '../../../src/util/csv';
import { saveBook } from '../../../src/storage/billing-store';
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
  buildExport,
  dutyExport,
  exportNames,
  invoiceExport,
  movementExport,
} from '../../../src/service/exports';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';
import { TARIFF } from '../../support/cli';

const PERIOD = makeInterval(NOW, NOW + 5760);

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
  boardVessel(context, reference, confirmation.startAt + 20);
  getUnderway(context, reference, confirmation.startAt + 35);
  completeMovement(context, reference, confirmation.startAt + 200);
  return reference;
}

describe('the movement return', () => {
  it('has a row for every movement, with the times', () => {
    ready();
    const reference = ranMovement();
    const result = movementExport(harness!.context, PERIOD);
    const table = parseCsv(result.csv);
    expect(result.rows).toBe(1);
    expect(table.rows[0]?.get('reference')).toBe(reference);
    expect(table.rows[0]?.get('vessel')).toBe('ATLANTIC CROWN');
    expect(table.rows[0]?.get('all_fast')).not.toBe('');
  });

  it('leaves the times that never happened blank', () => {
    ready();
    placeOrder(harness!.context, {
      kind: 'arrival',
      vessel: '9074705',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 600,
      requestedFor: NOW + 2880,
    });
    const table = parseCsv(movementExport(harness!.context, PERIOD).csv);
    expect(table.rows[0]?.get('boarded')).toBe('');
    expect(table.rows[0]?.get('planned_for')).toBe('');
  });

  it('reads as an empty table when nothing happened', () => {
    ready();
    const result = movementExport(harness!.context, makeInterval(NOW - 100000, NOW - 90000));
    expect(result.rows).toBe(0);
    expect(parseCsv(result.csv).columns).toContain('reference');
  });
});

describe('the invoice return', () => {
  it('has a row for every line and carries the totals', () => {
    ready();
    ranMovement();
    raiseInvoice(harness!.context, {
      agent: 'SEAWAY',
      from: NOW,
      to: NOW + 5760,
      raisedAt: NOW + 5760,
    });
    const result = invoiceExport(harness!.context, PERIOD);
    const table = parseCsv(result.csv);
    expect(result.rows).toBeGreaterThan(1);
    expect(table.rows[0]?.get('invoice')).toBe('INV-2025-00001');
    expect(table.rows[0]?.get('invoice_gross')).not.toBe('');
  });
});

describe('the duty return', () => {
  it('has a row for every job a pilot worked', () => {
    ready();
    ranMovement();
    const result = dutyExport(harness!.context, PERIOD);
    const table = parseCsv(result.csv);
    expect(result.rows).toBe(1);
    expect(table.rows[0]?.get('pilot')).toBe('P02');
    expect(Number(table.rows[0]?.get('minutes'))).toBeGreaterThan(0);
  });
});

describe('choosing one', () => {
  it('builds any of them by name', () => {
    ready();
    ranMovement();
    for (const name of exportNames()) {
      expect(buildExport(harness!.context, name, PERIOD).name).toBe(name);
    }
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { InputError, NotFoundError } from '../../../src/util/errors';
import { contextFrom } from '../../../src/service/context';
import { findMovement } from '../../../src/storage/movement-store';
import { amendOrder, cancelOrder, placeOrder, refuseOrder } from '../../../src/service/ordering';
import type { OrderRequest } from '../../../src/service/ordering';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function order(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught: 1150,
    requestedFor: NOW + 2880,
    ...overrides,
  };
}

describe('taking an order', () => {
  it('issues a reference and saves the movement', () => {
    harness = testContext();
    const result = placeOrder(harness.context, order());
    expect(result.movement.reference).toBe('M-2025-0001');
    expect(findMovement(harness.temp.db, 'M-2025-0001')?.status).toBe('ordered');
  });

  it('numbers the references in sequence', () => {
    harness = testContext();
    placeOrder(harness.context, order());
    const second = placeOrder(harness.context, order({ requestedFor: NOW + 4320 }));
    expect(second.movement.reference).toBe('M-2025-0002');
  });

  it('warns about short notice without refusing it', () => {
    harness = testContext();
    const result = placeOrder(harness.context, order({ requestedFor: NOW + 120 }));
    expect(result.findings.map((finding) => finding.rule)).toContain('ORD-SHORT-06');
    expect(result.movement.reference).toBe('M-2025-0001');
  });

  it('refuses a ship nobody has on the books', () => {
    harness = testContext();
    expect(() => placeOrder(harness!.context, order({ vessel: '9319466' }))).toThrow(NotFoundError);
  });

  it('refuses an agent nobody has', () => {
    harness = testContext();
    expect(() => placeOrder(harness!.context, order({ agent: 'NOBODY' }))).toThrow(NotFoundError);
  });

  it('refuses a berth the district does not have', () => {
    harness = testContext();
    expect(() => placeOrder(harness!.context, order({ to: 'OIL-1' }))).toThrow(/no such berth/);
  });

  it('refuses a ship longer than the berth', () => {
    harness = testContext();
    harness.temp.db.prepare('update berth set max_length_cm = 10000 where id = ?').run('GRAIN-3');
    const reloaded = contextFrom(harness.temp.db, harness.context.config, { now: () => NOW });
    expect(() => placeOrder(reloaded, order())).toThrow(/longer than the berth/);
  });

  it('refuses a draught deeper than her marks', () => {
    harness = testContext();
    expect(() => placeOrder(harness!.context, order({ draught: 1400 }))).toThrow(
      /deeper than her summer marks/,
    );
  });

  it('refuses a time that has already gone', () => {
    harness = testContext();
    expect(() => placeOrder(harness!.context, order({ requestedFor: NOW - 60 }))).toThrow(
      /already gone/,
    );
  });

  it('refuses an agent on stop', () => {
    harness = testContext();
    harness.temp.db.prepare('update account set stopped = 1 where agent = ?').run('SEAWAY');
    expect(() => placeOrder(harness!.context, order())).toThrow(/cannot take another movement/);
  });
});

describe('amending an order', () => {
  it('changes the time and clears any planned time', () => {
    harness = testContext();
    const placed = placeOrder(harness.context, order()).movement;
    const amended = amendOrder(harness.context, placed.reference, { requestedFor: NOW + 5760 });
    expect(amended.requestedFor).toBe(NOW + 5760);
    expect(amended.plannedFor).toBeUndefined();
    expect(amended.status).toBe('ordered');
  });

  it('changes the draught within her marks', () => {
    harness = testContext();
    const placed = placeOrder(harness.context, order()).movement;
    expect(amendOrder(harness.context, placed.reference, { draught: 1200 }).draught).toBe(1200);
    expect(() => amendOrder(harness!.context, placed.reference, { draught: 1400 })).toThrow(
      /deeper than her summer marks/,
    );
  });

  it('refuses to amend a movement that has sailed', () => {
    harness = testContext();
    const placed = placeOrder(harness.context, order()).movement;
    harness.temp.db
      .prepare('update movement set status = ? where reference = ?')
      .run('underway', placed.reference);
    expect(() => amendOrder(harness!.context, placed.reference, { draught: 1100 })).toThrow(
      InputError,
    );
  });

  it('refuses to amend one that is not there', () => {
    harness = testContext();
    expect(() => amendOrder(harness!.context, 'M-2025-0099', {})).toThrow(NotFoundError);
  });
});

describe('closing an order', () => {
  it('cancels with the reason on the record', () => {
    harness = testContext();
    const placed = placeOrder(harness.context, order()).movement;
    const cancelled = cancelOrder(harness.context, placed.reference, 'ship delayed at sea');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.notes[0]).toContain('ship delayed at sea');
    expect(findMovement(harness.temp.db, placed.reference)?.status).toBe('cancelled');
  });

  it('refuses with the reason on the record', () => {
    harness = testContext();
    const placed = placeOrder(harness.context, order()).movement;
    const refused = refuseOrder(harness.context, placed.reference, 'no window in the range');
    expect(refused.status).toBe('refused');
  });

  it('will not cancel twice', () => {
    harness = testContext();
    const placed = placeOrder(harness.context, order()).movement;
    cancelOrder(harness.context, placed.reference, 'ship delayed');
    expect(() => cancelOrder(harness!.context, placed.reference, 'again')).toThrow(/closed/);
  });
});

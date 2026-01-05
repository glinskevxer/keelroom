import { afterEach, describe, expect, it } from 'vitest';
import { checkAgainstTraffic, firstClearStart, trafficDay } from '../../../src/service/traffic';
import { placeOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function order(vessel: string, draught: number, kind: 'arrival' | 'departure' = 'arrival'): string {
  return placeOrder(harness!.context, {
    kind,
    vessel,
    agent: 'SEAWAY',
    from: kind === 'arrival' ? 'SEA' : 'GRAIN-3',
    to: kind === 'arrival' ? 'GRAIN-3' : 'SEA',
    draught,
    requestedFor: NOW + 2880,
  }).movement.reference;
}

describe('the day', () => {
  it('is empty when nothing is planned', () => {
    harness = testContext();
    order('9074729', 1000);
    const day = trafficDay(harness.context, NOW, 3);
    expect(day.occupancies).toEqual([]);
    expect(day.conflicts).toEqual([]);
  });

  it('lays a confirmed movement out reach by reach', () => {
    harness = testContext();
    const reference = order('9074729', 1000);
    confirmMovement(harness.context, { reference });
    const day = trafficDay(harness.context, NOW, 3);
    expect(day.movements).toEqual([reference]);
    expect(day.occupancies.map((each) => each.reach)).toEqual(['APPROACH', 'LOWER-BAR', 'UPPER']);
  });

  it('finds where two movements meet', () => {
    harness = testContext();
    const first = order('9074729', 1000);
    const confirmation = confirmMovement(harness.context, { reference: first });
    const second = order('9074705', 600, 'departure');
    confirmMovement(harness.context, { reference: second, startAt: confirmation.startAt });
    const day = trafficDay(harness.context, NOW, 3);
    expect(day.conflicts.length).toBeGreaterThan(0);
    expect(day.conflicts[0]?.kind).toBe('one-way');
  });

  it('leaves a cancelled movement out', () => {
    harness = testContext();
    const reference = order('9074729', 1000);
    confirmMovement(harness.context, { reference });
    harness.temp.db
      .prepare('update movement set status = ? where reference = ?')
      .run('cancelled', reference);
    expect(trafficDay(harness.context, NOW, 3).occupancies).toEqual([]);
  });
});

describe('checking one movement against the rest', () => {
  it('reports nothing when the channel is clear', () => {
    harness = testContext();
    const reference = order('9074729', 1000);
    const confirmation = confirmMovement(harness.context, { reference });
    expect(checkAgainstTraffic(harness.context, reference, confirmation.startAt)).toEqual([]);
  });

  it('reports what it would run into', () => {
    harness = testContext();
    const first = order('9074729', 1000);
    const confirmation = confirmMovement(harness.context, { reference: first });
    const second = order('9074705', 600, 'departure');
    const found = checkAgainstTraffic(harness.context, second, confirmation.startAt);
    expect(found.length).toBeGreaterThan(0);
  });

  it('finds the first start that is clear', () => {
    harness = testContext();
    const first = order('9074729', 1000);
    const confirmation = confirmMovement(harness.context, { reference: first });
    const second = order('9074705', 600, 'departure');
    const clear = firstClearStart(harness.context, second, confirmation.startAt, {
      step: 30,
      tries: 20,
    });
    expect(clear).toBeGreaterThan(confirmation.startAt);
    expect(checkAgainstTraffic(harness.context, second, clear ?? 0)).toEqual([]);
  });

  it('gives nothing back when every try is busy', () => {
    harness = testContext();
    const first = order('9074729', 1000);
    const confirmation = confirmMovement(harness.context, { reference: first });
    const second = order('9074705', 600, 'departure');
    expect(
      firstClearStart(harness.context, second, confirmation.startAt, { step: 1, tries: 2 }),
    ).toBeUndefined();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { makeInterval } from '../../../src/util/interval';
import { deepMovements, studyDredging, worstReach } from '../../../src/service/dredging';
import { placeOrder } from '../../../src/service/ordering';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

const PERIOD = makeInterval(NOW, NOW + 2880);

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function order(draught: number, vessel = '9074729'): string {
  return placeOrder(harness!.context, {
    kind: 'arrival',
    vessel,
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught,
    requestedFor: NOW + 1440,
  }).movement.reference;
}

describe('the study', () => {
  it('reads as nothing when no movements are on the book', () => {
    harness = testContext();
    const study = studyDredging(harness.context, PERIOD);
    expect(study.movements).toBe(0);
    expect(study.reaches.every((reach) => reach.minutesGained === 0)).toBe(true);
  });

  it('names every reach in the district', () => {
    harness = testContext();
    order(1100);
    const study = studyDredging(harness.context, PERIOD);
    expect(study.reaches.map((reach) => reach.reach).sort()).toEqual([
      'APPROACH',
      'LOWER-BAR',
      'UPPER',
    ]);
  });

  it('puts the bar first for a deep ship', () => {
    harness = testContext();
    order(1180);
    const study = studyDredging(harness.context, PERIOD, 50);
    expect(worstReach(study)?.reach).toBe('LOWER-BAR');
    expect(worstReach(study)?.minutesGained).toBeGreaterThan(0);
  });

  it('gains nothing from deepening for a ship that has the whole range already', () => {
    harness = testContext();
    order(600, '9074705');
    const study = studyDredging(harness.context, PERIOD, 50);
    expect(study.reaches.every((reach) => reach.minutesGained === 0)).toBe(true);
  });

  it('gains more from a deeper cut', () => {
    harness = testContext();
    order(1180);
    const small = studyDredging(harness.context, PERIOD, 20);
    const large = studyDredging(harness.context, PERIOD, 80);
    expect(worstReach(large)?.minutesGained).toBeGreaterThan(worstReach(small)?.minutesGained ?? 0);
  });

  it('counts a movement blocked by a reach', () => {
    harness = testContext();
    placeOrder(harness.context, {
      kind: 'anchorage',
      vessel: '9319466',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'ANCH-A',
      draught: 2000,
      requestedFor: NOW + 1440,
    });
    const study = studyDredging(harness.context, PERIOD, 30);
    expect(study.reaches.some((reach) => reach.movementsBlocked > 0)).toBe(true);
  });

  it('leaves a cancelled movement out', () => {
    harness = testContext();
    const reference = order(1180);
    harness.temp.db
      .prepare('update movement set status = ? where reference = ?')
      .run('cancelled', reference);
    expect(studyDredging(harness.context, PERIOD).movements).toBe(0);
  });

  it('lists the deep ships the case is made of', () => {
    harness = testContext();
    order(1180);
    order(600, '9074705');
    const deep = deepMovements(harness.context, PERIOD, 1000);
    expect(deep).toHaveLength(1);
    expect(deep[0]).toContain('units');
  });

  it('has nothing to name in an empty study', () => {
    harness = testContext();
    const study = { period: PERIOD, deepenBy: 30, movements: 0, reaches: [] };
    expect(worstReach(study)).toBeUndefined();
  });
});

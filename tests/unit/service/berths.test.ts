import { afterEach, describe, expect, it } from 'vitest';
import { makeInterval } from '../../../src/util/interval';
import { berthsFor, diaryForDays, utilisation } from '../../../src/service/berths';
import { placeOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function order(kind: 'arrival' | 'departure', vessel: string, at: number, draught = 1000): string {
  const reference = placeOrder(harness!.context, {
    kind,
    vessel,
    agent: 'SEAWAY',
    from: kind === 'arrival' ? 'SEA' : 'GRAIN-3',
    to: kind === 'arrival' ? 'GRAIN-3' : 'SEA',
    draught,
    requestedFor: at,
  }).movement.reference;
  confirmMovement(harness!.context, { reference });
  return reference;
}

describe('the diary', () => {
  it('is empty when nothing is planned', () => {
    harness = testContext();
    const diary = diaryForDays(harness.context, NOW, 7);
    expect(diary.stays).toEqual([]);
    expect(diary.conflicts).toEqual([]);
  });

  it('opens a stay on an arrival and closes it on the sailing', () => {
    harness = testContext();
    order('arrival', '9074729', NOW + 1440);
    order('departure', '9074729', NOW + 4320);
    const diary = diaryForDays(harness.context, NOW, 7);
    expect(diary.stays).toHaveLength(1);
    expect(diary.stays[0]?.to).toBeDefined();
    expect(diary.open).toEqual([]);
  });

  it('calls out a ship still alongside', () => {
    harness = testContext();
    order('arrival', '9074729', NOW + 1440);
    expect(diaryForDays(harness.context, NOW, 7).open).toHaveLength(1);
  });

  it('finds a berth double booked', () => {
    harness = testContext();
    order('arrival', '9074729', NOW + 1440);
    order('arrival', '9074705', NOW + 2880, 600);
    const diary = diaryForDays(harness.context, NOW, 7);
    expect(diary.conflicts).toHaveLength(1);
    expect(diary.conflicts[0]?.berth).toBe('GRAIN-3');
  });

  it('reads the utilisation', () => {
    harness = testContext();
    order('arrival', '9074729', NOW + 1440);
    order('departure', '9074729', NOW + 2880);
    const busy = utilisation(diaryForDays(harness.context, NOW, 7));
    expect(busy[0]?.berth).toBe('GRAIN-3');
    expect(busy[0]?.percent).toBeGreaterThan(0);
    expect(busy[0]?.percent).toBeLessThan(100);
  });
});

describe('finding a berth', () => {
  it('offers what is free and fits', () => {
    harness = testContext();
    const found = berthsFor(harness.context, {
      vessel: '9074729',
      draught: 1000,
      period: makeInterval(NOW, NOW + 2880),
    });
    expect(found.find((each) => each.berth.id === 'GRAIN-3')?.free).toBe(true);
  });

  it('marks a berth somebody is lying at', () => {
    harness = testContext();
    order('arrival', '9074729', NOW + 60);
    const found = berthsFor(harness.context, {
      vessel: '9074705',
      draught: 600,
      period: makeInterval(NOW, NOW + 2880),
    });
    expect(found.find((each) => each.berth.id === 'GRAIN-3')?.free).toBe(false);
  });

  it('marks a berth she is too long for', () => {
    harness = testContext();
    const found = berthsFor(harness.context, {
      vessel: '9319466',
      draught: 1200,
      period: makeInterval(NOW, NOW + 2880),
    });
    expect(found.find((each) => each.berth.id === 'GRAIN-3')?.reason).toContain('longer');
  });
});

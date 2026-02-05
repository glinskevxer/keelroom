import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { note, recent, trailOf, trailOfPerson } from '../../../src/service/audit';
import { contextFrom } from '../../../src/service/context';
import { placeOrder, cancelOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import { assignPilot } from '../../../src/service/dispatch';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function order(): string {
  return placeOrder(harness!.context, {
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught: 1000,
    requestedFor: NOW + 2880,
  }).movement.reference;
}

describe('writing to the trail', () => {
  it('records who did it from the context', () => {
    harness = testContext();
    const entry = note(harness.context, 'survey-loaded', 'LOWER-BAR', { note: 'march survey' });
    expect(entry.by).toBe('unnamed');
    expect(trailOf(harness.context, 'LOWER-BAR')).toHaveLength(1);
  });

  it('takes a name for one entry', () => {
    harness = testContext();
    note(harness.context, 'survey-loaded', 'LOWER-BAR', { note: 'x', by: 'hydrographer.reid' });
    expect(trailOfPerson(harness.context, 'hydrographer.reid')).toHaveLength(1);
  });

  it('refuses an action that wants a reason and has none', () => {
    harness = testContext();
    expect(() => note(harness!.context, 'board-overridden', 'M-2025-0001')).toThrow(InputError);
  });

  it('takes the operator the context was opened with', () => {
    harness = testContext();
    const named = contextFrom(harness.temp.db, harness.context.config, {
      now: () => NOW,
      operator: 'despatcher.hall',
    });
    note(named, 'survey-loaded', 'UPPER', { note: 'x' });
    expect(trailOf(named, 'UPPER')[0]?.by).toBe('despatcher.hall');
  });
});

describe('what the services record', () => {
  it('an order going on the book', () => {
    harness = testContext();
    const reference = order();
    const trail = trailOf(harness.context, reference);
    expect(trail.map((entry) => entry.action)).toEqual(['order-placed']);
    expect(trail[0]?.note).toContain('ATLANTIC CROWN');
  });

  it('a confirmation and then a replan', () => {
    harness = testContext();
    const reference = order();
    const first = confirmMovement(harness.context, { reference });
    confirmMovement(harness.context, { reference, startAt: first.startAt + 10 });
    expect(trailOf(harness.context, reference).map((entry) => entry.action)).toEqual([
      'order-placed',
      'movement-confirmed',
      'movement-replanned',
    ]);
  });

  it('a pilot being given the job', () => {
    harness = testContext();
    const reference = order();
    confirmMovement(harness.context, { reference });
    assignPilot(harness.context, { reference });
    const trail = trailOf(harness.context, reference);
    expect(trail.some((entry) => entry.action === 'pilot-assigned')).toBe(true);
  });

  it('the board being overridden, with the reason', () => {
    harness = testContext();
    const reference = order();
    confirmMovement(harness.context, { reference });
    assignPilot(harness.context, { reference, pilot: 'P07', override: 'P02 has the tanker' });
    const trail = trailOf(harness.context, reference);
    const override = trail.find((entry) => entry.action === 'board-overridden');
    expect(override?.note).toBe('P02 has the tanker');
  });

  it('a cancellation with its reason', () => {
    harness = testContext();
    const reference = order();
    cancelOrder(harness.context, reference, 'ship delayed at sea');
    const trail = trailOf(harness.context, reference);
    expect(trail.at(-1)?.action).toBe('order-cancelled');
    expect(trail.at(-1)?.note).toBe('ship delayed at sea');
  });

  it('reads back in the order things happened', () => {
    harness = testContext();
    const reference = order();
    confirmMovement(harness.context, { reference });
    const entries = recent(harness.context, 10);
    expect(entries.at(-1)?.action).toBe('movement-confirmed');
  });
});

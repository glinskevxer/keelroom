import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { makeInterval } from '../../../src/util/interval';
import { placeOrder } from '../../../src/service/ordering';
import {
  confirmMovement,
  directionFor,
  displacement,
  FAIR_WEATHER,
  passageFor,
  pickStart,
  planMovement,
  windowAround,
} from '../../../src/service/planning';
import { requireMovement } from '../../../src/storage/movement-store';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function ordered(draught = 1100, kind: 'arrival' | 'departure' = 'arrival'): string {
  const context = harness!.context;
  return placeOrder(context, {
    kind,
    vessel: '9074729',
    agent: 'SEAWAY',
    from: kind === 'arrival' ? 'SEA' : 'GRAIN-3',
    to: kind === 'arrival' ? 'GRAIN-3' : 'SEA',
    draught,
    requestedFor: NOW + 2880,
  }).movement.reference;
}

/** The capesize, ordered to the anchorage where she at least fits alongside. */
function tooDeep(): string {
  return placeOrder(harness!.context, {
    kind: 'anchorage',
    vessel: '9319466',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'ANCH-A',
    draught: 1750,
    requestedFor: NOW + 2880,
  }).movement.reference;
}

describe('building the passage', () => {
  it('runs seaward first for an arrival', () => {
    harness = testContext();
    const reference = ordered();
    const movement = requireMovement(harness.temp.db, reference);
    expect(directionFor(movement)).toBe('inbound');
    expect(passageFor(harness.context, movement).legs.map((leg) => leg.reach.id)).toEqual([
      'APPROACH',
      'LOWER-BAR',
      'UPPER',
    ]);
  });

  it('runs the other way for a departure', () => {
    harness = testContext();
    const reference = ordered(1100, 'departure');
    const movement = requireMovement(harness.temp.db, reference);
    expect(directionFor(movement)).toBe('outbound');
    expect(passageFor(harness.context, movement).legs[0]?.reach.id).toBe('UPPER');
  });

  it('stops at the reach the berth is on', () => {
    harness = testContext();
    const reference = placeOrder(harness.context, {
      kind: 'anchorage',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'ANCH-A',
      draught: 1100,
      requestedFor: NOW + 2880,
    }).movement.reference;
    const movement = requireMovement(harness.temp.db, reference);
    expect(passageFor(harness.context, movement).legs.map((leg) => leg.reach.id)).toEqual([
      'APPROACH',
    ]);
  });

  it('holds the ship to the reach speed limits', () => {
    harness = testContext();
    const movement = requireMovement(harness.temp.db, ordered());
    const passage = passageFor(harness.context, movement, 140);
    expect(passage.legs.map((leg) => leg.speed)).toEqual([140, 100, 80]);
  });
});

describe('planning', () => {
  it('offers windows for a ship that fits', () => {
    harness = testContext();
    const plan = planMovement(harness.context, { reference: ordered(1000) });
    expect(plan.result.windows.length).toBeGreaterThan(0);
    expect(plan.result.passable).toBe(true);
  });

  it('carries the working of every rule', () => {
    harness = testContext();
    const plan = planMovement(harness.context, { reference: ordered() });
    expect(plan.result.depth.reaches).toHaveLength(3);
    expect(plan.result.air.overheads).toHaveLength(1);
    expect(plan.result.restrictions.tugs).toBeGreaterThan(0);
  });

  it('gives nothing to a ship the tide will not take', () => {
    harness = testContext();
    const plan = planMovement(harness.context, { reference: tooDeep() });
    expect(plan.result.windows).toEqual([]);
    expect(plan.result.findings.length).toBeGreaterThan(0);
  });

  it('searches the range it was given', () => {
    harness = testContext();
    const reference = ordered(1000);
    const narrow = planMovement(harness.context, {
      reference,
      bounds: makeInterval(NOW, NOW + 120),
    });
    const wide = planMovement(harness.context, { reference, searchHours: 24 });
    expect(narrow.result.windows.length).toBeLessThanOrEqual(wide.result.windows.length);
  });

  it('refuses a search window of no width', () => {
    expect(() => windowAround(NOW, 0)).toThrow(InputError);
  });

  it('takes the conditions it is given', () => {
    harness = testContext();
    const reference = ordered(1150);
    const fair = planMovement(harness.context, { reference, conditions: FAIR_WEATHER });
    const rough = planMovement(harness.context, {
      reference,
      conditions: {
        transit: { density: 1010, waveHeight: 250, speed: 80 },
        movement: { wind: 25, visibility: 4000 },
      },
    });
    const width = (windows: readonly { from: number; to: number }[]): number =>
      windows.reduce((total, window) => total + (window.to - window.from), 0);
    expect(width(rough.result.windows)).toBeLessThan(width(fair.result.windows));
  });
});

describe('confirming', () => {
  it('puts the planned time inside a window', () => {
    harness = testContext();
    const reference = ordered(1000);
    const confirmation = confirmMovement(harness.context, { reference });
    expect(confirmation.movement.status).toBe('confirmed');
    expect(confirmation.movement.plannedFor).toBe(confirmation.startAt);
    const inside = confirmation.plan.result.windows.some(
      (window) => confirmation.startAt >= window.from && confirmation.startAt <= window.to,
    );
    expect(inside).toBe(true);
  });

  it('picks the start nearest to what the agent asked for', () => {
    harness = testContext();
    const reference = ordered(1000);
    const plan = planMovement(harness.context, { reference });
    const wanted = plan.movement.requestedFor;
    expect(pickStart(plan, wanted)).toBe(confirmMovement(harness.context, { reference }).startAt);
  });

  it('reports how far the offer moved the agent', () => {
    harness = testContext();
    const confirmation = confirmMovement(harness.context, { reference: ordered(1000) });
    expect(Math.abs(displacement(confirmation))).toBeLessThan(24 * 60);
  });

  it('takes a start the despatcher chose', () => {
    harness = testContext();
    const reference = ordered(1000);
    const plan = planMovement(harness.context, { reference });
    const window = plan.result.windows[0]!;
    const confirmation = confirmMovement(harness.context, { reference, startAt: window.from + 5 });
    expect(confirmation.startAt).toBe(window.from + 5);
  });

  it('refuses a start outside every window', () => {
    harness = testContext();
    const reference = ordered(1000);
    expect(() => confirmMovement(harness!.context, { reference, startAt: NOW - 10000 })).toThrow(
      /not inside any window/,
    );
  });

  it('refuses to confirm a movement with no window at all', () => {
    harness = testContext();
    expect(() => confirmMovement(harness!.context, { reference: tooDeep() })).toThrow(
      /no window to confirm against/,
    );
  });

  it('replans a movement that was already confirmed', () => {
    harness = testContext();
    const reference = ordered(1000);
    const first = confirmMovement(harness.context, { reference });
    const window = first.plan.result.windows[0]!;
    const second = confirmMovement(harness.context, { reference, startAt: window.from + 10 });
    expect(second.movement.status).toBe('confirmed');
    expect(second.movement.plannedFor).toBe(window.from + 10);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { makeTug } from '../../../src/domain/tug/tug';
import { saveTug } from '../../../src/storage/tug-store';
import { requireMovement } from '../../../src/storage/movement-store';
import { placeOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import {
  bookForMovement,
  demandFor,
  heldBy,
  offerTugs,
  pullFor,
  releaseForMovement,
} from '../../../src/service/towage';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function ready(tugs = 4): TestContext {
  harness = testContext();
  const fleet = [
    makeTug({ id: 'T1', name: 'Bar Master', owner: 'HARBOUR TOWAGE', pull: 60, escort: true }),
    makeTug({ id: 'T2', name: 'Narrows', owner: 'HARBOUR TOWAGE', pull: 50 }),
    makeTug({ id: 'T3', name: 'Upper Reach', owner: 'RIVER TUGS', pull: 45 }),
    makeTug({ id: 'T4', name: 'Little Star', owner: 'RIVER TUGS', pull: 30 }),
  ].slice(0, tugs);
  for (const tug of fleet) {
    saveTug(harness.temp.db, tug);
  }
  return harness;
}

function confirmed(vessel = '9074729', draught = 1000): string {
  const reference = placeOrder(harness!.context, {
    kind: 'arrival',
    vessel,
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught,
    requestedFor: NOW + 2880,
  }).movement.reference;
  confirmMovement(harness!.context, { reference });
  return reference;
}

describe('the demand', () => {
  it('comes from the standing orders and her displacement', () => {
    ready();
    const demand = demandFor(harness!.context, confirmed());
    expect(demand.count).toBeGreaterThan(0);
    expect(demand.pull).toBeGreaterThan(0);
    expect(demand.escort).toBe(true);
  });

  it('reads a small ship as wanting fewer', () => {
    ready();
    const big = demandFor(harness!.context, confirmed());
    const small = demandFor(harness!.context, confirmed('9074705', 600));
    expect(small.count).toBeLessThan(big.count);
    expect(small.escort).toBe(false);
  });

  it('turns displacement into a pull the district can quote', () => {
    expect(pullFor(60000)).toBe(60);
    expect(pullFor(500)).toBe(10);
  });
});

describe('offering and booking', () => {
  it('offers the strongest tugs that are free', () => {
    ready();
    const offer = offerTugs(harness!.context, confirmed());
    expect(offer.met).toBe(true);
    expect(offer.tugs[0]?.id).toBe('T1');
  });

  it('books them and writes the count onto the movement', () => {
    ready();
    const reference = confirmed();
    const booked = bookForMovement(harness!.context, reference);
    expect(heldBy(harness!.context, reference)).toHaveLength(booked.tugs.length);
    expect(requireMovement(harness!.temp.db, reference).tugs).toBe(booked.tugs.length);
  });

  it('will not lend the same tug to two movements at once', () => {
    ready();
    const first = confirmed();
    bookForMovement(harness!.context, first);
    const second = confirmed('9074705', 600);
    const offer = offerTugs(harness!.context, second);
    expect(offer.tugs.every((tug) => !heldBy(harness!.context, first).includes(tug.id))).toBe(true);
  });

  it('refuses when the fleet cannot raise what is wanted', () => {
    ready(1);
    const reference = confirmed();
    expect(() => bookForMovement(harness!.context, reference)).toThrow(InputError);
    expect(requireMovement(harness!.temp.db, reference).tugs).toBe(0);
  });

  it('releases them again', () => {
    ready();
    const reference = confirmed();
    bookForMovement(harness!.context, reference);
    expect(releaseForMovement(harness!.context, reference)).toBeGreaterThan(0);
    expect(heldBy(harness!.context, reference)).toEqual([]);
    expect(requireMovement(harness!.temp.db, reference).tugs).toBe(0);
  });

  it('replaces the booking rather than adding to it', () => {
    ready();
    const reference = confirmed();
    bookForMovement(harness!.context, reference);
    const again = bookForMovement(harness!.context, reference);
    expect(heldBy(harness!.context, reference)).toHaveLength(again.tugs.length);
  });

  it('takes more tugs in a wind', () => {
    ready();
    const reference = confirmed();
    const calm = offerTugs(harness!.context, reference, { wind: 5, visibility: 8000 });
    const blowing = offerTugs(harness!.context, reference, { wind: 25, visibility: 8000 });
    expect(blowing.demand.count).toBe(calm.demand.count + 1);
  });
});

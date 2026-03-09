import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { makeInterval } from '../../../src/util/interval';
import { saveBook } from '../../../src/storage/billing-store';
import { placeOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import {
  assignPilot,
  boardVessel,
  completeMovement,
  getUnderway,
} from '../../../src/service/dispatch';
import { overallRate, raiseBook, studyRates } from '../../../src/service/rates';
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

function ranMovement(vessel = '9074729', draught = 1000, agent = 'SEAWAY'): string {
  const context = harness!.context;
  const reference = placeOrder(context, {
    kind: 'arrival',
    vessel,
    agent,
    from: 'SEA',
    to: 'GRAIN-3',
    draught,
    requestedFor: NOW + 2880,
  }).movement.reference;
  const confirmation = confirmMovement(context, { reference });
  assignPilot(context, { reference });
  boardVessel(context, reference, confirmation.startAt);
  getUnderway(context, reference, confirmation.startAt + 15);
  completeMovement(context, reference, confirmation.startAt + 180);
  return reference;
}

describe('raising a book', () => {
  it('raises every charge in it', () => {
    const raised = raiseBook(TARIFF, 'T-2026-A', 500, NOW);
    expect(raised.minimumCharge).toBe(
      TARIFF.minimumCharge + Math.round(TARIFF.minimumCharge * 0.05),
    );
    expect(raised.bands[0]?.charge).toBeGreaterThan(TARIFF.bands[0]!.charge);
    expect(raised.boatFee).toBeGreaterThan(TARIFF.boatFee);
  });

  it('keeps the bands and the multipliers', () => {
    const raised = raiseBook(TARIFF, 'T-2026-A', 500, NOW);
    expect(raised.bands).toHaveLength(TARIFF.bands.length);
    expect(raised.kindMultiplier).toEqual(TARIFF.kindMultiplier);
  });

  it('refuses a rise that is not whole basis points', () => {
    expect(() => raiseBook(TARIFF, 'T-2026-A', 5.5, NOW)).toThrow(InputError);
  });
});

describe('the study', () => {
  it('reads as nothing when nothing ran', () => {
    ready();
    const study = studyRates(harness!.context, PERIOD, raiseBook(TARIFF, 'T-2026-A', 500, NOW));
    expect(study.movements).toBe(0);
    expect(overallRate(study)).toBe(0);
  });

  it('reprices what ran and reports the difference', () => {
    ready();
    ranMovement();
    const study = studyRates(harness!.context, PERIOD, raiseBook(TARIFF, 'T-2026-A', 1000, NOW));
    expect(study.movements).toBe(1);
    expect(study.after).toBeGreaterThan(study.before);
    expect(study.difference).toBe(study.after - study.before);
  });

  it('gives the rise the board would quote', () => {
    ready();
    ranMovement();
    const study = studyRates(harness!.context, PERIOD, raiseBook(TARIFF, 'T-2026-A', 1000, NOW));
    expect(overallRate(study)).toBeGreaterThan(500);
    expect(overallRate(study)).toBeLessThanOrEqual(1000);
  });

  it('splits it by agent, worst first', () => {
    ready();
    ranMovement();
    ranMovement('9074705', 600, 'NORTH');
    const study = studyRates(harness!.context, PERIOD, raiseBook(TARIFF, 'T-2026-A', 1000, NOW));
    expect(study.agents).toHaveLength(2);
    expect(study.agents[0]!.difference).toBeGreaterThanOrEqual(study.agents[1]!.difference);
    expect(study.agents[0]!.rate).toBeGreaterThan(0);
  });

  it('leaves out what did not run', () => {
    ready();
    placeOrder(harness!.context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 1000,
      requestedFor: NOW + 2880,
    });
    expect(studyRates(harness!.context, PERIOD, TARIFF).movements).toBe(0);
  });

  it('finds no difference against the same book', () => {
    ready();
    ranMovement();
    const study = studyRates(harness!.context, PERIOD, TARIFF);
    expect(study.difference).toBe(0);
  });
});

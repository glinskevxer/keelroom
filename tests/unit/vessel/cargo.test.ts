import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import {
  describeDeclaration,
  extraTugs,
  forcesDaylight,
  hazardClasses,
  isDangerous,
  isHazardClass,
  makeDeclaration,
  needsEscort,
} from '../../../src/domain/vessel/cargo';
import {
  STANDING_ORDERS,
  assessRestrictions,
  tugsRequired,
} from '../../../src/domain/window/restriction';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { buildPassage } from '../../../src/domain/chart/passage';
import { REACHES } from '../../support/district';
import { saveDeclaration } from '../../../src/storage/movement-store';
import { placeOrder } from '../../../src/service/ordering';
import { planMovement } from '../../../src/service/planning';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function declaration(
  overrides: Partial<Parameters<typeof makeDeclaration>[0]> = {},
): ReturnType<typeof makeDeclaration> {
  return makeDeclaration({
    movement: 'M-2025-0001',
    hazard: '3',
    unNumber: '1203',
    tonnes: 4000,
    ...overrides,
  });
}

const SHIP = makeVessel({
  imo: '9074729',
  name: 'atlantic crown',
  type: 'general',
  length: 12000,
  beam: 1800,
  summerDraught: 800,
  airDraught: 3600,
  grossTonnage: 12000,
});

const PASSAGE = buildPassage(REACHES, 'inbound', { speed: 80 });

describe('a declaration', () => {
  it('keeps what it was given', () => {
    const one = declaration();
    expect(one.hazard).toBe('3');
    expect(one.unNumber).toBe('1203');
    expect(one.inBallast).toBe(false);
  });

  it('lists the classes the form carries', () => {
    expect(hazardClasses()).toHaveLength(10);
    expect(isHazardClass('1')).toBe(true);
    expect(isHazardClass('12')).toBe(false);
  });

  it('refuses one that is not a declaration', () => {
    expect(() => declaration({ hazard: '12' })).toThrow(/not a hazard class/);
    expect(() => declaration({ unNumber: '12' })).toThrow(/not a un number/);
    expect(() => declaration({ tonnes: -1 })).toThrow(InputError);
    expect(() => declaration({ inBallast: true })).toThrow(/not carrying anything/);
  });

  it('takes a ship in ballast', () => {
    const ballast = makeDeclaration({ movement: 'M-1', hazard: 'none', inBallast: true });
    expect(describeDeclaration(ballast)).toContain('in ballast');
    expect(isDangerous(ballast)).toBe(false);
  });

  it('describes itself in a line', () => {
    expect(describeDeclaration(declaration())).toBe('M-2025-0001: class 3 un 1203, 4000 t');
  });
});

describe('what a declaration does', () => {
  it('makes an ordinary ship dangerous', () => {
    expect(isDangerous(declaration())).toBe(true);
    expect(isDangerous(declaration({ hazard: 'none', unNumber: undefined }))).toBe(false);
    expect(isDangerous(undefined)).toBe(false);
  });

  it('asks for an escort for explosives and radioactives', () => {
    expect(needsEscort(declaration({ hazard: '1' }))).toBe(true);
    expect(needsEscort(declaration({ hazard: '7' }))).toBe(true);
    expect(needsEscort(declaration())).toBe(false);
  });

  it('holds class one to daylight', () => {
    expect(forcesDaylight(declaration({ hazard: '1' }))).toBe(true);
    expect(forcesDaylight(declaration())).toBe(false);
  });

  it('adds tugs on top of what her size wants', () => {
    expect(extraTugs(undefined)).toBe(0);
    expect(extraTugs(declaration())).toBe(1);
    expect(extraTugs(declaration({ hazard: '1' }))).toBe(2);
    const calm = { wind: 5, visibility: 9000 };
    expect(tugsRequired(STANDING_ORDERS, SHIP, { ...calm, cargo: declaration() })).toBe(
      tugsRequired(STANDING_ORDERS, SHIP, calm) + 1,
    );
  });

  it('appears in the standing orders as a daylight reason', () => {
    const result = assessRestrictions({
      vessel: SHIP,
      draught: 800,
      passage: PASSAGE,
      conditions: { wind: 5, visibility: 9000, cargo: declaration({ hazard: '1' }) },
    });
    expect(result.daylightReasons).toContain('RES-DAY-09');
  });
});

describe('a declaration on a plan', () => {
  it('holds a small ship to daylight when she declares class one', () => {
    harness = testContext();
    const reference = placeOrder(harness.context, {
      kind: 'arrival',
      vessel: '9074705',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 600,
      requestedFor: NOW + 2880,
    }).movement.reference;
    expect(planMovement(harness.context, { reference }).result.restrictions.daylightOnly).toBe(
      false,
    );
    saveDeclaration(
      harness.temp.db,
      makeDeclaration({ movement: reference, hazard: '1', tonnes: 20 }),
    );
    const after = planMovement(harness.context, { reference });
    expect(after.result.restrictions.daylightOnly).toBe(true);
    expect(after.result.restrictions.tugs).toBeGreaterThan(1);
  });
});

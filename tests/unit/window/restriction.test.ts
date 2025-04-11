import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeReach } from '../../../src/domain/chart/reach';
import { buildPassage } from '../../../src/domain/chart/passage';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import type { Vessel } from '../../../src/domain/vessel/vessel';
import {
  assessRestrictions,
  STANDING_ORDERS,
  tugsRequired,
} from '../../../src/domain/window/restriction';
import type { MovementConditions, Restrictions } from '../../../src/domain/window/restriction';

const PASSAGE = buildPassage(
  [
    makeReach({
      id: 'APPROACH',
      name: 'Approach',
      chartedDepth: 1600,
      length: 5560,
      width: 200,
      channel: 'open',
      station: 'NARROWS',
      surveyed: parseInstant('2025-01-15T00:00Z'),
      speedLimit: 120,
    }),
  ],
  'inbound',
  { speed: 100 },
);

function vessel(overrides: Partial<Parameters<typeof makeVessel>[0]> = {}): Vessel {
  return makeVessel({
    imo: '9074729',
    name: 'atlantic crown',
    type: 'bulk',
    length: 22500,
    beam: 3220,
    summerDraught: 1180,
    airDraught: 4200,
    grossTonnage: 43000,
    ...overrides,
  });
}

const CALM: MovementConditions = { wind: 8, visibility: 8000 };

function assess(
  overrides: { vessel?: Vessel; draught?: number; conditions?: Partial<MovementConditions> } = {},
): Restrictions {
  return assessRestrictions({
    vessel: overrides.vessel ?? vessel(),
    draught: overrides.draught ?? 1180,
    passage: PASSAGE,
    conditions: { ...CALM, ...overrides.conditions },
  });
}

describe('daylight', () => {
  it('holds a big ship to daylight and says which rule did it', () => {
    const result = assess({});
    expect(result.daylightOnly).toBe(true);
    expect(result.daylightReasons).toContain('RES-DAY-01');
  });

  it('lets a small ship move at any hour', () => {
    const small = vessel({ length: 9000, beam: 1400, summerDraught: 600 });
    const result = assess({ vessel: small, draught: 600 });
    expect(result.daylightOnly).toBe(false);
    expect(result.daylightReasons).toEqual([]);
  });

  it('holds a deep ship to daylight whatever her size', () => {
    const small = vessel({ length: 9000, beam: 1400, summerDraught: 1300 });
    expect(assess({ vessel: small, draught: 1300 }).daylightReasons).toContain('RES-DAY-02');
  });

  it('honours a request from the master', () => {
    const small = vessel({ length: 9000, beam: 1400, summerDraught: 600 });
    const result = assess({
      vessel: small,
      draught: 600,
      conditions: { masterRequestsDaylight: true },
    });
    expect(result.daylightOnly).toBe(true);
    expect(result.daylightReasons).toEqual(['RES-DAY-03']);
  });

  it('holds a dead ship tow to daylight', () => {
    const small = vessel({ length: 9000, beam: 1400, summerDraught: 600 });
    expect(
      assess({ vessel: small, draught: 600, conditions: { deadShip: true } }).daylightReasons,
    ).toContain('RES-DAY-04');
  });
});

describe('tugs', () => {
  it('gives one tug plus one for every band of units', () => {
    expect(
      tugsRequired(STANDING_ORDERS, vessel({ length: 9000, beam: 1400, summerDraught: 600 }), CALM),
    ).toBe(1);
    expect(tugsRequired(STANDING_ORDERS, vessel(), CALM)).toBe(4);
  });

  it('adds one for dangerous cargo', () => {
    const tanker = vessel({ type: 'tanker' });
    expect(tugsRequired(STANDING_ORDERS, tanker, CALM)).toBe(
      tugsRequired(STANDING_ORDERS, vessel(), CALM) + 1,
    );
  });

  it('drops one for a bow thruster', () => {
    const thruster = vessel({ bowThruster: true });
    expect(tugsRequired(STANDING_ORDERS, thruster, CALM)).toBe(
      tugsRequired(STANDING_ORDERS, vessel(), CALM) - 1,
    );
  });

  it('gives no thruster credit to a dead ship and adds two instead', () => {
    const thruster = vessel({ bowThruster: true });
    expect(tugsRequired(STANDING_ORDERS, thruster, { ...CALM, deadShip: true })).toBe(
      tugsRequired(STANDING_ORDERS, vessel(), CALM) + 2,
    );
  });

  it('adds one in half a gale', () => {
    expect(tugsRequired(STANDING_ORDERS, vessel(), { ...CALM, wind: 20 })).toBe(
      tugsRequired(STANDING_ORDERS, vessel(), CALM) + 1,
    );
  });

  it('blocks a movement that wants more tugs than there are', () => {
    const result = assess({ vessel: vessel({ type: 'gas' }), conditions: { wind: 20 } });
    expect(result.tugs).toBeGreaterThan(STANDING_ORDERS.tugsAvailable);
    expect(result.findings.some((finding) => finding.rule === 'RES-TUG-07')).toBe(true);
  });
});

describe('the weather', () => {
  it('blocks a movement over the wind ceiling', () => {
    const result = assess({ conditions: { wind: 40 } });
    expect(result.findings.some((finding) => finding.rule === 'RES-WIND-05')).toBe(true);
  });

  it('blocks a movement under the visibility floor', () => {
    const result = assess({ conditions: { visibility: 400 } });
    expect(result.findings.some((finding) => finding.rule === 'RES-VIS-06')).toBe(true);
  });

  it('refuses conditions that are not conditions', () => {
    expect(() => assess({ conditions: { wind: -1 } })).toThrow(InputError);
    expect(() => assess({ conditions: { visibility: -1 } })).toThrow(/not a visibility/);
  });
});

describe('one way traffic', () => {
  it('closes the channel to opposing traffic for a big ship', () => {
    expect(assess({}).oneWay).toBe(true);
  });

  it('leaves it open for a small one', () => {
    const small = vessel({ length: 9000, beam: 1400, summerDraught: 600 });
    expect(assess({ vessel: small, draught: 600 }).oneWay).toBe(false);
  });
});

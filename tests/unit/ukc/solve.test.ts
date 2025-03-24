import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeReach } from '../../../src/domain/chart/reach';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { STANDARD_POLICY } from '../../../src/domain/ukc/policy';
import {
  deepestDraughtAt,
  exchangeRate,
  leastTideFor,
  marginAt,
  spareDraught,
  spareTide,
} from '../../../src/domain/ukc/solve';
import type { SolveInput } from '../../../src/domain/ukc/solve';

const SURVEYED = parseInstant('2025-01-15T00:00Z');
const AT = parseInstant('2025-04-01T06:00Z');

const INPUT: SolveInput = {
  reach: makeReach({
    id: 'LOWER-BAR',
    name: 'Lower Bar',
    chartedDepth: 1310,
    length: 5600,
    width: 180,
    channel: 'restricted',
    station: 'NARROWS',
    surveyed: SURVEYED,
    shoalingRate: 24,
    speedLimit: 100,
  }),
  vessel: makeVessel({
    imo: '9074729',
    name: 'atlantic crown',
    type: 'bulk',
    length: 22500,
    beam: 3220,
    summerDraught: 1180,
    airDraught: 4200,
    grossTonnage: 43000,
  }),
  policy: STANDARD_POLICY,
  at: AT,
  conditions: { density: 1020, waveHeight: 80, speed: 80 },
};

describe('the margin moves one way', () => {
  it('never falls as the tide makes', () => {
    let previous = marginAt(INPUT, 1180, -100);
    for (let tide = -95; tide <= 600; tide += 5) {
      const margin = marginAt(INPUT, 1180, tide);
      expect(margin).toBeGreaterThanOrEqual(previous);
      previous = margin;
    }
  });

  it('never rises as the ship loads deeper', () => {
    let previous = marginAt(INPUT, 600, 200);
    for (let draught = 610; draught <= 1400; draught += 10) {
      const margin = marginAt(INPUT, draught, 200);
      expect(margin).toBeLessThanOrEqual(previous);
      previous = margin;
    }
  });
});

describe('the least tide a ship needs', () => {
  it('finds the first centimetre that passes and the one below that does not', () => {
    const least = leastTideFor(INPUT, 1180)!;
    expect(marginAt(INPUT, 1180, least)).toBeGreaterThanOrEqual(0);
    expect(marginAt(INPUT, 1180, least - 1)).toBeLessThan(0);
  });

  it('asks for more tide for a deeper ship', () => {
    expect(leastTideFor(INPUT, 1250)!).toBeGreaterThan(leastTideFor(INPUT, 1180)!);
  });

  it('gives the bottom of the range when the ship needs no tide at all', () => {
    expect(leastTideFor(INPUT, 400, { lowest: 0, highest: 800 })).toBe(0);
  });

  it('gives nothing when no tide in the range will do', () => {
    expect(leastTideFor(INPUT, 2000, { lowest: 0, highest: 300 })).toBeUndefined();
  });

  it('refuses bounds that are not bounds', () => {
    expect(() => leastTideFor(INPUT, 1180, { lowest: 100, highest: 0 })).toThrow(/inverted/);
    expect(() => leastTideFor(INPUT, 1180, { lowest: 0.5, highest: 100 })).toThrow(InputError);
  });
});

describe('the deepest ship a tide takes', () => {
  it('finds the last centimetre that passes and the one above that does not', () => {
    const deepest = deepestDraughtAt(INPUT, 300)!;
    expect(marginAt(INPUT, deepest, 300)).toBeGreaterThanOrEqual(0);
    expect(marginAt(INPUT, deepest + 1, 300)).toBeLessThan(0);
  });

  it('takes a deeper ship on more tide', () => {
    expect(deepestDraughtAt(INPUT, 400)!).toBeGreaterThan(deepestDraughtAt(INPUT, 200)!);
  });

  it('gives nothing when even the lightest ship cannot pass', () => {
    expect(deepestDraughtAt(INPUT, -2000)).toBeUndefined();
  });

  it('gives the top of the range when everything passes', () => {
    expect(deepestDraughtAt(INPUT, 300, { lowest: 100, highest: 400 })).toBe(400);
  });

  it('agrees with the tide search from the other direction', () => {
    const deepest = deepestDraughtAt(INPUT, 300)!;
    expect(leastTideFor(INPUT, deepest)).toBeLessThanOrEqual(300);
  });
});

describe('what is in hand', () => {
  it('reports the draught still available', () => {
    const spare = spareDraught(INPUT, 1180, 300);
    expect(spare).toBe(deepestDraughtAt(INPUT, 300)! - 1180);
  });

  it('reports the whole draught as lost when nothing passes', () => {
    expect(spareDraught(INPUT, 1180, -2000)).toBe(-1180);
  });

  it('reports the tide still available', () => {
    expect(spareTide(INPUT, 1180, 300)).toBe(300 - leastTideFor(INPUT, 1180)!);
    expect(spareTide(INPUT, 2400, 300)).toBeUndefined();
  });

  it('prices a centimetre of tide in draught, and not one for one', () => {
    const rate = exchangeRate(INPUT, 1180, 300);
    expect(rate).toBeGreaterThan(50);
    expect(rate).toBeLessThan(150);
    expect(rate).not.toBe(100);
  });

  it('refuses an exchange rate where the ship does not pass', () => {
    expect(() => exchangeRate(INPUT, 1180, -2000)).toThrow(InputError);
  });
});

import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeReach } from '../../../src/domain/chart/reach';
import type { Reach } from '../../../src/domain/chart/reach';
import {
  averageSpeed,
  buildPassage,
  describePassage,
  legAt,
  legFor,
  nauticalMiles,
  shallowestLeg,
  stationsUsed,
} from '../../../src/domain/chart/passage';

const SURVEYED = parseInstant('2025-01-15T00:00Z');

function reach(id: string, depth: number, length: number, limit = 120, station = 'NARROWS'): Reach {
  return makeReach({
    id,
    name: id,
    chartedDepth: depth,
    length,
    width: 200,
    channel: 'restricted',
    station,
    surveyed: SURVEYED,
    speedLimit: limit,
  });
}

const SEAWARD = [
  reach('APPROACH', 1600, 9260, 140, 'OUTER'),
  reach('LOWER-BAR', 1310, 5560),
  reach('MIDDLE', 1400, 3704, 80),
  reach('TURNING', 1350, 1852, 60),
];

describe('building a passage', () => {
  const inbound = buildPassage(SEAWARD, 'inbound', { speed: 100 });

  it('runs the reaches seaward first when inbound', () => {
    expect(inbound.legs.map((leg) => leg.reach.id)).toEqual([
      'APPROACH',
      'LOWER-BAR',
      'MIDDLE',
      'TURNING',
    ]);
  });

  it('runs them the other way when outbound', () => {
    const outbound = buildPassage(SEAWARD, 'outbound', { speed: 100 });
    expect(outbound.legs.map((leg) => leg.reach.id)).toEqual([
      'TURNING',
      'MIDDLE',
      'LOWER-BAR',
      'APPROACH',
    ]);
  });

  it('measures every leg from the start of the passage', () => {
    expect(inbound.legs[0]?.entry).toBe(0);
    for (let index = 1; index < inbound.legs.length; index += 1) {
      expect(inbound.legs[index]!.entry).toBe(inbound.legs[index - 1]!.exit);
      expect(inbound.legs[index]!.exit).toBeGreaterThan(inbound.legs[index]!.entry);
    }
    expect(inbound.minutes).toBe(inbound.legs[inbound.legs.length - 1]!.exit);
  });

  it('holds a ship to the slowest speed limit on each reach', () => {
    expect(inbound.legs.map((leg) => leg.speed)).toEqual([100, 100, 80, 60]);
  });

  it('adds the start and end delays', () => {
    const withDelays = buildPassage(SEAWARD, 'inbound', {
      speed: 100,
      startDelay: 20,
      endDelay: 30,
    });
    expect(withDelays.legs[0]?.entry).toBe(20);
    expect(withDelays.minutes).toBe(inbound.minutes + 50);
  });

  it('adds a hold between two reaches', () => {
    const withHold = buildPassage(SEAWARD, 'inbound', { speed: 100, holds: { 'LOWER-BAR': 15 } });
    expect(withHold.legs[2]?.entry).toBe(inbound.legs[2]!.entry + 15);
    expect(withHold.minutes).toBe(inbound.minutes + 15);
  });

  it('takes longer at a slower speed', () => {
    const slow = buildPassage(SEAWARD, 'inbound', { speed: 50 });
    expect(slow.minutes).toBeGreaterThan(inbound.minutes);
  });

  it('refuses a passage it cannot build', () => {
    expect(() => buildPassage([], 'inbound', { speed: 100 })).toThrow(/at least one reach/);
    expect(() => buildPassage(SEAWARD, 'inbound', { speed: 0 })).toThrow(/tenths of a knot/);
    expect(() => buildPassage(SEAWARD, 'inbound', { speed: 100, startDelay: -1 })).toThrow(
      /negative number of minutes/,
    );
    expect(() => buildPassage([SEAWARD[0]!, SEAWARD[0]!], 'inbound', { speed: 100 })).toThrow(
      /appears in the passage twice/,
    );
  });
});

describe('reading a passage', () => {
  const inbound = buildPassage(SEAWARD, 'inbound', { speed: 100 });

  it('finds a leg by reach', () => {
    expect(legFor(inbound, 'MIDDLE')?.reach.name).toBe('MIDDLE');
    expect(legFor(inbound, 'NOWHERE')).toBeUndefined();
  });

  it('says which reach the ship is in at an offset', () => {
    const middle = legFor(inbound, 'MIDDLE')!;
    expect(legAt(inbound, middle.entry + 1)?.reach.id).toBe('MIDDLE');
    expect(legAt(inbound, 0)?.reach.id).toBe('APPROACH');
    expect(legAt(inbound, inbound.minutes + 100)).toBeUndefined();
  });

  it('finds the reach with the least charted water', () => {
    expect(shallowestLeg(inbound).reach.id).toBe('LOWER-BAR');
  });

  it('measures the passage in nautical miles', () => {
    expect(nauticalMiles(inbound)).toBeCloseTo(10.999, 2);
  });

  it('reads an average speed under the requested speed', () => {
    expect(averageSpeed(inbound)).toBeLessThan(100);
    expect(averageSpeed(inbound)).toBeGreaterThan(50);
  });

  it('lists the stations the passage is planned against', () => {
    expect(stationsUsed(inbound)).toEqual(['NARROWS', 'OUTER']);
  });

  it('describes itself in one line', () => {
    expect(describePassage(inbound)).toBe(
      `inbound APPROACH to TURNING, 4 reaches, ${inbound.minutes} min`,
    );
  });

  it('refuses an average speed with no time in it', () => {
    const nothing = { direction: 'inbound' as const, legs: [], minutes: 0, length: 0 };
    expect(() => averageSpeed(nothing)).toThrow(InputError);
    expect(() => shallowestLeg(nothing)).toThrow(/no shallowest reach/);
    expect(describePassage(nothing)).toContain('(none)');
  });
});

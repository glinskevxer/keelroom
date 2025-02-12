import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import type { Reach } from '../../../src/domain/chart/reach';
import {
  channelArea,
  depthLostToAge,
  describeReach,
  isStale,
  makeReach,
  permittedSpeed,
  plannedDepth,
  shoalingAllowance,
  surveyAgeDays,
  transitMinutes,
} from '../../../src/domain/chart/reach';

const SURVEYED = parseInstant('2025-01-15T00:00Z');
const NOW = parseInstant('2025-07-15T00:00Z');

function reach(overrides: Partial<Parameters<typeof makeReach>[0]> = {}): Reach {
  return makeReach({
    id: 'LOWER-BAR',
    name: 'Lower Bar',
    chartedDepth: 1310,
    length: 5600,
    width: 180,
    channel: 'restricted',
    station: 'NARROWS',
    surveyed: SURVEYED,
    shoalingRate: 24,
    surveyTolerance: 10,
    speedLimit: 100,
    ...overrides,
  });
}

describe('building a reach', () => {
  it('keeps what it was given', () => {
    const bar = reach();
    expect(bar.id).toBe('LOWER-BAR');
    expect(bar.chartedDepth).toBe(1310);
    expect(bar.channel).toBe('restricted');
    expect(bar.surveyTolerance).toBe(10);
  });

  it('defaults the tolerance and the shoaling rate', () => {
    const bar = makeReach({
      id: 'CUT-A',
      name: 'Cut A',
      chartedDepth: 1200,
      length: 1000,
      width: 150,
      channel: 'open',
      station: 'NARROWS',
      surveyed: SURVEYED,
      speedLimit: 120,
    });
    expect(bar.surveyTolerance).toBe(10);
    expect(bar.shoalingRate).toBe(0);
  });

  it('refuses an id or a name that is not one', () => {
    expect(() => reach({ id: 'lower' })).toThrow(/upper case/);
    expect(() => reach({ id: 'L' })).toThrow(InputError);
    expect(() => reach({ name: '   ' })).toThrow(/has no name/);
  });

  it('refuses a reach with no depth, length or width', () => {
    expect(() => reach({ chartedDepth: 0 })).toThrow(/no charted depth/);
    expect(() => reach({ chartedDepth: 12.5 })).toThrow(/whole centimetres/);
    expect(() => reach({ length: 0 })).toThrow(/no length/);
    expect(() => reach({ width: 0 })).toThrow(/no width/);
    expect(() => reach({ width: 20 })).toThrow(/narrower than any ship/);
  });

  it('refuses a reach that deepens on its own or has no speed limit', () => {
    expect(() => reach({ shoalingRate: -5 })).toThrow(/cannot deepen/);
    expect(() => reach({ surveyTolerance: -1 })).toThrow(/negative survey tolerance/);
    expect(() => reach({ speedLimit: 0 })).toThrow(/tenths of a knot/);
    expect(() => reach({ speedLimit: 10.5 })).toThrow(/tenths of a knot/);
  });
});

describe('the survey ages', () => {
  const bar = reach();

  it('counts the days since the survey', () => {
    expect(surveyAgeDays(bar, NOW)).toBeCloseTo(181, 0);
    expect(surveyAgeDays(bar, SURVEYED)).toBe(0);
  });

  it('never reads an age before the survey as negative', () => {
    expect(surveyAgeDays(bar, SURVEYED - 100000)).toBe(0);
  });

  it('takes off the shoaling the reach is assumed to have taken', () => {
    expect(shoalingAllowance(bar, NOW)).toBe(12);
    expect(shoalingAllowance(bar, SURVEYED)).toBe(0);
  });

  it('plans against the charted depth less the shoaling and the tolerance', () => {
    expect(plannedDepth(bar, NOW)).toBe(1310 - 12 - 10);
    expect(depthLostToAge(bar, NOW)).toBe(22);
  });

  it('plans a fresh survey against the tolerance alone', () => {
    expect(plannedDepth(bar, SURVEYED)).toBe(1300);
  });

  it('never plans a negative depth', () => {
    const shoal = reach({ chartedDepth: 100, shoalingRate: 500 });
    expect(plannedDepth(shoal, NOW)).toBe(0);
  });

  it('calls a survey over a year old stale', () => {
    expect(isStale(bar, NOW)).toBe(false);
    expect(isStale(bar, NOW + 1440 * 200)).toBe(true);
    expect(isStale(bar, NOW, 30)).toBe(true);
  });
});

describe('running the reach', () => {
  const bar = reach();

  it('takes longer at a slower speed', () => {
    const slow = transitMinutes(bar, 60);
    const fast = transitMinutes(bar, 100);
    expect(slow).toBeGreaterThan(fast);
    expect(fast).toBe(Math.ceil(5600 / (((100 / 10) * 1852) / 60)));
  });

  it('holds a ship to the speed limit of the reach', () => {
    expect(transitMinutes(bar, 200)).toBe(transitMinutes(bar, 100));
    expect(permittedSpeed(bar, 200)).toBe(100);
    expect(permittedSpeed(bar, 80)).toBe(80);
  });

  it('refuses a speed that is not whole tenths of a knot', () => {
    expect(() => transitMinutes(bar, 0)).toThrow(/tenths of a knot/);
    expect(() => transitMinutes(bar, 8.5)).toThrow(/tenths of a knot/);
  });

  it('grows the cross section with the tide', () => {
    const low = channelArea(bar, 0, NOW);
    const high = channelArea(bar, 200, NOW);
    expect(high).toBeGreaterThan(low);
    expect(high - low).toBeCloseTo(2 * 180, 6);
  });

  it('never gives a negative cross section', () => {
    expect(channelArea(bar, -5000, NOW)).toBe(0);
  });

  it('describes itself with both depths', () => {
    expect(describeReach(bar, NOW)).toBe(
      'LOWER-BAR Lower Bar, charted 1310 cm, planned 1288 cm, restricted',
    );
  });
});

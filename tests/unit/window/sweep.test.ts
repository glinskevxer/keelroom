import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeInterval } from '../../../src/util/interval';
import { makeStation } from '../../../src/domain/tide/station';
import { makeBerth } from '../../../src/domain/chart/berth';
import { makeReach } from '../../../src/domain/chart/reach';
import type { Reach } from '../../../src/domain/chart/reach';
import { makeDistrict } from '../../../src/domain/chart/district';
import { buildPassage } from '../../../src/domain/chart/passage';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { STANDARD_POLICY } from '../../../src/domain/ukc/policy';
import {
  controllingReach,
  firstWindow,
  reachWindow,
  startsFor,
  startsForAll,
  sweep,
  windowAt,
} from '../../../src/domain/window/sweep';
import type { TransitPlan } from '../../../src/domain/window/sweep';

const SURVEYED = parseInstant('2025-01-15T00:00Z');
const START = parseInstant('2025-04-01T00:00Z');
const BOUNDS = makeInterval(START, START + 2880);

const STATION = makeStation({
  id: 'NARROWS',
  name: 'The Narrows',
  meanLevel: 210,
  terms: [
    { name: 'M2', amplitude: 168, phase: 231.4 },
    { name: 'S2', amplitude: 31, phase: 258.9 },
    { name: 'N2', amplitude: 37, phase: 210.8 },
    { name: 'K1', amplitude: 12, phase: 96.2 },
    { name: 'O1', amplitude: 8, phase: 84.5 },
  ],
});

function reach(id: string, depth: number): Reach {
  return makeReach({
    id,
    name: id,
    chartedDepth: depth,
    length: 5560,
    width: 200,
    channel: 'restricted',
    station: 'NARROWS',
    surveyed: SURVEYED,
    speedLimit: 100,
  });
}

const REACHES = [reach('APPROACH', 1600), reach('LOWER-BAR', 1290), reach('UPPER', 1400)];

const DISTRICT = makeDistrict({
  code: 'KLR',
  name: 'Keel Room',
  offset: -300,
  reaches: REACHES,
  stations: [STATION],
  berths: [
    makeBerth({
      id: 'GRAIN-3',
      name: 'Grain Quay 3',
      kind: 'quay',
      reach: 'UPPER',
      depth: 1400,
      maxLength: 25000,
    }),
  ],
});

function plan(draught: number): TransitPlan {
  return {
    district: DISTRICT,
    passage: buildPassage(REACHES, 'inbound', { speed: 80 }),
    vessel: makeVessel({
      imo: '9074729',
      name: 'atlantic crown',
      type: 'bulk',
      length: 22500,
      beam: 3220,
      summerDraught: 1250,
      airDraught: 4200,
      grossTonnage: 43000,
    }),
    draught,
    policy: STANDARD_POLICY,
    conditions: { density: 1020, waveHeight: 60, speed: 80 },
  };
}

describe('moving a window back to the start', () => {
  const leg = { reach: REACHES[1]!, entry: 90, exit: 110, speed: 80 };

  it('pulls the front back by the entry and the back by the exit', () => {
    expect(startsFor({ from: 1000, to: 1200 }, leg)).toEqual({ from: 910, to: 1090 });
  });

  it('drops a window too short to get through', () => {
    expect(startsFor({ from: 1000, to: 1010 }, leg)).toBeUndefined();
  });

  it('maps a whole set and normalises what is left', () => {
    const starts = startsForAll(
      [
        { from: 1000, to: 1200 },
        { from: 1000, to: 1005 },
        { from: 1100, to: 1300 },
      ],
      leg,
    );
    expect(starts).toEqual([{ from: 910, to: 1190 }]);
  });
});

describe('one reach at a time', () => {
  it('reads the least tide the reach needs', () => {
    const passage = plan(1200).passage;
    const window = reachWindow(plan(1200), passage.legs[1]!, BOUNDS);
    expect(window.reach).toBe('LOWER-BAR');
    expect(window.leastTide).toBeGreaterThan(0);
    expect(window.starts.length).toBeGreaterThan(0);
  });

  it('asks for more tide on the shallower reach', () => {
    const passage = plan(1200).passage;
    const bar = reachWindow(plan(1200), passage.legs[1]!, BOUNDS).leastTide!;
    const approach = reachWindow(plan(1200), passage.legs[0]!, BOUNDS).leastTide!;
    expect(bar).toBeGreaterThan(approach);
  });

  it('gives no window at all to a ship no tide will float', () => {
    const passage = plan(2400).passage;
    const window = reachWindow(plan(2400), passage.legs[1]!, BOUNDS);
    expect(window.leastTide).toBeUndefined();
    expect(window.starts).toEqual([]);
  });
});

describe('sweeping the whole passage', () => {
  it('gives a light ship the whole range', () => {
    const result = sweep(plan(600), BOUNDS);
    expect(result.windows).toEqual([{ from: BOUNDS.from, to: BOUNDS.to }]);
    expect(result.findings).toEqual([]);
  });

  it('gives a deep ship windows around the high waters', () => {
    const result = sweep(plan(1230), BOUNDS);
    expect(result.windows.length).toBeGreaterThanOrEqual(2);
    expect(result.windows.length).toBeLessThanOrEqual(5);
    for (const window of result.windows) {
      expect(window.to).toBeGreaterThanOrEqual(window.from);
    }
  });

  it('narrows the windows as the ship loads deeper', () => {
    const light = sweep(plan(1150), BOUNDS);
    const heavy = sweep(plan(1240), BOUNDS);
    const width = (result: typeof light): number =>
      result.windows.reduce((total, window) => total + (window.to - window.from), 0);
    expect(width(heavy)).toBeLessThan(width(light));
  });

  it('gives nothing and says why for a ship no tide will take', () => {
    const result = sweep(plan(2400), BOUNDS);
    expect(result.windows).toEqual([]);
    expect(result.findings.some((finding) => finding.rule === 'WIN-DEEP-01')).toBe(true);
  });

  it('keeps every window inside the range it was asked about', () => {
    for (const window of sweep(plan(1200), BOUNDS).windows) {
      expect(window.from).toBeGreaterThanOrEqual(BOUNDS.from);
      expect(window.to).toBeLessThanOrEqual(BOUNDS.to);
    }
  });

  it('refuses a range that ends before it starts', () => {
    expect(() => sweep(plan(1200), { from: BOUNDS.to, to: BOUNDS.from })).toThrow(
      /ends before it starts/,
    );
  });
});

describe('reading a sweep', () => {
  it('names the reach that decided it', () => {
    const result = sweep(plan(1200), BOUNDS);
    expect(controllingReach(result)?.reach).toBe('LOWER-BAR');
  });

  it('names the impossible reach ahead of the merely tight one', () => {
    const result = sweep(plan(2400), BOUNDS);
    expect(controllingReach(result)?.leastTide).toBeUndefined();
  });

  it('finds the first window and the one covering a moment', () => {
    const result = sweep(plan(1230), BOUNDS);
    const first = firstWindow(result)!;
    expect(windowAt(result, first.from)).toEqual(first);
    expect(windowAt(result, BOUNDS.from - 100)).toBeUndefined();
  });

  it('has nothing to name in an empty sweep', () => {
    expect(controllingReach({ windows: [], reaches: [], findings: [] })).toBeUndefined();
    expect(firstWindow({ windows: [], reaches: [], findings: [] })).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeInterval, totalMinutes } from '../../../src/util/interval';
import { makeStation } from '../../../src/domain/tide/station';
import { makeBerth } from '../../../src/domain/chart/berth';
import { makeOverhead } from '../../../src/domain/chart/overhead';
import { makeReach } from '../../../src/domain/chart/reach';
import type { Reach } from '../../../src/domain/chart/reach';
import { makeDistrict } from '../../../src/domain/chart/district';
import type { District } from '../../../src/domain/chart/district';
import { buildPassage } from '../../../src/domain/chart/passage';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { STANDARD_POLICY } from '../../../src/domain/ukc/policy';
import { sweep } from '../../../src/domain/window/sweep';
import type { TransitPlan } from '../../../src/domain/window/sweep';
import {
  airDraughtAt,
  overheadWindow,
  sweepOverheads,
  tightestOverhead,
} from '../../../src/domain/window/overhead';
import { intersectSets } from '../../../src/util/interval';

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

function district(clearance: number): District {
  return makeDistrict({
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
    overheads: [
      makeOverhead({
        id: 'HARBOUR-BR',
        name: 'Harbour Bridge',
        kind: 'bridge',
        reach: 'UPPER',
        clearance,
        station: 'NARROWS',
        airGap: 100,
      }),
    ],
  });
}

function plan(draught: number, clearance: number, airDraught = 4200): TransitPlan {
  return {
    district: district(clearance),
    passage: buildPassage(REACHES, 'inbound', { speed: 80 }),
    vessel: makeVessel({
      imo: '9074729',
      name: 'atlantic crown',
      type: 'container',
      length: 22500,
      beam: 3220,
      summerDraught: 1250,
      airDraught,
      grossTonnage: 43000,
    }),
    draught,
    policy: STANDARD_POLICY,
    conditions: { density: 1020, waveHeight: 60, speed: 80 },
  };
}

describe('air draught', () => {
  it('rises as the ship lightens', () => {
    expect(airDraughtAt(plan(1250, 5000))).toBe(4200);
    expect(airDraughtAt(plan(1000, 5000))).toBe(4450);
  });

  it('does not fall below the marks for a ship loaded deeper than her summer draught', () => {
    expect(airDraughtAt(plan(1300, 5000))).toBe(4200);
  });
});

describe('one structure', () => {
  it('gives the highest tide the ship can pass on', () => {
    const current = plan(1250, 5000);
    const leg = current.passage.legs[2]!;
    const window = overheadWindow(current, current.district.overheads[0]!, leg, BOUNDS);
    expect(window.highestTide).toBe(5000 - 100 - 4200);
    expect(window.starts.length).toBeGreaterThan(0);
  });

  it('gives no window to a ship that never fits', () => {
    const current = plan(1250, 4250);
    const leg = current.passage.legs[2]!;
    const window = overheadWindow(current, current.district.overheads[0]!, leg, BOUNDS);
    expect(window.highestTide).toBeLessThan(0);
    expect(window.starts).toEqual([]);
  });
});

describe('sweeping the structures', () => {
  it('leaves a short ship the whole range', () => {
    const result = sweepOverheads(plan(1250, 6000), BOUNDS);
    expect(result.windows).toEqual([{ from: BOUNDS.from, to: BOUNDS.to }]);
    expect(result.findings).toEqual([]);
  });

  it('holds a tall ship to the lower half of the tide', () => {
    const result = sweepOverheads(plan(1250, 4600), BOUNDS);
    expect(totalMinutes(result.windows)).toBeGreaterThan(0);
    expect(totalMinutes(result.windows)).toBeLessThan(2880);
  });

  it('blocks a ship that cannot fit on any tide', () => {
    const result = sweepOverheads(plan(1250, 4250), BOUNDS);
    expect(result.windows).toEqual([]);
    expect(result.findings.some((finding) => finding.rule === 'AIR-NEVER-01')).toBe(true);
  });

  it('names the tightest structure', () => {
    const result = sweepOverheads(plan(1250, 4600), BOUNDS);
    expect(tightestOverhead(result)?.overhead).toBe('HARBOUR-BR');
    expect(tightestOverhead({ windows: [], overheads: [], findings: [] })).toBeUndefined();
  });
});

describe('the two constraints together', () => {
  it('leaves a deep and tall ship less than either alone', () => {
    const current = plan(1230, 4600);
    const below = sweep(current, BOUNDS).windows;
    const above = sweepOverheads(current, BOUNDS).windows;
    const both = intersectSets(below, above);
    expect(totalMinutes(below)).toBeGreaterThan(0);
    expect(totalMinutes(above)).toBeGreaterThan(0);
    expect(totalMinutes(both)).toBeLessThanOrEqual(totalMinutes(below));
    expect(totalMinutes(both)).toBeLessThanOrEqual(totalMinutes(above));
  });

  it('can leave a ship with nothing at all although each rule allows her', () => {
    const current = plan(1245, 4470);
    const below = sweep(current, BOUNDS).windows;
    const above = sweepOverheads(current, BOUNDS).windows;
    expect(totalMinutes(below)).toBeGreaterThan(0);
    expect(totalMinutes(above)).toBeGreaterThan(0);
    expect(intersectSets(below, above)).toEqual([]);
  });
});

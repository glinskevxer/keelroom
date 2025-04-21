import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeInterval, totalMinutes } from '../../../src/util/interval';
import { makeStation } from '../../../src/domain/tide/station';
import { makeBerth } from '../../../src/domain/chart/berth';
import { makeOverhead } from '../../../src/domain/chart/overhead';
import { makeReach } from '../../../src/domain/chart/reach';
import type { Reach } from '../../../src/domain/chart/reach';
import { makeDistrict } from '../../../src/domain/chart/district';
import { buildPassage } from '../../../src/domain/chart/passage';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { STANDARD_POLICY } from '../../../src/domain/ukc/policy';
import { makePosition } from '../../../src/domain/window/daylight';
import {
  bestWindow,
  blockingRules,
  nextWindowFrom,
  planTransit,
  windowMinutes,
} from '../../../src/domain/window/plan';
import type { PlanRequest, PlanResult } from '../../../src/domain/window/plan';

const SURVEYED = parseInstant('2025-01-15T00:00Z');
const START = parseInstant('2025-04-01T00:00Z');
const BOUNDS = makeInterval(START, START + 4320);
const PORT = makePosition(44.65, -63.57);

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
  offset: -240,
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
      clearance: 5400,
      station: 'NARROWS',
      airGap: 100,
    }),
  ],
});

function request(overrides: {
  draught?: number;
  wind?: number;
  visibility?: number;
  length?: number;
  beam?: number;
}): PlanRequest {
  const length = overrides.length ?? 22500;
  const beam = overrides.beam ?? 3220;
  return {
    plan: {
      district: DISTRICT,
      passage: buildPassage(REACHES, 'inbound', { speed: 80 }),
      vessel: makeVessel({
        imo: '9074729',
        name: 'atlantic crown',
        type: 'bulk',
        length,
        beam,
        summerDraught: 1250,
        airDraught: 4200,
        grossTonnage: 43000,
      }),
      draught: overrides.draught ?? 1150,
      policy: STANDARD_POLICY,
      conditions: { density: 1020, waveHeight: 60, speed: 80 },
    },
    bounds: BOUNDS,
    movement: { wind: overrides.wind ?? 10, visibility: overrides.visibility ?? 8000 },
    position: PORT,
  };
}

function plan(overrides: Parameters<typeof request>[0] = {}): PlanResult {
  return planTransit(request(overrides));
}

describe('putting the rules together', () => {
  it('offers windows to a ship that clears everything', () => {
    const result = plan({ draught: 1100 });
    expect(result.passable).toBe(true);
    expect(result.windows.length).toBeGreaterThan(0);
    expect(windowMinutes(result)).toBeGreaterThan(0);
  });

  it('carries the working of each rule separately', () => {
    const result = plan({});
    expect(result.depth.reaches).toHaveLength(3);
    expect(result.air.overheads).toHaveLength(1);
    expect(result.restrictions.tugs).toBeGreaterThan(0);
  });

  it('never offers more than the tide alone allowed', () => {
    const result = plan({});
    expect(windowMinutes(result)).toBeLessThanOrEqual(totalMinutes(result.depth.windows));
  });

  it('holds a big ship to daylight and gives her less', () => {
    const big = plan({});
    const small = plan({ length: 9000, beam: 1400, draught: 800 });
    expect(big.restrictions.daylightOnly).toBe(true);
    expect(small.restrictions.daylightOnly).toBe(false);
    expect(small.daylight).toHaveLength(1);
    expect(big.daylight.length).toBeGreaterThan(1);
  });

  it('keeps every offered window inside the daylight when daylight applies', () => {
    const result = plan({ draught: 1100 });
    for (const window of result.windows) {
      const covered = result.daylight.some((day) => window.from >= day.from && window.to <= day.to);
      expect(covered).toBe(true);
    }
  });
});

describe('when nothing goes', () => {
  it('blocks on the weather before anything else is considered', () => {
    const result = plan({ wind: 45 });
    expect(result.passable).toBe(false);
    expect(blockingRules(result)).toContain('RES-WIND-05');
  });

  it('blocks a ship no tide will take', () => {
    const result = plan({ draught: 2200 });
    expect(result.passable).toBe(false);
    expect(blockingRules(result)).toContain('WIN-DEEP-01');
    expect(result.windows).toEqual([]);
  });

  it('blocks on visibility', () => {
    expect(blockingRules(plan({ visibility: 200 }))).toContain('RES-VIS-06');
  });
});

describe('choosing a window', () => {
  it('offers the longest window first', () => {
    const result = plan({ draught: 1150 });
    const best = bestWindow(result)!;
    for (const window of result.windows) {
      expect(window.to - window.from).toBeLessThanOrEqual(best.to - best.from);
    }
  });

  it('finds the next window from a moment', () => {
    const result = plan({ draught: 1150 });
    const first = result.windows[0]!;
    expect(nextWindowFrom(result, BOUNDS.from)).toEqual(first);
    expect(nextWindowFrom(result, BOUNDS.to + 1000)).toBeUndefined();
  });

  it('has nothing to offer from an empty plan', () => {
    const result = plan({ draught: 2200 });
    expect(bestWindow(result)).toBeUndefined();
    expect(windowMinutes(result)).toBe(0);
  });
});

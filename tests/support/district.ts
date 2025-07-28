import { parseInstant } from '../../src/util/clock';
import { makeStation } from '../../src/domain/tide/station';
import { makeReach } from '../../src/domain/chart/reach';
import { makeBerth } from '../../src/domain/chart/berth';
import { makeOverhead } from '../../src/domain/chart/overhead';
import { makeDistrict } from '../../src/domain/chart/district';
import type { District } from '../../src/domain/chart/district';
import { makePosition } from '../../src/domain/window/daylight';
import type { Position } from '../../src/domain/window/daylight';

export const SURVEYED = parseInstant('2025-01-15T00:00Z');

export const STATION = makeStation({
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

export const REACHES = [
  makeReach({
    id: 'APPROACH',
    name: 'Sea Approach',
    chartedDepth: 1600,
    length: 9260,
    width: 400,
    channel: 'open',
    station: 'NARROWS',
    surveyed: SURVEYED,
    speedLimit: 140,
  }),
  makeReach({
    id: 'LOWER-BAR',
    name: 'Lower Bar',
    chartedDepth: 1290,
    length: 5560,
    width: 180,
    channel: 'restricted',
    station: 'NARROWS',
    surveyed: SURVEYED,
    shoalingRate: 24,
    speedLimit: 100,
  }),
  makeReach({
    id: 'UPPER',
    name: 'Upper Harbour',
    chartedDepth: 1400,
    length: 3704,
    width: 200,
    channel: 'restricted',
    station: 'NARROWS',
    surveyed: SURVEYED,
    speedLimit: 80,
  }),
];

export const BERTHS = [
  makeBerth({
    id: 'GRAIN-3',
    name: 'Grain Quay 3',
    kind: 'quay',
    reach: 'UPPER',
    depth: 1400,
    maxLength: 25000,
    terminal: 'GRAIN',
  }),
  makeBerth({
    id: 'ANCH-A',
    name: 'Anchorage A',
    kind: 'anchorage',
    reach: 'APPROACH',
    depth: 2200,
    maxLength: 34000,
  }),
];

export const OVERHEADS = [
  makeOverhead({
    id: 'HARBOUR-BR',
    name: 'Harbour Bridge',
    kind: 'bridge',
    reach: 'UPPER',
    clearance: 5400,
    station: 'NARROWS',
    airGap: 100,
  }),
];

export const POSITION: Position = makePosition(44.65, -63.57);

export function testDistrict(): District {
  return makeDistrict({
    code: 'KLR',
    name: 'Keel Room',
    offset: -240,
    reaches: REACHES,
    stations: [STATION],
    berths: BERTHS,
    overheads: OVERHEADS,
  });
}

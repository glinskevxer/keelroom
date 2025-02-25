import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/util/errors';
import { parseInstant } from '../../../src/util/clock';
import { makeStation } from '../../../src/domain/tide/station';
import { makeBerth } from '../../../src/domain/chart/berth';
import { makeOverhead } from '../../../src/domain/chart/overhead';
import { makeReach } from '../../../src/domain/chart/reach';
import {
  describeDistrict,
  findBerth,
  findReach,
  findStation,
  makeDistrict,
  overheadsOn,
  reachOrder,
  reachesToBerth,
  requireBerth,
  requireReach,
  requireStation,
  stationForReach,
} from '../../../src/domain/chart/district';

const SURVEYED = parseInstant('2025-01-15T00:00Z');

const STATION = makeStation({
  id: 'NARROWS',
  name: 'The Narrows',
  meanLevel: 210,
  terms: [{ name: 'M2', amplitude: 168, phase: 231.4 }],
});

function reach(id: string, station = 'NARROWS'): ReturnType<typeof makeReach> {
  return makeReach({
    id,
    name: id,
    chartedDepth: 1300,
    length: 4000,
    width: 200,
    channel: 'restricted',
    station,
    surveyed: SURVEYED,
    speedLimit: 100,
  });
}

const BERTH = makeBerth({
  id: 'GRAIN-3',
  name: 'Grain Quay 3',
  kind: 'quay',
  reach: 'UPPER',
  depth: 1250,
  maxLength: 25000,
});

const BRIDGE = makeOverhead({
  id: 'HARBOUR-BR',
  name: 'Harbour Bridge',
  kind: 'bridge',
  reach: 'MIDDLE',
  clearance: 5400,
  station: 'NARROWS',
});

function district(): ReturnType<typeof makeDistrict> {
  return makeDistrict({
    code: 'KLR',
    name: 'Keel Room',
    offset: -300,
    reaches: [reach('APPROACH'), reach('MIDDLE'), reach('UPPER')],
    stations: [STATION],
    berths: [BERTH],
    overheads: [BRIDGE],
  });
}

describe('assembling a district', () => {
  it('keeps everything it was given', () => {
    const port = district();
    expect(port.reaches).toHaveLength(3);
    expect(port.berths).toHaveLength(1);
    expect(port.overheads).toHaveLength(1);
    expect(port.offset).toBe(-300);
  });

  it('defaults to no overheads', () => {
    const port = makeDistrict({
      code: 'KLR',
      name: 'Keel Room',
      offset: 0,
      reaches: [reach('APPROACH')],
      stations: [STATION],
      berths: [],
    });
    expect(port.overheads).toEqual([]);
  });

  it('refuses a district that is not one', () => {
    const base = {
      name: 'Keel Room',
      offset: 0,
      reaches: [reach('APPROACH')],
      stations: [STATION],
      berths: [],
    };
    expect(() => makeDistrict({ ...base, code: 'k' })).toThrow(/two to six upper case/);
    expect(() => makeDistrict({ ...base, code: 'KLR', name: ' ' })).toThrow(/has no name/);
    expect(() => makeDistrict({ ...base, code: 'KLR', offset: 900 })).toThrow(/zone offset/);
    expect(() => makeDistrict({ ...base, code: 'KLR', reaches: [] })).toThrow(/no reaches/);
    expect(() => makeDistrict({ ...base, code: 'KLR', stations: [] })).toThrow(/no tide stations/);
  });

  it('refuses anything carried twice', () => {
    expect(() =>
      makeDistrict({
        code: 'KLR',
        name: 'Keel Room',
        offset: 0,
        reaches: [reach('APPROACH'), reach('APPROACH')],
        stations: [STATION],
        berths: [],
      }),
    ).toThrow(/carries reach APPROACH twice/);
  });

  it('refuses a reference it cannot resolve', () => {
    expect(() =>
      makeDistrict({
        code: 'KLR',
        name: 'Keel Room',
        offset: 0,
        reaches: [reach('APPROACH', 'MISSING')],
        stations: [STATION],
        berths: [],
      }),
    ).toThrow(/names a station the district does not have/);
    expect(() =>
      makeDistrict({
        code: 'KLR',
        name: 'Keel Room',
        offset: 0,
        reaches: [reach('APPROACH')],
        stations: [STATION],
        berths: [BERTH],
      }),
    ).toThrow(/names a reach the district does not have/);
    expect(() =>
      makeDistrict({
        code: 'KLR',
        name: 'Keel Room',
        offset: 0,
        reaches: [reach('APPROACH')],
        stations: [STATION],
        berths: [],
        overheads: [BRIDGE],
      }),
    ).toThrow(/overhead HARBOUR-BR names a reach/);
  });
});

describe('looking things up', () => {
  const port = district();

  it('finds what is there', () => {
    expect(findReach(port, 'MIDDLE')?.id).toBe('MIDDLE');
    expect(findStation(port, 'NARROWS')?.name).toBe('The Narrows');
    expect(findBerth(port, 'GRAIN-3')?.terminal).toBe('unassigned');
  });

  it('gives nothing for what is not', () => {
    expect(findReach(port, 'NOWHERE')).toBeUndefined();
    expect(findStation(port, 'NOWHERE')).toBeUndefined();
    expect(findBerth(port, 'NOWHERE')).toBeUndefined();
  });

  it('throws when a lookup has to succeed', () => {
    expect(() => requireReach(port, 'NOWHERE')).toThrow(NotFoundError);
    expect(() => requireStation(port, 'NOWHERE')).toThrow(/no tide station with reference/);
    expect(() => requireBerth(port, 'NOWHERE')).toThrow(/no berth with reference/);
  });

  it('resolves the station a reach is planned against', () => {
    expect(stationForReach(port, requireReach(port, 'MIDDLE')).id).toBe('NARROWS');
  });

  it('lists the structures over a reach', () => {
    expect(overheadsOn(port, 'MIDDLE').map((overhead) => overhead.id)).toEqual(['HARBOUR-BR']);
    expect(overheadsOn(port, 'APPROACH')).toEqual([]);
  });

  it('gives the reaches from the sea to a berth', () => {
    expect(reachesToBerth(port, BERTH).map((reach) => reach.id)).toEqual([
      'APPROACH',
      'MIDDLE',
      'UPPER',
    ]);
  });

  it('numbers the reaches from the sea', () => {
    expect(reachOrder(port, 'APPROACH')).toBe(0);
    expect(reachOrder(port, 'UPPER')).toBe(2);
    expect(() => reachOrder(port, 'NOWHERE')).toThrow(NotFoundError);
  });

  it('describes itself in one line', () => {
    expect(describeDistrict(port)).toBe('KLR Keel Room: 3 reaches, 1 berths, 1 stations');
  });
});

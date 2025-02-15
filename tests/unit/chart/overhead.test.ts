import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import {
  clearanceAtTide,
  describeOverhead,
  fitsUnder,
  highestPassableTide,
  makeOverhead,
  neverPasses,
  spareAir,
} from '../../../src/domain/chart/overhead';

const BRIDGE = makeOverhead({
  id: 'HARBOUR-BR',
  name: 'Harbour Bridge',
  kind: 'bridge',
  reach: 'MIDDLE',
  clearance: 5400,
  station: 'NARROWS',
  airGap: 200,
});

describe('building an overhead', () => {
  it('keeps what it was given and defaults the air gap', () => {
    expect(BRIDGE.clearance).toBe(5400);
    expect(BRIDGE.airGap).toBe(200);
    const cable = makeOverhead({
      id: 'CROSSING-1',
      name: 'River crossing',
      kind: 'cable',
      reach: 'UPPER',
      clearance: 4800,
      station: 'NARROWS',
    });
    expect(cable.airGap).toBe(200);
    expect(cable.kind).toBe('cable');
  });

  it('refuses what is not an overhead', () => {
    const base = { name: 'x', kind: 'bridge' as const, reach: 'M', clearance: 100, station: 'S' };
    expect(() => makeOverhead({ ...base, id: 'lower' })).toThrow(/upper case/);
    expect(() => makeOverhead({ ...base, id: 'BR', name: '  ' })).toThrow(/has no name/);
    expect(() => makeOverhead({ ...base, id: 'BR', clearance: 0 })).toThrow(/no clearance/);
    expect(() => makeOverhead({ ...base, id: 'BR', airGap: -1 })).toThrow(InputError);
  });
});

describe('passing under', () => {
  it('takes the tide off the charted clearance', () => {
    expect(clearanceAtTide(BRIDGE, 0)).toBe(5400);
    expect(clearanceAtTide(BRIDGE, 300)).toBe(5100);
    expect(clearanceAtTide(BRIDGE, -50)).toBe(5450);
  });

  it('gives the highest tide a ship can pass on', () => {
    expect(highestPassableTide(BRIDGE, 4800)).toBe(400);
    expect(highestPassableTide(BRIDGE, 5000)).toBe(200);
  });

  it('fits a ship at or under that tide and not above it', () => {
    expect(fitsUnder(BRIDGE, 4800, 400)).toBe(true);
    expect(fitsUnder(BRIDGE, 4800, 401)).toBe(false);
    expect(fitsUnder(BRIDGE, 4800, 0)).toBe(true);
  });

  it('reports the room over the masthead', () => {
    expect(spareAir(BRIDGE, 4800, 400)).toBe(0);
    expect(spareAir(BRIDGE, 4800, 300)).toBe(100);
    expect(spareAir(BRIDGE, 4800, 500)).toBe(-100);
  });

  it('says when a ship can never pass at all', () => {
    expect(neverPasses(BRIDGE, 5300)).toBe(true);
    expect(neverPasses(BRIDGE, 5200)).toBe(false);
    expect(neverPasses(BRIDGE, 4000)).toBe(false);
  });

  it('describes itself in one line', () => {
    expect(describeOverhead(BRIDGE)).toBe(
      'HARBOUR-BR Harbour Bridge (bridge), 5400 cm above datum',
    );
  });
});

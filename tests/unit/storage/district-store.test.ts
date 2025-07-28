import { afterEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/util/errors';
import { migrate } from '../../../src/storage/migrate';
import {
  districtCodes,
  hasDistrict,
  loadDistrict,
  saveDistrict,
} from '../../../src/storage/district-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';
import { POSITION, testDistrict } from '../../support/district';

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

function ready(): TempDatabase {
  temp = temporaryDatabase();
  migrate(temp.db);
  saveDistrict(temp.db, { district: testDistrict(), position: POSITION });
  return temp;
}

describe('saving and loading', () => {
  it('brings back what it wrote', () => {
    const one = ready();
    const loaded = loadDistrict(one.db, 'KLR');
    expect(loaded.district.code).toBe('KLR');
    expect(loaded.district.name).toBe('Keel Room');
    expect(loaded.district.offset).toBe(-240);
    expect(loaded.position.latitude).toBeCloseTo(POSITION.latitude, 6);
  });

  it('keeps the reaches in seaward order', () => {
    const one = ready();
    expect(loadDistrict(one.db, 'KLR').district.reaches.map((reach) => reach.id)).toEqual([
      'APPROACH',
      'LOWER-BAR',
      'UPPER',
    ]);
  });

  it('brings the harmonic terms back with their station', () => {
    const one = ready();
    const station = loadDistrict(one.db, 'KLR').district.stations[0]!;
    expect(station.terms).toHaveLength(5);
    expect(station.terms.find((term) => term.name === 'M2')?.amplitude).toBe(168);
  });

  it('brings the berths and the structures back', () => {
    const one = ready();
    const district = loadDistrict(one.db, 'KLR').district;
    expect(district.berths.map((berth) => berth.id)).toEqual(['ANCH-A', 'GRAIN-3']);
    expect(district.overheads[0]?.clearance).toBe(5400);
    expect(district.berths.find((berth) => berth.id === 'GRAIN-3')?.terminal).toBe('GRAIN');
  });

  it('keeps every measurement a whole number of centimetres', () => {
    const one = ready();
    const district = loadDistrict(one.db, 'KLR').district;
    for (const reach of district.reaches) {
      expect(Number.isInteger(reach.chartedDepth)).toBe(true);
      expect(Number.isInteger(reach.surveyTolerance)).toBe(true);
    }
  });

  it('replaces the district rather than adding to it', () => {
    const one = ready();
    const smaller = {
      district: { ...testDistrict(), berths: [], overheads: [] },
      position: POSITION,
    };
    saveDistrict(one.db, smaller);
    const loaded = loadDistrict(one.db, 'KLR').district;
    expect(loaded.berths).toEqual([]);
    expect(loaded.overheads).toEqual([]);
    expect(loaded.reaches).toHaveLength(3);
  });

  it('survives a save of the same district twice', () => {
    const one = ready();
    saveDistrict(one.db, { district: testDistrict(), position: POSITION });
    expect(loadDistrict(one.db, 'KLR').district.reaches).toHaveLength(3);
  });
});

describe('looking for a district', () => {
  it('lists what is there', () => {
    const one = ready();
    expect(districtCodes(one.db)).toEqual(['KLR']);
    expect(hasDistrict(one.db, 'KLR')).toBe(true);
    expect(hasDistrict(one.db, 'NONE')).toBe(false);
  });

  it('refuses to load one that is not', () => {
    const one = ready();
    expect(() => loadDistrict(one.db, 'NONE')).toThrow(NotFoundError);
  });
});

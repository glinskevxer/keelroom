import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from '../../../src/util/errors';
import { loadDistrict } from '../../../src/storage/district-store';
import { createDistrict, parseDescription } from '../../../src/service/setup';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

const example = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'docs', 'example-district.json'), 'utf8'),
) as Record<string, unknown>;

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

describe('the description', () => {
  it('takes the example the docs carry', () => {
    const description = parseDescription(example);
    expect(description.code).toBe('KLR');
    expect(description.reaches).toHaveLength(3);
  });

  it('defaults the berths and the overheads to none', () => {
    const description = parseDescription({ ...example, berths: undefined, overheads: undefined });
    expect(description.berths).toEqual([]);
    expect(description.overheads).toEqual([]);
  });

  it('refuses a description that is not one', () => {
    expect(() => parseDescription({})).toThrow(InputError);
    expect(() => parseDescription({ ...example, code: 'keel room' })).toThrow(/not valid/);
    expect(() => parseDescription({ ...example, reaches: [] })).toThrow(/reaches/);
    expect(() => parseDescription({ ...example, nonsense: true })).toThrow(InputError);
  });

  it('names the field that was wrong', () => {
    expect(() => parseDescription({ ...example, latitude: 200 })).toThrow(/latitude/);
  });
});

describe('building the file', () => {
  it('writes a district that loads again', () => {
    temp = temporaryDatabase();
    const result = createDistrict(temp.db, example);
    expect(result).toEqual({ code: 'KLR', reaches: 3, berths: 2, stations: 1, overheads: 1 });
    const loaded = loadDistrict(temp.db, 'KLR');
    expect(loaded.district.reaches.map((reach) => reach.id)).toEqual([
      'APPROACH',
      'LOWER-BAR',
      'UPPER',
    ]);
    expect(loaded.position.latitude).toBeCloseTo(44.65, 6);
  });

  it('migrates a file that has never been used', () => {
    temp = temporaryDatabase();
    expect(() => createDistrict(temp!.db, example)).not.toThrow();
  });

  it('refuses a berth on a reach the description does not carry', () => {
    temp = temporaryDatabase();
    const broken = {
      ...example,
      berths: [
        {
          id: 'NOWHERE-1',
          name: 'Nowhere',
          kind: 'quay',
          reach: 'MISSING',
          depth: 1000,
          maxLength: 20000,
        },
      ],
    };
    expect(() => createDistrict(temp!.db, broken)).toThrow(
      /names a reach the district does not have/,
    );
  });

  it('refuses a reach against a station that is not there', () => {
    temp = temporaryDatabase();
    const broken = {
      ...example,
      reaches: [{ ...(example.reaches as Record<string, unknown>[])[0], station: 'MISSING' }],
      berths: [],
      overheads: [],
    };
    expect(() => createDistrict(temp!.db, broken)).toThrow(/names a station/);
  });

  it('writes nothing when the description is refused', () => {
    temp = temporaryDatabase();
    expect(() => createDistrict(temp!.db, { ...example, code: 'nope' })).toThrow(InputError);
    expect(() => loadDistrict(temp!.db, 'KLR')).toThrow();
  });
});

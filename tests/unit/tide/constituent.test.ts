import { describe, expect, it } from 'vitest';
import {
  constituentNames,
  cyclesPerDay,
  derivedSpeed,
  findConstituent,
  isKnownConstituent,
  knownConstituents,
  periodHours,
  requireConstituent,
  speedResidual,
} from '../../../src/domain/tide/constituent';

describe('the table', () => {
  it('carries the constituents the district publishes', () => {
    const names = constituentNames();
    for (const expected of ['M2', 'S2', 'N2', 'K1', 'O1', 'K2', 'P1', 'Q1', 'M4', 'M6']) {
      expect(names).toContain(expected);
    }
    expect(knownConstituents().length).toBeGreaterThanOrEqual(20);
  });

  it('has no duplicate names', () => {
    const names = constituentNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('looks a constituent up whatever the case', () => {
    expect(findConstituent('m2')?.name).toBe('M2');
    expect(isKnownConstituent('K1')).toBe(true);
    expect(isKnownConstituent('ZZ9')).toBe(false);
    expect(findConstituent('ZZ9')).toBeUndefined();
  });

  it('refuses an unknown name loudly', () => {
    expect(() => requireConstituent('ZZ9')).toThrow(/unknown tidal constituent/);
    expect(requireConstituent('M2').speed).toBeCloseTo(28.9841042, 7);
  });
});

describe('the doodson numbers agree with the published speeds', () => {
  it('derives every speed to within a ten thousandth of a degree an hour', () => {
    for (const constituent of knownConstituents()) {
      expect(speedResidual(constituent)).toBeLessThan(1e-4);
    }
  });

  it('derives the four the district actually plans on to seven places', () => {
    for (const name of ['M2', 'S2', 'K1', 'O1']) {
      const constituent = requireConstituent(name);
      expect(derivedSpeed(constituent)).toBeCloseTo(constituent.speed, 6);
    }
  });

  it('makes the shallow water terms multiples of their parents', () => {
    const m2 = requireConstituent('M2').speed;
    expect(requireConstituent('M4').speed).toBeCloseTo(2 * m2, 5);
    expect(requireConstituent('M6').speed).toBeCloseTo(3 * m2, 5);
    expect(requireConstituent('MS4').speed).toBeCloseTo(m2 + requireConstituent('S2').speed, 5);
  });
});

describe('derived readings', () => {
  it('reads the semidiurnal terms as twice a day', () => {
    expect(cyclesPerDay(requireConstituent('M2'))).toBeCloseTo(1.932, 3);
    expect(cyclesPerDay(requireConstituent('S2'))).toBeCloseTo(2, 6);
    expect(cyclesPerDay(requireConstituent('K1'))).toBeCloseTo(1.0027, 4);
  });

  it('gives the lunar semidiurnal period as twelve and a quarter hours', () => {
    expect(periodHours(requireConstituent('M2'))).toBeCloseTo(12.4206, 3);
    expect(periodHours(requireConstituent('S2'))).toBeCloseTo(12, 6);
  });

  it('marks the solar terms as needing no node correction', () => {
    expect(requireConstituent('S2').family).toBe('solar');
    expect(requireConstituent('P1').family).toBe('solar');
    expect(requireConstituent('M2').family).toBe('lunar-semidiurnal');
  });
});

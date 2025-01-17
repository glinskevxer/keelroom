import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { requireConstituent } from '../../../src/domain/tide/constituent';
import {
  advance,
  equilibriumArgument,
  julianCentury,
  julianDay,
  lunarTimeAngle,
  meanLongitudes,
  nodeCorrection,
  nodeCorrectionFor,
  nodeCycleDays,
  nodeFactor,
  nodeFactorFor,
  nodeStateAt,
  normaliseDegrees,
  signedDegrees,
} from '../../../src/domain/tide/astronomy';

const J2000 = parseInstant('2000-01-01T12:00Z');

describe('julian dates', () => {
  it('puts j2000 at noon on the first of january', () => {
    expect(julianDay(J2000)).toBeCloseTo(2451545, 6);
    expect(julianCentury(J2000)).toBeCloseTo(0, 9);
  });

  it('counts a century of julian years', () => {
    const later = parseInstant('2100-01-01T12:00Z');
    expect(julianCentury(later)).toBeCloseTo(1, 3);
  });

  it('reads the epoch itself', () => {
    expect(julianDay(0)).toBeCloseTo(2440587.5, 6);
  });
});

describe('mean longitudes', () => {
  it('agrees with the published values at j2000', () => {
    const longitudes = meanLongitudes(J2000);
    expect(longitudes.s).toBeCloseTo(218.3164, 3);
    expect(longitudes.h).toBeCloseTo(280.4665, 3);
    expect(longitudes.p).toBeCloseTo(83.3532, 3);
    expect(longitudes.n).toBeCloseTo(125.0446, 3);
    expect(longitudes.p1).toBeCloseTo(282.9373, 3);
  });

  it('moves the moon about thirteen degrees a day', () => {
    const first = meanLongitudes(J2000).s;
    const next = meanLongitudes(J2000 + 1440).s;
    expect(normaliseDegrees(next - first)).toBeCloseTo(13.176, 2);
  });

  it('regresses the node westward', () => {
    const first = meanLongitudes(J2000).n;
    const later = meanLongitudes(J2000 + 1440 * 365).n;
    expect(signedDegrees(later - first)).toBeCloseTo(-19.34, 1);
  });

  it('keeps every longitude in a single turn', () => {
    for (const minute of [0, J2000, J2000 + 1440 * 4000, J2000 - 1440 * 9000]) {
      const longitudes = meanLongitudes(minute);
      for (const value of Object.values(longitudes)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(360);
      }
    }
  });
});

describe('angles', () => {
  it('normalises to a single turn', () => {
    expect(normaliseDegrees(370)).toBeCloseTo(10, 9);
    expect(normaliseDegrees(-10)).toBeCloseTo(350, 9);
    expect(normaliseDegrees(720)).toBeCloseTo(0, 9);
  });

  it('signs to the half turn', () => {
    expect(signedDegrees(350)).toBeCloseTo(-10, 9);
    expect(signedDegrees(10)).toBeCloseTo(10, 9);
    expect(signedDegrees(180)).toBeCloseTo(180, 9);
    expect(signedDegrees(181)).toBeCloseTo(-179, 9);
  });

  it('turns lunar time through a full circle in a lunar day', () => {
    const start = parseInstant('2025-03-01T00:00Z');
    const angle = lunarTimeAngle(start, meanLongitudes(start));
    const later = start + 1490; // one mean lunar day, near enough
    const again = lunarTimeAngle(later, meanLongitudes(later));
    expect(Math.abs(signedDegrees(again - angle))).toBeLessThan(5);
  });
});

describe('node factors', () => {
  it('leaves the solar constituents alone at every node longitude', () => {
    for (const n of [0, 90, 180, 270]) {
      expect(nodeFactorFor('solar', n)).toBe(1);
      expect(nodeCorrectionFor('solar', n)).toBe(0);
    }
  });

  it('swings the lunar semidiurnal factor by about four percent', () => {
    expect(nodeFactorFor('lunar-semidiurnal', 0)).toBeCloseTo(0.9633, 3);
    expect(nodeFactorFor('lunar-semidiurnal', 180)).toBeCloseTo(1.0375, 3);
  });

  it('swings the diurnal factors much further', () => {
    expect(nodeFactorFor('lunar-diurnal-o1', 0)).toBeGreaterThan(1.17);
    expect(nodeFactorFor('lunar-diurnal-o1', 180)).toBeLessThan(0.84);
    expect(nodeFactorFor('lunisolar-k2', 0)).toBeGreaterThan(1.3);
  });

  it('squares and cubes the parent factor for the overtides', () => {
    const m2 = nodeFactorFor('lunar-semidiurnal', 45);
    expect(nodeFactorFor('quarter-diurnal', 45)).toBeCloseTo(m2 * m2, 9);
    expect(nodeFactorFor('sixth-diurnal', 45)).toBeCloseTo(m2 ** 3, 9);
    expect(nodeCorrectionFor('sixth-diurnal', 45)).toBeCloseTo(
      3 * nodeCorrectionFor('lunar-semidiurnal', 45),
      9,
    );
  });

  it('builds the compound terms from both parents', () => {
    const m2 = nodeFactorFor('lunar-semidiurnal', 60);
    const k1 = nodeFactorFor('lunar-diurnal-k1', 60);
    expect(nodeFactorFor('compound-mk3', 60)).toBeCloseTo(m2 * k1, 9);
    expect(nodeFactorFor('compound-ms4', 60)).toBeCloseTo(m2, 9);
  });

  it('reads a constituent through its family', () => {
    const state = nodeStateAt(parseInstant('2025-06-01T00:00Z'));
    expect(nodeFactor(requireConstituent('S2'), state)).toBe(1);
    expect(nodeFactor(requireConstituent('M2'), state)).toBeCloseTo(
      nodeFactorFor('lunar-semidiurnal', state.longitudes.n),
      9,
    );
    expect(nodeCorrection(requireConstituent('S2'), state)).toBe(0);
  });

  it('cycles the node in about eighteen and a half years', () => {
    expect(nodeCycleDays() / 365.25).toBeCloseTo(18.6, 1);
  });
});

describe('the equilibrium argument', () => {
  const state = nodeStateAt(parseInstant('2025-03-01T00:00Z'));

  it('stays inside a turn', () => {
    for (const name of ['M2', 'S2', 'K1', 'O1', 'M4']) {
      const value = equilibriumArgument(requireConstituent(name), state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(360);
    }
  });

  it('turns m4 at twice the rate of m2', () => {
    const later = nodeStateAt(state.minute + 60);
    const m2 = signedDegrees(
      equilibriumArgument(requireConstituent('M2'), later) -
        equilibriumArgument(requireConstituent('M2'), state),
    );
    const m4 = signedDegrees(
      equilibriumArgument(requireConstituent('M4'), later) -
        equilibriumArgument(requireConstituent('M4'), state),
    );
    expect(m2).toBeCloseTo(28.984, 2);
    expect(m4).toBeCloseTo(57.968, 2);
  });

  it('advances a constituent at its own speed', () => {
    expect(advance(requireConstituent('M2'), 60)).toBeCloseTo(28.9841042, 6);
    expect(advance(requireConstituent('S2'), 30)).toBeCloseTo(15, 6);
  });
});

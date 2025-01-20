import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeStation } from '../../../src/domain/tide/station';
import {
  curvatureAt,
  heightAt,
  heightExact,
  highestSample,
  lowestSample,
  predictHeight,
  predictSeries,
  prepare,
  rateAt,
} from '../../../src/domain/tide/predict';

const START = parseInstant('2025-04-01T00:00Z');

const NARROWS = makeStation({
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

const M2_ONLY = makeStation({
  id: 'M2ONLY',
  name: 'Single term',
  meanLevel: 200,
  terms: [{ name: 'M2', amplitude: 150, phase: 0 }],
});

describe('preparing a station', () => {
  it('folds the fitted lag into the argument', () => {
    const prepared = prepare(NARROWS, START);
    expect(prepared.terms).toHaveLength(5);
    expect(prepared.reference).toBe(START);
    const m2 = prepared.terms.find((term) => term.name === 'M2');
    expect(m2?.speed).toBeCloseTo(28.9841042, 6);
  });

  it('scales the amplitude by the node factor, which is near but not at one', () => {
    const m2 = prepare(NARROWS, START).terms.find((term) => term.name === 'M2');
    expect(m2?.amplitude).toBeGreaterThan(168 * 0.96);
    expect(m2?.amplitude).toBeLessThan(168 * 1.04);
    expect(m2?.amplitude).not.toBe(168);
  });

  it('leaves a solar term at its fitted amplitude', () => {
    const s2 = prepare(NARROWS, START).terms.find((term) => term.name === 'S2');
    expect(s2?.amplitude).toBeCloseTo(31, 9);
  });
});

describe('heights', () => {
  const prepared = prepare(NARROWS, START);

  it('stays inside the amplitude bounds', () => {
    for (let minute = START; minute < START + 1440 * 3; minute += 17) {
      const height = heightAt(prepared, minute);
      expect(height).toBeGreaterThan(210 - 260);
      expect(height).toBeLessThan(210 + 260);
    }
  });

  it('rounds to whole centimetres', () => {
    const minute = START + 137;
    expect(heightAt(prepared, minute)).toBe(Math.round(heightExact(prepared, minute)));
    expect(Number.isInteger(heightAt(prepared, minute))).toBe(true);
  });

  it('repeats a single term station after one lunar semidiurnal period', () => {
    const prepared1 = prepare(M2_ONLY, START);
    const period = (360 / 28.9841042) * 60;
    const first = heightExact(prepared1, START + 200);
    const later = heightExact(prepared1, START + 200 + period);
    expect(later).toBeCloseTo(first, 6);
  });

  it('swings a single term station over its whole range in half a period', () => {
    const prepared1 = prepare(M2_ONLY, START);
    let highest = -Infinity;
    let lowest = Infinity;
    for (let minute = START; minute < START + 800; minute += 1) {
      const height = heightExact(prepared1, minute);
      highest = Math.max(highest, height);
      lowest = Math.min(lowest, height);
    }
    expect(highest).toBeCloseTo(200 + 150 * 0.9633, 0);
    expect(lowest).toBeCloseTo(200 - 150 * 0.9633, 0);
  });

  it('predicts a single height without a prepared station', () => {
    expect(predictHeight(NARROWS, START + 500)).toBe(
      heightAt(prepare(NARROWS, START + 500), START + 500),
    );
  });
});

describe('rate and curvature', () => {
  const prepared = prepare(NARROWS, START);

  it('matches a finite difference of the height', () => {
    for (const offset of [0, 90, 200, 613]) {
      const minute = START + offset;
      const numeric = (heightExact(prepared, minute + 1) - heightExact(prepared, minute - 1)) / 2;
      expect(rateAt(prepared, minute) / 60).toBeCloseTo(numeric, 4);
    }
  });

  it('matches a finite difference of the rate', () => {
    const minute = START + 300;
    const numeric = (rateAt(prepared, minute + 1) - rateAt(prepared, minute - 1)) / 2;
    expect(curvatureAt(prepared, minute) / 60).toBeCloseTo(numeric, 4);
  });

  it('turns the rate through zero at the top of the tide', () => {
    const prepared1 = prepare(M2_ONLY, START);
    let previous = rateAt(prepared1, START);
    let crossings = 0;
    for (let minute = START + 1; minute < START + 1440; minute += 1) {
      const rate = rateAt(prepared1, minute);
      if (Math.sign(rate) !== Math.sign(previous)) {
        crossings += 1;
      }
      previous = rate;
    }
    expect(crossings).toBe(4);
  });

  it('curves down at a high water and up at a low water', () => {
    const prepared1 = prepare(M2_ONLY, START);
    const samples = predictSeries(M2_ONLY, START, START + 1440, 5);
    const high = highestSample(samples);
    const low = lowestSample(samples);
    expect(curvatureAt(prepared1, high.minute)).toBeLessThan(0);
    expect(curvatureAt(prepared1, low.minute)).toBeGreaterThan(0);
  });
});

describe('series', () => {
  it('covers the range at the step it was given', () => {
    const samples = predictSeries(NARROWS, START, START + 120, 30);
    expect(samples.map((sample) => sample.minute - START)).toEqual([0, 30, 60, 90, 120]);
  });

  it('always includes the end of the range', () => {
    const samples = predictSeries(NARROWS, START, START + 100, 30);
    expect(samples[samples.length - 1]?.minute).toBe(START + 100);
  });

  it('handles a range of one minute', () => {
    const samples = predictSeries(NARROWS, START, START, 10);
    expect(samples).toHaveLength(1);
  });

  it('refuses a step that is not a whole positive number of minutes', () => {
    expect(() => predictSeries(NARROWS, START, START + 60, 0)).toThrow(/whole number of minutes/);
    expect(() => predictSeries(NARROWS, START, START + 60, 2.5)).toThrow(/whole number of minutes/);
  });

  it('refuses a backwards range', () => {
    expect(() => predictSeries(NARROWS, START + 60, START, 10)).toThrow(/ends before it starts/);
  });

  it('finds the highest and lowest sample', () => {
    const samples = predictSeries(NARROWS, START, START + 1440, 10);
    const high = highestSample(samples);
    const low = lowestSample(samples);
    expect(high.height).toBeGreaterThan(low.height);
    expect(samples.every((sample) => sample.height <= high.height)).toBe(true);
    expect(samples.every((sample) => sample.height >= low.height)).toBe(true);
  });

  it('refuses to pick from nothing', () => {
    expect(() => highestSample([])).toThrow(/no samples/);
    expect(() => lowestSample([])).toThrow(/no samples/);
  });
});

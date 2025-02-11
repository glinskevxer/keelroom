import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeInterval, totalMinutes } from '../../../src/util/interval';
import { makeStation } from '../../../src/domain/tide/station';
import { predictHeight } from '../../../src/domain/tide/predict';
import {
  firstReaches,
  intervalsAtOrAbove,
  intervalsAtOrBelow,
  maximumHeightOver,
  minimumHeightOver,
} from '../../../src/domain/tide/crossing';

const START = parseInstant('2025-04-01T00:00Z');
const DAY = 1440;
const BOUNDS = makeInterval(START, START + DAY);

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

describe('stretches above a height', () => {
  it('gives the whole range when the tide never falls that far', () => {
    const windows = intervalsAtOrAbove(NARROWS, BOUNDS, -100);
    expect(windows).toEqual([{ from: BOUNDS.from, to: BOUNDS.to }]);
  });

  it('gives nothing when the tide never reaches it', () => {
    expect(intervalsAtOrAbove(NARROWS, BOUNDS, 900)).toEqual([]);
  });

  it('finds two stretches a day around a middling height', () => {
    const windows = intervalsAtOrAbove(NARROWS, BOUNDS, 300);
    expect(windows.length).toBeGreaterThanOrEqual(1);
    expect(windows.length).toBeLessThanOrEqual(3);
    expect(totalMinutes(windows)).toBeGreaterThan(60);
  });

  it('holds the height at both edges of every stretch', () => {
    for (const window of intervalsAtOrAbove(NARROWS, BOUNDS, 300)) {
      expect(predictHeight(NARROWS, window.from)).toBeGreaterThanOrEqual(300);
      expect(predictHeight(NARROWS, window.to)).toBeGreaterThanOrEqual(300);
    }
  });

  it('holds the height right through a stretch', () => {
    const window = intervalsAtOrAbove(NARROWS, BOUNDS, 320)[0]!;
    for (let minute = window.from; minute <= window.to; minute += 3) {
      expect(predictHeight(NARROWS, minute)).toBeGreaterThanOrEqual(320);
    }
  });

  it('fails the height just outside a stretch', () => {
    const window = intervalsAtOrAbove(NARROWS, BOUNDS, 320)[0]!;
    if (window.from > BOUNDS.from) {
      expect(predictHeight(NARROWS, window.from - 2)).toBeLessThan(320);
    }
    if (window.to < BOUNDS.to) {
      expect(predictHeight(NARROWS, window.to + 2)).toBeLessThan(320);
    }
  });

  it('gives the same stretches at a finer scan', () => {
    const coarse = intervalsAtOrAbove(NARROWS, BOUNDS, 300, { scanMinutes: 15 });
    const fine = intervalsAtOrAbove(NARROWS, BOUNDS, 300, { scanMinutes: 1 });
    expect(coarse.length).toBe(fine.length);
    for (let index = 0; index < coarse.length; index += 1) {
      expect(Math.abs(coarse[index]!.from - fine[index]!.from)).toBeLessThanOrEqual(1);
      expect(Math.abs(coarse[index]!.to - fine[index]!.to)).toBeLessThanOrEqual(1);
    }
  });

  it('refuses a step or a range it cannot scan', () => {
    expect(() => intervalsAtOrAbove(NARROWS, BOUNDS, 300, { scanMinutes: 0 })).toThrow(
      /whole number of minutes/,
    );
    expect(() => intervalsAtOrAbove(NARROWS, { from: BOUNDS.to, to: BOUNDS.from }, 300)).toThrow(
      /ends before it starts/,
    );
  });
});

describe('stretches below a height', () => {
  it('is the complement of the stretches above it, give or take an edge minute', () => {
    const above = intervalsAtOrAbove(NARROWS, BOUNDS, 300);
    const below = intervalsAtOrBelow(NARROWS, BOUNDS, 299);
    expect(totalMinutes(above) + totalMinutes(below)).toBeGreaterThan(DAY - 10);
    expect(totalMinutes(above) + totalMinutes(below)).toBeLessThan(DAY + 10);
  });

  it('holds the height at both edges', () => {
    for (const window of intervalsAtOrBelow(NARROWS, BOUNDS, 250)) {
      expect(predictHeight(NARROWS, window.from)).toBeLessThanOrEqual(250);
      expect(predictHeight(NARROWS, window.to)).toBeLessThanOrEqual(250);
    }
  });

  it('gives the whole range under a ceiling nothing reaches', () => {
    expect(intervalsAtOrBelow(NARROWS, BOUNDS, 900)).toEqual([
      { from: BOUNDS.from, to: BOUNDS.to },
    ]);
  });
});

describe('reading the curve over a stretch', () => {
  it('finds the first minute a height is reached', () => {
    const first = firstReaches(NARROWS, BOUNDS, 300)!;
    expect(predictHeight(NARROWS, first)).toBeGreaterThanOrEqual(300);
    expect(firstReaches(NARROWS, BOUNDS, 900)).toBeUndefined();
  });

  it('gives the least and the most tide over an interval', () => {
    const interval = makeInterval(START, START + 360);
    const least = minimumHeightOver(NARROWS, interval);
    const most = maximumHeightOver(NARROWS, interval);
    expect(least).toBeLessThanOrEqual(most);
    for (let minute = interval.from; minute <= interval.to; minute += 7) {
      const height = predictHeight(NARROWS, minute);
      expect(height).toBeGreaterThanOrEqual(least - 1);
      expect(height).toBeLessThanOrEqual(most + 1);
    }
  });

  it('reads a single minute interval as one height', () => {
    const interval = makeInterval(START, START);
    expect(minimumHeightOver(NARROWS, interval)).toBe(maximumHeightOver(NARROWS, interval));
  });
});

import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeStation } from '../../../src/domain/tide/station';
import { predictHeight } from '../../../src/domain/tide/predict';
import {
  findExtremes,
  highWaters,
  lastExtremeBefore,
  lowWaters,
  nextExtremeAfter,
  rangeAround,
  shallowestLowWater,
  tallestHighWater,
  tideState,
} from '../../../src/domain/tide/extremes';

const START = parseInstant('2025-04-01T00:00Z');
const DAY = 1440;

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

const DIURNAL = makeStation({
  id: 'GULFEND',
  name: 'Gulf End',
  meanLevel: 90,
  terms: [
    { name: 'K1', amplitude: 44, phase: 12.5 },
    { name: 'O1', amplitude: 41, phase: 358.1 },
    { name: 'M2', amplitude: 9, phase: 130.2 },
    { name: 'S2', amplitude: 4, phase: 150.9 },
  ],
});

describe('finding the turns', () => {
  const extremes = findExtremes(NARROWS, START, START + DAY);

  it('finds four turns a day at a semidiurnal port', () => {
    expect(extremes.length).toBeGreaterThanOrEqual(3);
    expect(extremes.length).toBeLessThanOrEqual(4);
  });

  it('alternates high and low', () => {
    for (let index = 1; index < extremes.length; index += 1) {
      expect(extremes[index]?.kind).not.toBe(extremes[index - 1]?.kind);
    }
  });

  it('keeps them in time order and inside the range', () => {
    for (let index = 1; index < extremes.length; index += 1) {
      expect(extremes[index]!.minute).toBeGreaterThan(extremes[index - 1]!.minute);
    }
    for (const extreme of extremes) {
      expect(extreme.minute).toBeGreaterThanOrEqual(START);
      expect(extreme.minute).toBeLessThanOrEqual(START + DAY);
    }
  });

  it('puts a high water above its neighbouring minutes', () => {
    for (const extreme of highWaters(extremes)) {
      const height = predictHeight(NARROWS, extreme.minute);
      expect(height).toBeGreaterThanOrEqual(predictHeight(NARROWS, extreme.minute - 20));
      expect(height).toBeGreaterThanOrEqual(predictHeight(NARROWS, extreme.minute + 20));
    }
  });

  it('puts a low water below its neighbouring minutes', () => {
    for (const extreme of lowWaters(extremes)) {
      const height = predictHeight(NARROWS, extreme.minute);
      expect(height).toBeLessThanOrEqual(predictHeight(NARROWS, extreme.minute - 20));
      expect(height).toBeLessThanOrEqual(predictHeight(NARROWS, extreme.minute + 20));
    }
  });

  it('separates two high waters by about half a lunar day', () => {
    const highs = highWaters(findExtremes(NARROWS, START, START + 2 * DAY));
    for (let index = 1; index < highs.length; index += 1) {
      const gap = highs[index]!.minute - highs[index - 1]!.minute;
      expect(gap).toBeGreaterThan(700);
      expect(gap).toBeLessThan(790);
    }
  });

  it('finds one turn each way a day at a diurnal port', () => {
    const daily = findExtremes(DIURNAL, START, START + DAY);
    expect(highWaters(daily).length).toBeLessThanOrEqual(2);
    expect(daily.length).toBeGreaterThanOrEqual(2);
  });

  it('gives the same answer at a finer scan', () => {
    const fine = findExtremes(NARROWS, START, START + DAY, { scanMinutes: 2 });
    expect(fine.length).toBe(extremes.length);
    for (let index = 0; index < fine.length; index += 1) {
      expect(Math.abs(fine[index]!.minute - extremes[index]!.minute)).toBeLessThanOrEqual(2);
    }
  });

  it('refuses a range or a step it cannot scan', () => {
    expect(() => findExtremes(NARROWS, START + DAY, START)).toThrow(/ends before it starts/);
    expect(() => findExtremes(NARROWS, START, START + DAY, { scanMinutes: 0 })).toThrow(
      /whole number of minutes/,
    );
    expect(() => findExtremes(NARROWS, START, START + DAY, { scanMinutes: 1.5 })).toThrow(
      /whole number of minutes/,
    );
  });
});

describe('reading a set of turns', () => {
  const extremes = findExtremes(NARROWS, START, START + 2 * DAY);

  it('finds the turn before and after a moment', () => {
    const middle = extremes[2]!.minute;
    expect(lastExtremeBefore(extremes, middle)?.minute).toBe(middle);
    expect(nextExtremeAfter(extremes, middle)?.minute).toBe(extremes[3]!.minute);
    expect(lastExtremeBefore(extremes, START - 10)).toBeUndefined();
    expect(nextExtremeAfter(extremes, START + 3 * DAY)).toBeUndefined();
  });

  it('says whether the tide is making or falling', () => {
    const first = extremes[0]!;
    expect(tideState(extremes, first.minute - 30)).toBe(
      first.kind === 'high' ? 'making' : 'falling',
    );
    expect(tideState(extremes, START + 5 * DAY)).toBe('unknown');
  });

  it('measures the range between one turn and the next', () => {
    const range = rangeAround(extremes, 0);
    expect(range).toBeGreaterThan(100);
    expect(rangeAround(extremes, extremes.length - 1)).toBeUndefined();
    expect(rangeAround(extremes, 99)).toBeUndefined();
  });

  it('picks the tallest high and the shallowest low', () => {
    const tallest = tallestHighWater(extremes)!;
    const shallowest = shallowestLowWater(extremes)!;
    expect(highWaters(extremes).every((extreme) => extreme.height <= tallest.height)).toBe(true);
    expect(lowWaters(extremes).every((extreme) => extreme.height >= shallowest.height)).toBe(true);
    expect(tallest.height).toBeGreaterThan(shallowest.height);
  });

  it('gives nothing back from an empty set', () => {
    expect(tallestHighWater([])).toBeUndefined();
    expect(shallowestLowWater([])).toBeUndefined();
    expect(lastExtremeBefore([], START)).toBeUndefined();
  });
});

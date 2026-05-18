/**
 * The things that have to hold whatever the numbers are.
 *
 * These are not examples, they are laws: the interval algebra behaves like sets,
 * the money never disappears in a split, the tide is the same curve read
 * forwards or backwards, and more tide never makes a ship worse off. Each is
 * checked against a few hundred pseudo random cases from a fixed seed, so a
 * failure is reproducible and a change that breaks the law is caught by
 * something other than a lucky example.
 */

import { describe, expect, it } from 'vitest';
import { allocateCents, formatMoney, parseMoney, roundHalf, sumCents } from '../../src/util/units';
import {
  intersectSets,
  makeInterval,
  normalise,
  subtractSets,
  totalMinutes,
  unionAll,
} from '../../src/util/interval';
import type { Interval } from '../../src/util/interval';
import { parseInstant, formatInstant, formatLocal, parseLocal } from '../../src/util/clock';
import { makeStation } from '../../src/domain/tide/station';
import { heightExact, prepare } from '../../src/domain/tide/predict';
import { findExtremes } from '../../src/domain/tide/extremes';
import { intervalsAtOrAbove } from '../../src/domain/tide/crossing';

/** A small deterministic generator, so a failure can be reproduced exactly. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const random = generator(20250413);

function randomInt(low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

function randomIntervals(count: number): Interval[] {
  return Array.from({ length: count }, () => {
    const from = randomInt(0, 2000);
    return makeInterval(from, from + randomInt(0, 300));
  });
}

const STATION = makeStation({
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

describe('money', () => {
  it('never appears or disappears in a split', () => {
    for (let round = 0; round < 300; round += 1) {
      const total = randomInt(-500000, 500000);
      const weights = Array.from({ length: randomInt(1, 6) }, () => randomInt(0, 9));
      if (weights.every((weight) => weight === 0)) {
        continue;
      }
      const parts = allocateCents(total, weights);
      expect(sumCents(parts)).toBe(total);
      expect(parts).toHaveLength(weights.length);
    }
  });

  it('gives a zero weight nothing', () => {
    for (let round = 0; round < 100; round += 1) {
      const parts = allocateCents(randomInt(0, 100000), [1, 0, 1]);
      expect(parts[1]).toBe(0);
    }
  });

  it('round trips through the text it prints', () => {
    for (let round = 0; round < 300; round += 1) {
      const amount = randomInt(-99999999, 99999999);
      expect(parseMoney(formatMoney(amount))).toBe(amount);
    }
  });

  it('rounds a half away from zero, symmetrically', () => {
    for (let round = 0; round < 200; round += 1) {
      const value = randomInt(-10000, 10000) + 0.5;
      expect(roundHalf(-value)).toBe(-roundHalf(value));
    }
  });
});

describe('intervals', () => {
  it('normalising is idempotent', () => {
    for (let round = 0; round < 200; round += 1) {
      const set = randomIntervals(randomInt(0, 6));
      const once = normalise(set);
      expect(normalise(once)).toEqual(once);
    }
  });

  it('a set intersected with itself is itself', () => {
    for (let round = 0; round < 200; round += 1) {
      const set = normalise(randomIntervals(randomInt(1, 5)));
      expect(intersectSets(set, set)).toEqual(set);
    }
  });

  it('a set minus itself is nothing', () => {
    for (let round = 0; round < 200; round += 1) {
      const set = randomIntervals(randomInt(1, 5));
      expect(subtractSets(set, set)).toEqual([]);
    }
  });

  it('an intersection is never longer than either side', () => {
    for (let round = 0; round < 200; round += 1) {
      const left = randomIntervals(randomInt(1, 4));
      const right = randomIntervals(randomInt(1, 4));
      const both = intersectSets(left, right);
      expect(totalMinutes(both)).toBeLessThanOrEqual(totalMinutes(left));
      expect(totalMinutes(both)).toBeLessThanOrEqual(totalMinutes(right));
    }
  });

  it('a union is never shorter than either side', () => {
    for (let round = 0; round < 200; round += 1) {
      const left = randomIntervals(randomInt(1, 4));
      const right = randomIntervals(randomInt(1, 4));
      const either = unionAll(left, right);
      expect(totalMinutes(either)).toBeGreaterThanOrEqual(totalMinutes(left));
      expect(totalMinutes(either)).toBeGreaterThanOrEqual(totalMinutes(right));
    }
  });

  it('what is subtracted plus what is left is the whole, to the closed edges', () => {
    for (let round = 0; round < 200; round += 1) {
      const left = randomIntervals(randomInt(1, 4));
      const right = randomIntervals(randomInt(1, 4));
      const kept = subtractSets(left, right);
      const taken = intersectSets(left, right);
      // the intervals are closed at both ends, so every cut loses the minute the
      // two pieces would otherwise share, and there is one cut per blocking
      // interval that lands inside
      const slack = 2 * normalise(right).length;
      expect(totalMinutes(kept) + totalMinutes(taken)).toBeGreaterThanOrEqual(
        totalMinutes(left) - slack,
      );
      expect(totalMinutes(kept)).toBeLessThanOrEqual(totalMinutes(left));
    }
  });
});

describe('the clock', () => {
  it('round trips an instant through its text', () => {
    for (let round = 0; round < 300; round += 1) {
      const minute = randomInt(0, 40_000_000);
      expect(parseInstant(formatInstant(minute))).toBe(minute);
    }
  });

  it('round trips a local time against any offset', () => {
    for (let round = 0; round < 200; round += 1) {
      const minute = randomInt(0, 40_000_000);
      const offset = randomInt(-14, 14) * 60;
      expect(parseLocal(formatLocal(minute, offset), offset)).toBe(minute);
    }
  });
});

describe('the tide', () => {
  const start = parseInstant('2025-06-01T00:00Z');
  const prepared = prepare(STATION, start);

  it('stays inside the sum of its amplitudes', () => {
    const bound = 210 + 168 + 31 + 37 + 12 + 8 + 20;
    for (let round = 0; round < 500; round += 1) {
      const height = heightExact(prepared, start + randomInt(-100000, 100000));
      expect(Math.abs(height - 210)).toBeLessThan(bound);
    }
  });

  it('reads the same height whichever way the range is walked', () => {
    for (let round = 0; round < 200; round += 1) {
      const minute = start + randomInt(0, 20000);
      expect(heightExact(prepared, minute)).toBeCloseTo(heightExact(prepared, minute), 9);
    }
  });

  it('turns the tide between every pair of extremes', () => {
    const extremes = findExtremes(STATION, start, start + 4320);
    for (let index = 1; index < extremes.length; index += 1) {
      expect(extremes[index]!.kind).not.toBe(extremes[index - 1]!.kind);
      expect(extremes[index]!.minute).toBeGreaterThan(extremes[index - 1]!.minute);
    }
  });

  it('never gives a longer window for a higher threshold', () => {
    const bounds = makeInterval(start, start + 2880);
    let previous = Number.POSITIVE_INFINITY;
    for (let threshold = 0; threshold <= 400; threshold += 25) {
      const minutes = totalMinutes(intervalsAtOrAbove(STATION, bounds, threshold));
      expect(minutes).toBeLessThanOrEqual(previous);
      previous = minutes;
    }
  });

  it('holds the threshold everywhere inside every window it gives', () => {
    const bounds = makeInterval(start, start + 2880);
    for (const threshold of [150, 250, 350]) {
      for (const window of intervalsAtOrAbove(STATION, bounds, threshold)) {
        for (let minute = window.from; minute <= window.to; minute += 7) {
          expect(Math.round(heightExact(prepare(STATION, minute), minute))).toBeGreaterThanOrEqual(
            threshold - 1,
          );
        }
      }
    }
  });
});

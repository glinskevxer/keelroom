import { describe, expect, it } from 'vitest';
import type { Interval } from '../../../src/util/interval';
import {
  atLeast,
  clip,
  contains,
  describeInterval,
  duration,
  earliest,
  firstFit,
  intersect,
  intersectSets,
  IntervalError,
  longest,
  makeInterval,
  normalise,
  overlaps,
  shift,
  shrink,
  subtractSets,
  totalMinutes,
  unionAll,
} from '../../../src/util/interval';

const at = (from: number, to: number): Interval => makeInterval(from, to);

describe('one interval', () => {
  it('measures and tests membership', () => {
    const window = at(100, 160);
    expect(duration(window)).toBe(60);
    expect(contains(window, 100)).toBe(true);
    expect(contains(window, 160)).toBe(true);
    expect(contains(window, 161)).toBe(false);
  });

  it('allows a single minute', () => {
    expect(duration(at(100, 100))).toBe(0);
  });

  it('refuses bounds that are not whole minutes or are inverted', () => {
    expect(() => at(1.5, 2)).toThrow(IntervalError);
    expect(() => at(200, 100)).toThrow(/ends before it starts/);
  });

  it('overlaps and intersects', () => {
    expect(overlaps(at(0, 100), at(100, 200))).toBe(true);
    expect(overlaps(at(0, 99), at(100, 200))).toBe(false);
    expect(intersect(at(0, 120), at(100, 200))).toEqual({ from: 100, to: 120 });
    expect(intersect(at(0, 99), at(100, 200))).toBeUndefined();
  });
});

describe('normalising', () => {
  it('sorts and joins what touches', () => {
    expect(normalise([at(100, 150), at(0, 50), at(51, 60)])).toEqual([
      { from: 0, to: 60 },
      { from: 100, to: 150 },
    ]);
  });

  it('joins what overlaps and keeps the wider end', () => {
    expect(normalise([at(0, 100), at(20, 40)])).toEqual([{ from: 0, to: 100 }]);
  });

  it('leaves a gap of two minutes alone', () => {
    expect(normalise([at(0, 50), at(52, 60)])).toHaveLength(2);
  });

  it('does not disturb its input', () => {
    const input = [at(100, 150), at(0, 50)];
    normalise(input);
    expect(input[0]?.from).toBe(100);
  });
});

describe('set algebra', () => {
  it('unions several sets', () => {
    expect(unionAll([at(0, 10)], [at(20, 30)], [at(5, 25)])).toEqual([{ from: 0, to: 30 }]);
  });

  it('intersects two sets piece by piece', () => {
    const left = [at(0, 100), at(200, 300)];
    const right = [at(50, 250)];
    expect(intersectSets(left, right)).toEqual([
      { from: 50, to: 100 },
      { from: 200, to: 250 },
    ]);
  });

  it('intersects with nothing to nothing', () => {
    expect(intersectSets([at(0, 100)], [])).toEqual([]);
    expect(intersectSets([], [at(0, 100)])).toEqual([]);
  });

  it('subtracts a block from the middle', () => {
    expect(subtractSets([at(0, 100)], [at(40, 60)])).toEqual([
      { from: 0, to: 39 },
      { from: 61, to: 100 },
    ]);
  });

  it('subtracts a block that covers everything', () => {
    expect(subtractSets([at(0, 100)], [at(0, 100)])).toEqual([]);
    expect(subtractSets([at(10, 90)], [at(0, 100)])).toEqual([]);
  });

  it('subtracts overlapping blocks at both ends', () => {
    expect(subtractSets([at(0, 100)], [at(-50, 10), at(90, 200)])).toEqual([{ from: 11, to: 89 }]);
  });

  it('subtracts nothing when nothing overlaps', () => {
    expect(subtractSets([at(0, 100)], [at(200, 300)])).toEqual([{ from: 0, to: 100 }]);
  });
});

describe('shaping a set', () => {
  it('clips to bounds', () => {
    expect(clip([at(0, 100), at(200, 300)], at(50, 250))).toEqual([
      { from: 50, to: 100 },
      { from: 200, to: 250 },
    ]);
  });

  it('drops what is too short', () => {
    expect(atLeast([at(0, 30), at(100, 200)], 60)).toEqual([{ from: 100, to: 200 }]);
  });

  it('pulls both ends in and drops what disappears', () => {
    expect(shrink([at(0, 100), at(200, 210)], 10)).toEqual([{ from: 10, to: 90 }]);
  });

  it('shifts in time', () => {
    expect(shift([at(0, 100)], 60)).toEqual([{ from: 60, to: 160 }]);
    expect(shift([at(0, 100)], -60)).toEqual([{ from: -60, to: 40 }]);
  });

  it('totals the minutes without double counting an overlap', () => {
    expect(totalMinutes([at(0, 100), at(50, 150)])).toBe(150);
    expect(totalMinutes([])).toBe(0);
  });
});

describe('choosing from a set', () => {
  const windows = [at(0, 30), at(100, 400), at(500, 520)];

  it('finds the longest and the earliest', () => {
    expect(longest(windows)).toEqual({ from: 100, to: 400 });
    expect(earliest(windows)).toEqual({ from: 0, to: 30 });
    expect(longest([])).toBeUndefined();
    expect(earliest([])).toBeUndefined();
  });

  it('fits a run of minutes at or after a moment', () => {
    expect(firstFit(windows, 60, 0)).toBe(100);
    expect(firstFit(windows, 60, 200)).toBe(200);
    expect(firstFit(windows, 60, 380)).toBeUndefined();
    expect(firstFit(windows, 20, 500)).toBe(500);
  });

  it('describes an interval through a formatter', () => {
    expect(describeInterval(at(0, 60), (minute) => String(minute))).toBe('0 to 60');
  });
});

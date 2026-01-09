import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { makeInterval } from '../../../src/util/interval';
import {
  allocateTugs,
  bookingsFor,
  byOwner,
  describeTug,
  fleetPull,
  freeTugs,
  isFree,
  makeTug,
} from '../../../src/domain/tug/tug';
import type { Tug, TugBooking } from '../../../src/domain/tug/tug';

const PERIOD = makeInterval(1000, 1200);

function tug(
  id: string,
  pull: number,
  overrides: Partial<Parameters<typeof makeTug>[0]> = {},
): Tug {
  return makeTug({ id, name: `Tug ${id}`, owner: 'HARBOUR TOWAGE', pull, ...overrides });
}

const FLEET = [
  tug('T1', 45),
  tug('T2', 60, { escort: true }),
  tug('T3', 30, { owner: 'RIVER TUGS' }),
  tug('T4', 25, { active: false }),
];

describe('building a tug', () => {
  it('keeps what it was given', () => {
    expect(tug('T1', 45).pull).toBe(45);
    expect(tug('T2', 60, { escort: true }).escort).toBe(true);
    expect(tug('T1', 45).active).toBe(true);
  });

  it('refuses one that is not a tug', () => {
    expect(() => tug('four', 45)).toThrow(/look like T4/);
    expect(() => tug('T1', 0)).toThrow(/pulls nothing/);
    expect(() => makeTug({ id: 'T1', name: '  ', owner: 'x', pull: 10 })).toThrow(/has no name/);
    expect(() => tug('T1', 12.5)).toThrow(InputError);
  });

  it('describes itself in a line', () => {
    expect(describeTug(FLEET[1]!)).toBe('T2 Tug T2, 60 t, escort fitted');
    expect(describeTug(FLEET[3]!)).toContain('laid up');
  });
});

describe('what is free', () => {
  const bookings: TugBooking[] = [{ tug: 'T1', movement: 'M-1', period: PERIOD }];

  it('reads a booked tug as busy for the period', () => {
    expect(isFree(bookings, 'T1', PERIOD)).toBe(false);
    expect(isFree(bookings, 'T1', makeInterval(2000, 2100))).toBe(true);
    expect(isFree(bookings, 'T2', PERIOD)).toBe(true);
  });

  it('leaves out the laid up ones', () => {
    expect(freeTugs(FLEET, [], PERIOD).map((each) => each.id)).toEqual(['T1', 'T2', 'T3']);
  });

  it('leaves out the busy ones', () => {
    expect(freeTugs(FLEET, bookings, PERIOD).map((each) => each.id)).toEqual(['T2', 'T3']);
  });

  it('totals what the fleet can pull at all', () => {
    expect(fleetPull(FLEET)).toBe(135);
  });

  it('groups by who owns them', () => {
    expect(Object.keys(byOwner(FLEET)).sort()).toEqual(['HARBOUR TOWAGE', 'RIVER TUGS']);
  });

  it('finds the bookings for one movement', () => {
    expect(bookingsFor(bookings, 'M-1')).toHaveLength(1);
    expect(bookingsFor(bookings, 'M-2')).toEqual([]);
  });
});

describe('allocating', () => {
  it('takes the strongest first', () => {
    const allocation = allocateTugs(FLEET, [], { count: 2, pull: 80, period: PERIOD });
    expect(allocation.tugs.map((each) => each.id)).toEqual(['T2', 'T1']);
    expect(allocation.met).toBe(true);
    expect(allocation.pull).toBe(105);
  });

  it('takes an escort tug first when one is wanted', () => {
    const allocation = allocateTugs(FLEET, [], {
      count: 1,
      pull: 40,
      escort: true,
      period: PERIOD,
    });
    expect(allocation.tugs.map((each) => each.id)).toEqual(['T2']);
  });

  it('refuses when no escort tug is free', () => {
    const bookings: TugBooking[] = [{ tug: 'T2', movement: 'M-1', period: PERIOD }];
    const allocation = allocateTugs(FLEET, bookings, {
      count: 1,
      pull: 20,
      escort: true,
      period: PERIOD,
    });
    expect(allocation.met).toBe(false);
    expect(allocation.reason).toContain('no escort tug');
  });

  it('says how many hulls short it is', () => {
    const allocation = allocateTugs(FLEET, [], { count: 5, pull: 10, period: PERIOD });
    expect(allocation.shortBy).toBe(2);
    expect(allocation.reason).toContain('2 short of the hulls');
  });

  it('says how many tonnes short it is', () => {
    const allocation = allocateTugs(FLEET, [], { count: 2, pull: 200, period: PERIOD });
    expect(allocation.met).toBe(false);
    expect(allocation.reason).toContain('tonnes short');
  });

  it('takes nothing when nothing is wanted', () => {
    const allocation = allocateTugs(FLEET, [], { count: 0, pull: 0, period: PERIOD });
    expect(allocation.tugs).toEqual([]);
    expect(allocation.met).toBe(true);
  });

  it('refuses a demand that is not a whole number of tugs', () => {
    expect(() => allocateTugs(FLEET, [], { count: 1.5, pull: 10, period: PERIOD })).toThrow(
      InputError,
    );
  });

  it('never takes the same tug twice', () => {
    const allocation = allocateTugs(FLEET, [], {
      count: 3,
      pull: 10,
      escort: true,
      period: PERIOD,
    });
    expect(new Set(allocation.tugs.map((each) => each.id)).size).toBe(allocation.tugs.length);
  });
});

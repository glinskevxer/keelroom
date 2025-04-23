import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import {
  availableFrom,
  checkJob,
  dutyMinutesIn,
  entriesIn,
  jobsWorked,
  lastEntryBefore,
  makeDutyEntry,
  restAfter,
  STANDARD_REST,
  totalDuty,
} from '../../../src/domain/roster/duty';

const T = parseInstant('2025-05-01T00:00Z');
const h = (hours: number): number => T + hours * 60;

const LOG = [
  makeDutyEntry('P07', 'M-1', h(0), h(4)),
  makeDutyEntry('P07', 'M-2', h(20), h(23)),
  makeDutyEntry('P02', 'M-3', h(6), h(9)),
];

describe('reading the log', () => {
  it('finds the entries touching a window, in order', () => {
    const found = entriesIn(LOG, { from: h(3), to: h(7) });
    expect(found.map((entry) => entry.movement)).toEqual(['M-1', 'M-3']);
  });

  it('counts only the overlapping minutes', () => {
    expect(dutyMinutesIn(LOG, { from: h(3), to: h(7) })).toBe(60 + 60);
    expect(dutyMinutesIn(LOG, { from: h(0), to: h(24) })).toBe(240 + 180 + 180);
    expect(dutyMinutesIn(LOG, { from: h(30), to: h(40) })).toBe(0);
  });

  it('finds the last job that finished before a moment', () => {
    expect(lastEntryBefore(LOG, h(10))?.movement).toBe('M-3');
    expect(lastEntryBefore(LOG, h(0))).toBeUndefined();
  });

  it('totals the duty and picks out one pilot', () => {
    expect(totalDuty(LOG)).toBe(600);
    expect(jobsWorked(LOG, 'P07')).toHaveLength(2);
    expect(jobsWorked(LOG, 'P99')).toEqual([]);
  });

  it('refuses a duty period that ends before it starts', () => {
    expect(() => makeDutyEntry('P07', 'M-9', h(5), h(4))).toThrow(/ends before it starts/);
  });
});

describe('rest owed', () => {
  it('owes the minimum after an ordinary job', () => {
    expect(restAfter(STANDARD_REST, LOG[0]!)).toBe(600);
  });

  it('owes more after a long one', () => {
    const long = makeDutyEntry('P07', 'M-9', h(0), h(9));
    expect(restAfter(STANDARD_REST, long)).toBe(900);
  });

  it('gives the first minute a pilot is free again', () => {
    const free = availableFrom(STANDARD_REST, jobsWorked(LOG, 'P07'), T);
    expect(free).toBe(h(23) + 600);
  });

  it('gives the moment asked about when nothing has been worked', () => {
    expect(availableFrom(STANDARD_REST, [], h(5))).toBe(h(5));
  });

  it('never gives a moment before the one asked about', () => {
    expect(availableFrom(STANDARD_REST, jobsWorked(LOG, 'P02'), h(100))).toBe(h(100));
  });
});

describe('checking a job against the rules', () => {
  const worked = jobsWorked(LOG, 'P07');

  it('allows a job clear of everything', () => {
    const check = checkJob(STANDARD_REST, worked, { from: h(40), to: h(43) });
    expect(check.allowed).toBe(true);
    expect(check.breaches).toEqual([]);
  });

  it('refuses a job that starts inside the rest period', () => {
    const check = checkJob(STANDARD_REST, worked, { from: h(25), to: h(27) });
    expect(check.breaches).toContain('rest');
    expect(check.allowed).toBe(false);
  });

  it('refuses a job that overlaps one already worked', () => {
    const check = checkJob(STANDARD_REST, worked, { from: h(21), to: h(24) });
    expect(check.breaches).toContain('overlap');
  });

  it('refuses a job that would break the daily ceiling', () => {
    const heavy = [makeDutyEntry('P07', 'A', h(0), h(6)), makeDutyEntry('P07', 'B', h(8), h(14))];
    const check = checkJob(STANDARD_REST, heavy, { from: h(20), to: h(23) });
    expect(check.breaches).toContain('daily');
    expect(check.dailyAfter).toBeGreaterThan(STANDARD_REST.dailyCeiling);
  });

  it('refuses a job that would break the weekly ceiling', () => {
    const week = Array.from({ length: 10 }, (_, index) =>
      makeDutyEntry('P07', `W${index}`, h(index * 16), h(index * 16 + 6)),
    );
    const check = checkJob(STANDARD_REST, week, { from: h(170), to: h(176) });
    expect(check.breaches).toContain('weekly');
    expect(check.weeklyAfter).toBeGreaterThan(STANDARD_REST.weeklyCeiling);
  });

  it('reports the duty a job would leave in the counters', () => {
    const check = checkJob(STANDARD_REST, worked, { from: h(40), to: h(43) });
    expect(check.dailyAfter).toBe(180 + 180);
    expect(check.weeklyAfter).toBe(240 + 180 + 180);
  });

  it('refuses a job that ends before it starts', () => {
    expect(() => checkJob(STANDARD_REST, worked, { from: h(5), to: h(4) })).toThrow(InputError);
  });
});

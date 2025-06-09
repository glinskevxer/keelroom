import { describe, expect, it } from 'vitest';
import { parseLocal } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeInterval } from '../../../src/util/interval';
import {
  holidaysIn,
  isHoliday,
  isNight,
  isWeekend,
  makeCalendar,
  nightMinutesIn,
  nightWindows,
  periodClass,
  withHoliday,
} from '../../../src/domain/tariff/calendar';

const OFFSET = -240;
const CAL = makeCalendar({ holidays: ['2025-07-01', '2025-12-25'] });
const at = (text: string): number => parseLocal(text, OFFSET);

describe('building a calendar', () => {
  it('sorts and dedupes the holidays', () => {
    const calendar = makeCalendar({ holidays: ['2025-12-25', '2025-07-01', '2025-07-01'] });
    expect(calendar.holidays).toEqual(['2025-07-01', '2025-12-25']);
  });

  it('defaults the night period and the weekend', () => {
    const calendar = makeCalendar();
    expect(calendar.nightFrom).toBe(1080);
    expect(calendar.nightTo).toBe(360);
    expect(calendar.weekendDays).toEqual([5, 6]);
  });

  it('refuses what is not a calendar', () => {
    expect(() => makeCalendar({ holidays: ['25 dec'] })).toThrow(/is not a date/);
    expect(() => makeCalendar({ nightFrom: 2000 })).toThrow(/outside a day/);
    expect(() => makeCalendar({ weekendDays: [9] })).toThrow(/not a day of the week/);
  });

  it('adds a holiday and refuses one twice', () => {
    const added = withHoliday(CAL, '2025-01-01');
    expect(added.holidays[0]).toBe('2025-01-01');
    expect(withHoliday(added, '2025-01-01')).toBe(added);
    expect(() => withHoliday(CAL, 'christmas')).toThrow(InputError);
  });

  it('lists the holidays in a year', () => {
    expect(holidaysIn(CAL, 2025)).toHaveLength(2);
    expect(holidaysIn(CAL, 2026)).toEqual([]);
  });
});

describe('classifying a moment', () => {
  it('reads a weekday afternoon as ordinary', () => {
    expect(periodClass(CAL, at('2025-05-07T14:00'), OFFSET)).toBe('ordinary');
  });

  it('reads the small hours as night', () => {
    expect(isNight(CAL, at('2025-05-07T02:00'), OFFSET)).toBe(true);
    expect(isNight(CAL, at('2025-05-07T19:00'), OFFSET)).toBe(true);
    expect(isNight(CAL, at('2025-05-07T06:00'), OFFSET)).toBe(false);
    expect(isNight(CAL, at('2025-05-07T17:59'), OFFSET)).toBe(false);
  });

  it('reads a night period that does not wrap midnight', () => {
    const calendar = makeCalendar({ nightFrom: 60, nightTo: 300 });
    expect(isNight(calendar, at('2025-05-07T02:00'), OFFSET)).toBe(true);
    expect(isNight(calendar, at('2025-05-07T22:00'), OFFSET)).toBe(false);
  });

  it('reads saturday and sunday as the weekend', () => {
    expect(isWeekend(CAL, at('2025-05-10T10:00'), OFFSET)).toBe(true);
    expect(isWeekend(CAL, at('2025-05-11T10:00'), OFFSET)).toBe(true);
    expect(isWeekend(CAL, at('2025-05-09T10:00'), OFFSET)).toBe(false);
  });

  it('reads a published holiday', () => {
    expect(isHoliday(CAL, at('2025-07-01T10:00'), OFFSET)).toBe(true);
    expect(isHoliday(CAL, at('2025-07-02T10:00'), OFFSET)).toBe(false);
  });

  it('puts a holiday ahead of a weekend and a weekend ahead of a night', () => {
    expect(periodClass(CAL, at('2025-07-01T02:00'), OFFSET)).toBe('holiday');
    expect(periodClass(CAL, at('2025-05-10T02:00'), OFFSET)).toBe('weekend');
    expect(periodClass(CAL, at('2025-05-07T02:00'), OFFSET)).toBe('night');
  });
});

describe('night windows', () => {
  it('gives one window a night inside a range', () => {
    const bounds = makeInterval(at('2025-05-07T00:00'), at('2025-05-10T00:00'));
    const windows = nightWindows(CAL, bounds, OFFSET);
    expect(windows.length).toBeGreaterThanOrEqual(3);
    for (const window of windows) {
      expect(window.from).toBeGreaterThanOrEqual(bounds.from);
      expect(window.to).toBeLessThanOrEqual(bounds.to);
    }
  });

  it('agrees with the moment by moment test', () => {
    const bounds = makeInterval(at('2025-05-07T00:00'), at('2025-05-08T00:00'));
    for (const window of nightWindows(CAL, bounds, OFFSET)) {
      expect(isNight(CAL, window.from, OFFSET)).toBe(true);
      expect(isNight(CAL, window.to, OFFSET)).toBe(true);
    }
  });

  it('counts the night minutes in a job that straddles the change', () => {
    const job = makeInterval(at('2025-05-07T17:00'), at('2025-05-07T19:00'));
    expect(nightMinutesIn(CAL, job, OFFSET)).toBe(60);
  });

  it('counts nothing for a job wholly in the day', () => {
    const job = makeInterval(at('2025-05-07T10:00'), at('2025-05-07T12:00'));
    expect(nightMinutesIn(CAL, job, OFFSET)).toBe(0);
  });

  it('counts the whole of a job wholly in the night', () => {
    const job = makeInterval(at('2025-05-07T01:00'), at('2025-05-07T03:00'));
    expect(nightMinutesIn(CAL, job, OFFSET)).toBe(120);
  });
});

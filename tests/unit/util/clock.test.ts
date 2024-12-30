import { describe, expect, it } from 'vitest';
import {
  addDays,
  ClockError,
  differenceInMinutes,
  formatDuration,
  formatInstant,
  formatLocal,
  formatOffset,
  isLeapYear,
  localDate,
  localTime,
  minuteOfDay,
  parseInstant,
  parseLocal,
  parseLocalDate,
  parseOffset,
  startOfLocalDay,
  weekdayIndex,
} from '../../../src/util/clock';

const PORT = -300; // the district keeps utc minus five all year

describe('parsing an instant', () => {
  it('reads a zulu timestamp', () => {
    expect(parseInstant('2025-01-01T00:00Z')).toBe(28928160);
    expect(formatInstant(parseInstant('2025-01-01T00:00Z'))).toBe('2025-01-01T00:00Z');
  });

  it('applies the zone offset', () => {
    const zulu = parseInstant('2025-06-14T12:00Z');
    expect(parseInstant('2025-06-14T08:00-04:00')).toBe(zulu);
    expect(parseInstant('2025-06-14T14:30+02:30')).toBe(zulu);
  });

  it('drops seconds rather than refusing them', () => {
    expect(parseInstant('2025-06-14T12:00:45Z')).toBe(parseInstant('2025-06-14T12:00Z'));
  });

  it('refuses a timestamp with no zone', () => {
    expect(() => parseInstant('2025-06-14T12:00')).toThrow(ClockError);
  });

  it('refuses an impossible date', () => {
    expect(() => parseInstant('2025-02-29T00:00Z')).toThrow(/day is out of range/);
    expect(() => parseInstant('2025-13-01T00:00Z')).toThrow(/month is out of range/);
    expect(() => parseInstant('2025-01-01T24:00Z')).toThrow(/time is out of range/);
  });

  it('takes the leap day in a leap year', () => {
    expect(() => parseInstant('2024-02-29T00:00Z')).not.toThrow();
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });
});

describe('local time against a district offset', () => {
  it('round trips a wall clock reading', () => {
    const minute = parseLocal('2025-03-04T06:30', PORT);
    expect(formatLocal(minute, PORT)).toBe('2025-03-04T06:30');
    expect(formatInstant(minute)).toBe('2025-03-04T11:30Z');
  });

  it('accepts a space between the date and the time', () => {
    expect(parseLocal('2025-03-04 06:30', PORT)).toBe(parseLocal('2025-03-04T06:30', PORT));
  });

  it('reads a bare date as local midnight', () => {
    expect(parseLocalDate('2025-03-04', PORT)).toBe(parseLocal('2025-03-04T00:00', PORT));
    expect(() => parseLocalDate('2025-03-04T00:00', PORT)).toThrow(ClockError);
  });

  it('splits a timestamp into its date and time parts', () => {
    const minute = parseLocal('2025-03-04T06:30', PORT);
    expect(localDate(minute, PORT)).toBe('2025-03-04');
    expect(localTime(minute, PORT)).toBe('06:30');
    expect(localDate(minute, 0)).toBe('2025-03-04');
    expect(localTime(minute, 0)).toBe('11:30');
  });

  it('rejects a fractional minute', () => {
    expect(() => formatLocal(10.5, PORT)).toThrow(/whole minutes/);
  });
});

describe('day arithmetic', () => {
  it('gives the minute of the local day', () => {
    const minute = parseLocal('2025-03-04T06:30', PORT);
    expect(minuteOfDay(minute, PORT)).toBe(390);
    expect(minuteOfDay(minute, 0)).toBe(690);
  });

  it('never returns a negative minute of day before the epoch', () => {
    const minute = parseLocal('1969-12-31T22:00', PORT);
    expect(minuteOfDay(minute, PORT)).toBe(1320);
  });

  it('finds the local midnight before a time', () => {
    const minute = parseLocal('2025-03-04T06:30', PORT);
    expect(formatLocal(startOfLocalDay(minute, PORT), PORT)).toBe('2025-03-04T00:00');
  });

  it('numbers monday as zero', () => {
    expect(weekdayIndex(parseLocal('2025-03-03T09:00', PORT), PORT)).toBe(0);
    expect(weekdayIndex(parseLocal('2025-03-09T09:00', PORT), PORT)).toBe(6);
  });

  it('reads the weekday against the offset it is given', () => {
    const lateSunday = parseLocal('2025-03-09T22:00', PORT);
    expect(weekdayIndex(lateSunday, PORT)).toBe(6);
    expect(weekdayIndex(lateSunday, 0)).toBe(0);
  });

  it('adds whole days', () => {
    const minute = parseLocal('2025-03-04T06:30', PORT);
    expect(formatLocal(addDays(minute, 3), PORT)).toBe('2025-03-07T06:30');
    expect(formatLocal(addDays(minute, -4), PORT)).toBe('2025-02-28T06:30');
    expect(differenceInMinutes(addDays(minute, 1), minute)).toBe(1440);
  });
});

describe('durations and offsets', () => {
  it('writes a duration the way a duty log does', () => {
    expect(formatDuration(0)).toBe('0h00');
    expect(formatDuration(95)).toBe('1h35');
    expect(formatDuration(-95)).toBe('-1h35');
    expect(formatDuration(1440)).toBe('24h00');
  });

  it('round trips an offset', () => {
    expect(parseOffset('-05:00')).toBe(-300);
    expect(parseOffset('+05:30')).toBe(330);
    expect(parseOffset('Z')).toBe(0);
    expect(formatOffset(-300)).toBe('-05:00');
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(0)).toBe('+00:00');
  });

  it('refuses an offset that is not one', () => {
    expect(() => parseOffset('-5')).toThrow(ClockError);
    expect(() => parseOffset('+15:00')).toThrow(/out of range/);
  });
});

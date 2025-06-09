/**
 * When the district charges more: nights, weekends and the published holidays.
 *
 * The night period is a clock window rather than a daylight one. The planner
 * cares about the sun, because that is what a pilot can see by; the tariff cares
 * about the hours in the published tariff, because that is what the agents
 * agreed to pay. The two are deliberately different numbers and confusing them
 * has cost this district money in both directions.
 */

import { InputError } from '../../util/errors';
import type { Minute, Offset } from '../../util/clock';
import {
  localDate,
  MINUTES_PER_DAY,
  minuteOfDay,
  startOfLocalDay,
  weekdayIndex,
} from '../../util/clock';
import type { Interval } from '../../util/interval';
import { clip, intersectSets, normalise, totalMinutes } from '../../util/interval';

export type PeriodClass = 'ordinary' | 'night' | 'weekend' | 'holiday';

export interface PortCalendar {
  /** Local dates the district treats as holidays. */
  readonly holidays: readonly string[];
  /** Minute of the local day the night rate starts. */
  readonly nightFrom: number;
  /** Minute of the local day it ends, which is earlier than it starts. */
  readonly nightTo: number;
  /** Days of the week charged at the weekend rate, monday being zero. */
  readonly weekendDays: readonly number[];
}

export const STANDARD_CALENDAR: PortCalendar = {
  holidays: [],
  nightFrom: 18 * 60,
  nightTo: 6 * 60,
  weekendDays: [5, 6],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function makeCalendar(input: Partial<PortCalendar> = {}): PortCalendar {
  const calendar = { ...STANDARD_CALENDAR, ...input };
  for (const holiday of calendar.holidays) {
    if (!DATE.test(holiday)) {
      throw new InputError(`holiday ${JSON.stringify(holiday)} is not a date`);
    }
  }
  for (const bound of [calendar.nightFrom, calendar.nightTo]) {
    if (!Number.isInteger(bound) || bound < 0 || bound >= MINUTES_PER_DAY) {
      throw new InputError(`the night period runs outside a day: ${bound}`);
    }
  }
  for (const day of calendar.weekendDays) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new InputError(`${day} is not a day of the week`);
    }
  }
  return {
    holidays: [...new Set(calendar.holidays)].sort(),
    nightFrom: calendar.nightFrom,
    nightTo: calendar.nightTo,
    weekendDays: [...new Set(calendar.weekendDays)].sort(),
  };
}

export function isHoliday(calendar: PortCalendar, minute: Minute, offset: Offset): boolean {
  return calendar.holidays.includes(localDate(minute, offset));
}

export function isWeekend(calendar: PortCalendar, minute: Minute, offset: Offset): boolean {
  return calendar.weekendDays.includes(weekdayIndex(minute, offset));
}

export function isNight(calendar: PortCalendar, minute: Minute, offset: Offset): boolean {
  const at = minuteOfDay(minute, offset);
  if (calendar.nightFrom > calendar.nightTo) {
    return at >= calendar.nightFrom || at < calendar.nightTo;
  }
  return at >= calendar.nightFrom && at < calendar.nightTo;
}

/**
 * What a moment is charged as. A holiday beats a weekend and a weekend beats a
 * night, because the district publishes one surcharge per movement rather than
 * stacking them.
 */
export function periodClass(calendar: PortCalendar, minute: Minute, offset: Offset): PeriodClass {
  if (isHoliday(calendar, minute, offset)) {
    return 'holiday';
  }
  if (isWeekend(calendar, minute, offset)) {
    return 'weekend';
  }
  if (isNight(calendar, minute, offset)) {
    return 'night';
  }
  return 'ordinary';
}

/** The night periods inside a range, as intervals. */
export function nightWindows(calendar: PortCalendar, bounds: Interval, offset: Offset): Interval[] {
  const windows: Interval[] = [];
  let day = startOfLocalDay(bounds.from, offset) - MINUTES_PER_DAY;
  while (day <= bounds.to + MINUTES_PER_DAY) {
    if (calendar.nightFrom > calendar.nightTo) {
      windows.push({
        from: day + calendar.nightFrom,
        to: day + MINUTES_PER_DAY + calendar.nightTo - 1,
      });
    } else {
      windows.push({ from: day + calendar.nightFrom, to: day + calendar.nightTo - 1 });
    }
    day += MINUTES_PER_DAY;
  }
  return clip(normalise(windows), bounds);
}

/** How much of a job falls in the night, which the pro rata rate reads. */
export function nightMinutesIn(calendar: PortCalendar, job: Interval, offset: Offset): number {
  return totalMinutes(intersectSets([job], nightWindows(calendar, job, offset)));
}

export function withHoliday(calendar: PortCalendar, date: string): PortCalendar {
  if (!DATE.test(date)) {
    throw new InputError(`holiday ${JSON.stringify(date)} is not a date`);
  }
  if (calendar.holidays.includes(date)) {
    return calendar;
  }
  return { ...calendar, holidays: [...calendar.holidays, date].sort() };
}

/** The holidays in a year, which the published tariff prints. */
export function holidaysIn(calendar: PortCalendar, year: number): string[] {
  return calendar.holidays.filter((holiday) => holiday.startsWith(`${year}-`));
}

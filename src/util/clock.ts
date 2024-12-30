/**
 * Time in this system is an integer count of minutes since the unix epoch. A
 * pilotage district keeps one fixed offset from utc all year, because a duty
 * period that changes length twice a year is not something the rest rules can
 * be written against, so the offset is carried as data rather than read from
 * the host.
 */

import { UnitError } from './units';

/** Whole minutes since 1970-01-01T00:00Z. */
export type Minute = number;

/** Minutes east of utc. */
export type Offset = number;

const ISO_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
const LOCAL_MINUTE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;

export class ClockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClockError';
  }
}

function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const shifted = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * shifted + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: month <= 2 ? y + 1 : y, month, day };
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return lengths[month - 1] ?? 0;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function checkCivil(year: number, month: number, day: number, source: string): void {
  if (month < 1 || month > 12) {
    throw new ClockError(`month is out of range in ${JSON.stringify(source)}`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new ClockError(`day is out of range in ${JSON.stringify(source)}`);
  }
}

/** Parse an iso timestamp carrying a zone, to the minute. Seconds are dropped. */
export function parseInstant(text: string): Minute {
  const match = ISO_MINUTE.exec(text.trim());
  if (match === null) {
    throw new ClockError(`not an iso timestamp with a zone: ${JSON.stringify(text)}`);
  }
  const [, year, month, day, hour, minute, , zone] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  checkCivil(y, mo, d, text);
  const h = Number(hour);
  const mi = Number(minute);
  if (h > 23 || mi > 59) {
    throw new ClockError(`time is out of range in ${JSON.stringify(text)}`);
  }
  const local = daysFromCivil(y, mo, d) * MINUTES_PER_DAY + h * MINUTES_PER_HOUR + mi;
  return local - zoneOffset(zone ?? 'Z', text);
}

function zoneOffset(zone: string, source: string): Offset {
  if (zone === 'Z') {
    return 0;
  }
  const sign = zone.startsWith('-') ? -1 : 1;
  const hours = Number(zone.slice(1, 3));
  const minutes = Number(zone.slice(4, 6));
  if (hours > 14 || minutes > 59) {
    throw new ClockError(`zone offset is out of range in ${JSON.stringify(source)}`);
  }
  return sign * (hours * MINUTES_PER_HOUR + minutes);
}

/** Parse a local wall clock reading against a district offset. */
export function parseLocal(text: string, offset: Offset): Minute {
  const match = LOCAL_MINUTE.exec(text.trim());
  if (match === null) {
    throw new ClockError(`not a local timestamp: ${JSON.stringify(text)}`);
  }
  const [, year, month, day, hour, minute] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  checkCivil(y, mo, d, text);
  const h = Number(hour);
  const mi = Number(minute);
  if (h > 23 || mi > 59) {
    throw new ClockError(`time is out of range in ${JSON.stringify(text)}`);
  }
  return daysFromCivil(y, mo, d) * MINUTES_PER_DAY + h * MINUTES_PER_HOUR + mi - offset;
}

/** Parse a bare date as local midnight. */
export function parseLocalDate(text: string, offset: Offset): Minute {
  const match = DATE_ONLY.exec(text.trim());
  if (match === null) {
    throw new ClockError(`not a date: ${JSON.stringify(text)}`);
  }
  return parseLocal(`${text.trim()}T00:00`, offset);
}

export function formatInstant(minute: Minute): string {
  return `${formatLocal(minute, 0)}Z`;
}

export function formatLocal(minute: Minute, offset: Offset): string {
  if (!Number.isFinite(minute) || Math.trunc(minute) !== minute) {
    throw new UnitError(`time must be whole minutes, got ${minute}`);
  }
  const local = minute + offset;
  const days = Math.floor(local / MINUTES_PER_DAY);
  const rest = local - days * MINUTES_PER_DAY;
  const { year, month, day } = civilFromDays(days);
  const hour = Math.floor(rest / MINUTES_PER_HOUR);
  const mins = rest % MINUTES_PER_HOUR;
  return (
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-` +
    `${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
  );
}

export function localDate(minute: Minute, offset: Offset): string {
  return formatLocal(minute, offset).slice(0, 10);
}

export function localTime(minute: Minute, offset: Offset): string {
  return formatLocal(minute, offset).slice(11, 16);
}

/** Minutes since local midnight, always in [0, 1440). */
export function minuteOfDay(minute: Minute, offset: Offset): number {
  const local = minute + offset;
  return ((local % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function startOfLocalDay(minute: Minute, offset: Offset): Minute {
  return minute - minuteOfDay(minute, offset);
}

/** 0 is Monday, matching the way the roster writes a week. */
export function weekdayIndex(minute: Minute, offset: Offset): number {
  const days = Math.floor((minute + offset) / MINUTES_PER_DAY);
  return (((days + 3) % 7) + 7) % 7;
}

export function addDays(minute: Minute, days: number): Minute {
  return minute + days * MINUTES_PER_DAY;
}

export function differenceInMinutes(later: Minute, earlier: Minute): number {
  return later - earlier;
}

/** Render a span of minutes the way a duty log writes it. */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const total = Math.abs(minutes);
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const rest = total % MINUTES_PER_HOUR;
  return `${sign}${hours}h${String(rest).padStart(2, '0')}`;
}

export function parseOffset(text: string): Offset {
  const trimmed = text.trim();
  if (trimmed === 'Z' || trimmed === '+00:00') {
    return 0;
  }
  if (!/^[+-]\d{2}:\d{2}$/.test(trimmed)) {
    throw new ClockError(`not a zone offset: ${JSON.stringify(text)}`);
  }
  return zoneOffset(trimmed, text);
}

export function formatOffset(offset: Offset): string {
  const sign = offset < 0 ? '-' : '+';
  const total = Math.abs(offset);
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const mins = total % MINUTES_PER_HOUR;
  return `${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

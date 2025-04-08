/**
 * Daylight, and the restrictions written against it.
 *
 * The district's standing orders keep some movements to daylight: a ship over a
 * size, a tow, anything carrying gas, and any ship whose master has asked for
 * it. Sunrise and sunset are computed rather than tabulated, because the
 * planner is asked about dates a year out and a table would have to be
 * maintained.
 *
 * The algorithm is the usual low precision solar position: it is good to about
 * a minute, which is well inside the half hour of civil twilight the orders
 * allow either side.
 */

import type { Minute, Offset } from '../../util/clock';
import { MINUTES_PER_DAY, startOfLocalDay } from '../../util/clock';
import { InputError } from '../../util/errors';
import type { Interval } from '../../util/interval';
import { clip, normalise } from '../../util/interval';
import { julianDay, normaliseDegrees } from '../tide/astronomy';

const DEGREES = Math.PI / 180;

export interface Position {
  /** Degrees north of the equator. */
  readonly latitude: number;
  /** Degrees east of greenwich. */
  readonly longitude: number;
}

export function makePosition(latitude: number, longitude: number): Position {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    throw new InputError(`latitude ${latitude} is not on the earth`);
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new InputError(`longitude ${longitude} is not on the earth`);
  }
  return { latitude, longitude };
}

/** Solar declination and the equation of time at a moment. */
export function solarPosition(minute: Minute): { declination: number; equationOfTime: number } {
  const days = julianDay(minute) - 2451545;
  const meanLongitude = normaliseDegrees(280.46 + 0.9856474 * days);
  const meanAnomaly = normaliseDegrees(357.528 + 0.9856003 * days);
  const eclipticLongitude = normaliseDegrees(
    meanLongitude +
      1.915 * Math.sin(meanAnomaly * DEGREES) +
      0.02 * Math.sin(2 * meanAnomaly * DEGREES),
  );
  const obliquity = 23.439 - 0.0000004 * days;
  const declination =
    Math.asin(Math.sin(obliquity * DEGREES) * Math.sin(eclipticLongitude * DEGREES)) / DEGREES;
  const rightAscension =
    Math.atan2(
      Math.cos(obliquity * DEGREES) * Math.sin(eclipticLongitude * DEGREES),
      Math.cos(eclipticLongitude * DEGREES),
    ) / DEGREES;
  const equationOfTime = (normaliseDegrees(meanLongitude - rightAscension + 180) - 180) * 4;
  return { declination, equationOfTime };
}

/**
 * Sunrise and sunset on the local day a minute falls in, as minutes since the
 * epoch. A polar day or a polar night gives nothing back, which the callers
 * treat as no restriction and as no daylight respectively.
 */
export function sunTimes(
  position: Position,
  minute: Minute,
  offset: Offset,
): { sunrise: Minute; sunset: Minute } | undefined {
  const midnight = startOfLocalDay(minute, offset);
  const noonish = midnight + MINUTES_PER_DAY / 2;
  const { declination, equationOfTime } = solarPosition(noonish);
  const latitude = position.latitude * DEGREES;
  const declinationRadians = declination * DEGREES;
  // the centre of the sun at the horizon, with the usual refraction allowance
  const zenith = 90.833 * DEGREES;
  const cosHourAngle =
    (Math.cos(zenith) - Math.sin(latitude) * Math.sin(declinationRadians)) /
    (Math.cos(latitude) * Math.cos(declinationRadians));
  if (cosHourAngle > 1 || cosHourAngle < -1) {
    return undefined;
  }
  const hourAngle = Math.acos(cosHourAngle) / DEGREES;
  const solarNoon = 720 - 4 * position.longitude - equationOfTime;
  const sunrise = Math.round(midnight + solarNoon - 4 * hourAngle + offset);
  const sunset = Math.round(midnight + solarNoon + 4 * hourAngle + offset);
  return { sunrise, sunset };
}

export interface DaylightOptions {
  /** Minutes before sunrise the orders still count as daylight. */
  readonly before?: number;
  /** Minutes after sunset. */
  readonly after?: number;
}

/** The daylight intervals inside a range, one for each local day it covers. */
export function daylightWindows(
  position: Position,
  bounds: Interval,
  offset: Offset,
  options: DaylightOptions = {},
): Interval[] {
  if (bounds.to < bounds.from) {
    throw new InputError('the daylight range ends before it starts');
  }
  const before = options.before ?? 0;
  const after = options.after ?? 0;
  const windows: Interval[] = [];
  let day = startOfLocalDay(bounds.from, offset) - MINUTES_PER_DAY;
  const end = bounds.to + MINUTES_PER_DAY;
  while (day <= end) {
    const times = sunTimes(position, day + 60, offset);
    if (times !== undefined) {
      windows.push({ from: times.sunrise - before, to: times.sunset + after });
    }
    day += MINUTES_PER_DAY;
  }
  return clip(normalise(windows), bounds);
}

export function isDaylight(
  position: Position,
  minute: Minute,
  offset: Offset,
  options: DaylightOptions = {},
): boolean {
  const times = sunTimes(position, minute, offset);
  if (times === undefined) {
    return false;
  }
  return (
    minute >= times.sunrise - (options.before ?? 0) && minute <= times.sunset + (options.after ?? 0)
  );
}

/** How long the sun is up on the local day a minute falls in. */
export function dayLength(position: Position, minute: Minute, offset: Offset): number {
  const times = sunTimes(position, minute, offset);
  return times === undefined ? 0 : times.sunset - times.sunrise;
}

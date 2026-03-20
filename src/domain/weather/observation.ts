/**
 * The weather log.
 *
 * The station on the pilot house roof reports every hour, and the district keeps
 * it because a movement is planned against the weather at the time it will run
 * rather than against the weather now. A plan made at nine in the morning for a
 * sailing at eight in the evening wants the forecast for eight in the evening,
 * and when there is no forecast it wants the last observation and a note saying
 * that is what it used.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import type { Cm } from '../../util/units';
import { assertCm } from '../../util/units';

export type WeatherSource = 'observed' | 'forecast';

export interface Observation {
  readonly at: Minute;
  readonly source: WeatherSource;
  /** Wind in knots. */
  readonly wind: number;
  /** Where it is blowing from, in degrees true. */
  readonly direction: number;
  /** Visibility in metres. */
  readonly visibility: number;
  /** Significant wave height at the sea buoy. */
  readonly swell: Cm;
  /** Water density in thousandths, which the freshet moves. */
  readonly density: number;
}

export function makeObservation(input: {
  at: Minute;
  source?: WeatherSource;
  wind: number;
  direction?: number;
  visibility: number;
  swell?: number;
  density?: number;
}): Observation {
  if (!Number.isInteger(input.wind) || input.wind < 0 || input.wind > 200) {
    throw new InputError(`a wind of ${input.wind} knots is not a reading`);
  }
  const direction = input.direction ?? 0;
  if (!Number.isInteger(direction) || direction < 0 || direction > 359) {
    throw new InputError(`a wind direction of ${direction} is not a bearing`);
  }
  if (!Number.isInteger(input.visibility) || input.visibility < 0) {
    throw new InputError(`a visibility of ${input.visibility} is not a reading`);
  }
  const swell = assertCm(input.swell ?? 0, 'swell');
  if (swell < 0) {
    throw new InputError('a negative swell is not a sea state');
  }
  const density = input.density ?? 1025;
  if (!Number.isInteger(density) || density < 950 || density > 1050) {
    throw new InputError(`a density of ${density} is outside anything measurable`);
  }
  return {
    at: input.at,
    source: input.source ?? 'observed',
    wind: input.wind,
    direction,
    visibility: input.visibility,
    swell,
    density,
  };
}

/**
 * The reading to plan a movement at a time against: the forecast for that time
 * if there is one, otherwise the nearest observation before it.
 */
export function readingAt(
  log: readonly Observation[],
  at: Minute,
): { reading: Observation; stale: boolean } | undefined {
  const forecast = [...log]
    .filter((entry) => entry.source === 'forecast')
    .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
  if (forecast !== undefined && Math.abs(forecast.at - at) <= 180) {
    return { reading: forecast, stale: false };
  }
  const observed = [...log]
    .filter((entry) => entry.source === 'observed' && entry.at <= at)
    .sort((a, b) => b.at - a.at)[0];
  if (observed === undefined) {
    return undefined;
  }
  return { reading: observed, stale: at - observed.at > 180 };
}

/** The worst of the readings over a period, which is what a plan is held to. */
export function worstOver(
  log: readonly Observation[],
  from: Minute,
  to: Minute,
): Observation | undefined {
  const held = log.filter((entry) => entry.at >= from && entry.at <= to);
  if (held.length === 0) {
    return undefined;
  }
  return held.reduce((worst, entry) => {
    const wind = Math.max(worst.wind, entry.wind);
    const visibility = Math.min(worst.visibility, entry.visibility);
    const swell = Math.max(worst.swell, entry.swell);
    return { ...worst, wind, visibility, swell };
  });
}

/** Whether the wind is across the channel, which is what handles a ship badly. */
export function isCrossWind(observation: Observation, channelBearing: number): boolean {
  const difference = Math.abs(((observation.direction - channelBearing + 540) % 360) - 180);
  return difference > 45 && difference < 135;
}

export function beaufort(wind: number): number {
  const limits = [1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];
  const found = limits.findIndex((limit) => wind <= limit);
  return found < 0 ? 12 : found;
}

export function describeObservation(observation: Observation): string {
  return (
    `${observation.wind} kn from ${String(observation.direction).padStart(3, '0')}, ` +
    `visibility ${observation.visibility} m, swell ${observation.swell} cm (${observation.source})`
  );
}

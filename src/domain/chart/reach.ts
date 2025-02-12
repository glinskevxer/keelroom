/**
 * A reach is a stretch of channel with one controlling depth.
 *
 * The charted depth is not the depth the planner uses. A survey ages, the
 * channel shoals between dredgings, and the survey itself has a tolerance, so
 * the depth a ship is planned against is the charted depth less an allowance
 * that grows with the age of the survey. A reach that has not been surveyed for
 * a year is planned more conservatively than one surveyed last month, and that
 * is a deliberate consequence rather than a safety margin bolted on later.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import { MINUTES_PER_DAY } from '../../util/clock';
import type { Cm } from '../../util/units';
import { assertCm, roundHalf } from '../../util/units';

export type ChannelType = 'open' | 'restricted' | 'canal';

export interface Reach {
  readonly id: string;
  readonly name: string;
  /** Charted controlling depth below chart datum, in centimetres. */
  readonly chartedDepth: Cm;
  /** Length of the reach in metres. */
  readonly length: number;
  /** Width at the design depth, in metres. */
  readonly width: number;
  readonly channel: ChannelType;
  /** Tide station the reach is planned against. */
  readonly station: string;
  /** When the controlling depth was last surveyed. */
  readonly surveyed: Minute;
  /** How fast the reach shoals, in centimetres a year. */
  readonly shoalingRate: number;
  /** Survey tolerance in centimetres, applied whatever the age. */
  readonly surveyTolerance: Cm;
  /** Speed limit over the ground, in tenths of a knot. */
  readonly speedLimit: number;
}

const REACH_ID = /^[A-Z][A-Z0-9-]{1,15}$/;
const DAYS_PER_YEAR = 365.25;

export function makeReach(input: {
  id: string;
  name: string;
  chartedDepth: number;
  length: number;
  width: number;
  channel: ChannelType;
  station: string;
  surveyed: Minute;
  shoalingRate?: number;
  surveyTolerance?: number;
  speedLimit: number;
}): Reach {
  if (!REACH_ID.test(input.id)) {
    throw new InputError(`reach id must be upper case, got ${JSON.stringify(input.id)}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`reach ${input.id} has no name`);
  }
  const chartedDepth = assertCm(input.chartedDepth, 'charted depth');
  if (chartedDepth <= 0) {
    throw new InputError(`reach ${input.id} has no charted depth`);
  }
  if (!(input.length > 0)) {
    throw new InputError(`reach ${input.id} has no length`);
  }
  if (!(input.width > 0)) {
    throw new InputError(`reach ${input.id} has no width`);
  }
  if (input.width < 30) {
    throw new InputError(`reach ${input.id} is narrower than any ship it could carry`);
  }
  const shoalingRate = input.shoalingRate ?? 0;
  if (shoalingRate < 0) {
    throw new InputError(`reach ${input.id} cannot deepen on its own`);
  }
  const surveyTolerance = assertCm(input.surveyTolerance ?? 10, 'survey tolerance');
  if (surveyTolerance < 0) {
    throw new InputError(`reach ${input.id} has a negative survey tolerance`);
  }
  if (!Number.isInteger(input.speedLimit) || input.speedLimit <= 0) {
    throw new InputError(`reach ${input.id} needs a speed limit in tenths of a knot`);
  }
  return {
    id: input.id,
    name: input.name.trim(),
    chartedDepth,
    length: input.length,
    width: input.width,
    channel: input.channel,
    station: input.station,
    surveyed: input.surveyed,
    shoalingRate,
    surveyTolerance,
    speedLimit: input.speedLimit,
  };
}

/** How old the survey is at a moment, in days. Never negative. */
export function surveyAgeDays(reach: Reach, at: Minute): number {
  return Math.max(0, (at - reach.surveyed) / MINUTES_PER_DAY);
}

/** The shoaling the reach is assumed to have taken since it was surveyed. */
export function shoalingAllowance(reach: Reach, at: Minute): Cm {
  const years = surveyAgeDays(reach, at) / DAYS_PER_YEAR;
  return roundHalf(years * reach.shoalingRate);
}

/**
 * The depth the planner works from: charted, less the assumed shoaling, less
 * the survey tolerance. Never below zero, because a reach that has shoaled to
 * nothing is a closed reach and that is a different finding.
 */
export function plannedDepth(reach: Reach, at: Minute): Cm {
  return Math.max(0, reach.chartedDepth - shoalingAllowance(reach, at) - reach.surveyTolerance);
}

/** How much of the charted depth the age of the survey has taken away. */
export function depthLostToAge(reach: Reach, at: Minute): Cm {
  return reach.chartedDepth - plannedDepth(reach, at);
}

/** Minutes to run the reach at a speed given in tenths of a knot. */
export function transitMinutes(reach: Reach, speedTenths: number): number {
  if (!Number.isInteger(speedTenths) || speedTenths <= 0) {
    throw new InputError(`speed must be whole tenths of a knot, got ${speedTenths}`);
  }
  const effective = Math.min(speedTenths, reach.speedLimit);
  const metresPerMinute = ((effective / 10) * 1852) / 60;
  return Math.ceil(reach.length / metresPerMinute);
}

/** The speed a ship may actually make good here, in tenths of a knot. */
export function permittedSpeed(reach: Reach, requestedTenths: number): number {
  return Math.min(requestedTenths, reach.speedLimit);
}

/** Cross sectional area of the channel at a state of tide, in square metres. */
export function channelArea(reach: Reach, tideHeight: Cm, at: Minute): number {
  const depth = (plannedDepth(reach, at) + tideHeight) / 100;
  return Math.max(0, depth) * reach.width;
}

export function describeReach(reach: Reach, at: Minute): string {
  return (
    `${reach.id} ${reach.name}, charted ${reach.chartedDepth} cm, ` +
    `planned ${plannedDepth(reach, at)} cm, ${reach.channel}`
  );
}

export function isStale(reach: Reach, at: Minute, staleAfterDays = 365): boolean {
  return surveyAgeDays(reach, at) > staleAfterDays;
}

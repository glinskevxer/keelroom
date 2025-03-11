/**
 * One reach, one moment, one answer: is there enough water.
 *
 * The two sides of the sum are the water available and the water needed. The
 * available side is the planned depth of the reach plus the height of tide. The
 * needed side is the static draught plus every allowance plus the net clearance
 * the policy requires. What is left over is the margin, and a negative margin is
 * the finding that stops a movement.
 *
 * The two sides are not independent. Squat is computed from the water the ship
 * is actually in, so the available side feeds the needed side, and the whole
 * assessment has to be redone at every state of tide rather than shifted.
 */

import type { Minute } from '../../util/clock';
import type { Finding } from '../../util/finding';
import { FindingLog } from '../../util/finding';
import type { Cm } from '../../util/units';
import type { Reach } from '../chart/reach';
import { plannedDepth } from '../chart/reach';
import type { Vessel } from '../vessel/vessel';
import { computeSquat } from '../vessel/squat';
import type { SquatMethod } from '../vessel/squat';
import type { UkcPolicy } from './policy';
import { densityAllowance, heelAllowance, requiredNetClearance, waveAllowance } from './policy';

export interface TransitConditions {
  /** Water density in thousandths, salt water being 1025. */
  readonly density: number;
  /** Significant wave height in centimetres. */
  readonly waveHeight: Cm;
  /** Speed through the water in tenths of a knot. */
  readonly speed: number;
  /** Whether the bottom here is rock or a hard bar rather than mud. */
  readonly hardBottom?: boolean;
  readonly squatMethod?: SquatMethod;
}

export interface Allowances {
  readonly squat: Cm;
  readonly heel: Cm;
  readonly wave: Cm;
  readonly density: Cm;
}

export interface ReachAssessment {
  readonly reach: string;
  readonly at: Minute;
  readonly tideHeight: Cm;
  readonly plannedDepth: Cm;
  /** Planned depth plus the height of tide. */
  readonly available: Cm;
  readonly draught: Cm;
  readonly allowances: Allowances;
  readonly requiredClearance: Cm;
  /** Draught plus allowances plus required clearance. */
  readonly needed: Cm;
  /** Available less needed. Negative means the ship does not go. */
  readonly margin: Cm;
  /** Water under the keel once the allowances are taken, before the requirement. */
  readonly netClearance: Cm;
  readonly passable: boolean;
  readonly findings: readonly Finding[];
}

export function assessReach(input: {
  reach: Reach;
  vessel: Vessel;
  draught: Cm;
  policy: UkcPolicy;
  at: Minute;
  tideHeight: Cm;
  conditions: TransitConditions;
}): ReachAssessment {
  const { reach, vessel, draught, policy, at, tideHeight, conditions } = input;
  const depth = plannedDepth(reach, at);
  const available = depth + tideHeight;
  const log = new FindingLog();

  const squat = computeSquat(
    {
      vessel,
      draught,
      speed: conditions.speed,
      depth: Math.max(1, available),
      width: reach.width,
      channel: reach.channel,
    },
    conditions.squatMethod ?? 'worse-of-both',
  );
  const allowances: Allowances = {
    squat: squat.squat,
    heel: heelAllowance(policy, vessel),
    wave: waveAllowance(policy, conditions.waveHeight, reach.channel),
    density: densityAllowance(draught, conditions.density),
  };
  const demand = requiredNetClearance(policy, vessel, draught, {
    hardBottom: conditions.hardBottom === true,
  });
  const dynamicDraught =
    draught + allowances.squat + allowances.heel + allowances.wave + allowances.density;
  const needed = dynamicDraught + demand.required;
  const margin = available - needed;
  const netClearance = available - dynamicDraught;

  if (margin < 0) {
    log.block('UKC-NET-01', 'not enough water for the required clearance', {
      subject: reach.id,
      detail: { shortBy: -margin, available, needed },
    });
  } else if (margin < 20) {
    log.advise('UKC-THIN-05', 'the margin is inside twenty centimetres', {
      subject: reach.id,
      detail: { margin },
    });
  }
  if (netClearance < 0) {
    log.block('UKC-GROUND-06', 'the ship touches bottom before any clearance is counted', {
      subject: reach.id,
      detail: { netClearance },
    });
  }
  if (allowances.squat > demand.required) {
    log.advise('UKC-SQUAT-07', 'squat alone is greater than the required clearance', {
      subject: reach.id,
      detail: { squat: allowances.squat, required: demand.required, method: squat.method },
    });
  }
  for (const reason of demand.reasons) {
    log.note(reason, 'clearance requirement', { subject: reach.id });
  }

  return {
    reach: reach.id,
    at,
    tideHeight,
    plannedDepth: depth,
    available,
    draught,
    allowances,
    requiredClearance: demand.required,
    needed,
    margin,
    netClearance,
    passable: margin >= 0,
    findings: log.all(),
  };
}

export function totalAllowances(allowances: Allowances): Cm {
  return allowances.squat + allowances.heel + allowances.wave + allowances.density;
}

/** The allowance that took the most water, which is what the report leads with. */
export function largestAllowance(allowances: Allowances): keyof Allowances {
  const entries: [keyof Allowances, Cm][] = [
    ['squat', allowances.squat],
    ['heel', allowances.heel],
    ['wave', allowances.wave],
    ['density', allowances.density],
  ];
  return entries.reduce((worst, entry) => (entry[1] > worst[1] ? entry : worst))[0];
}

export function describeAssessment(assessment: ReachAssessment): string {
  const verdict = assessment.passable ? 'passable' : 'blocked';
  return (
    `${assessment.reach} ${verdict}: available ${assessment.available} cm, ` +
    `needed ${assessment.needed} cm, margin ${assessment.margin} cm`
  );
}

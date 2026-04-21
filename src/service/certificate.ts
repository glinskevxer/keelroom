/**
 * The clearance certificate.
 *
 * When a deep ship sails, the master asks for the working: what the district
 * assumed about the tide, what it allowed for squat and heel and swell, and how
 * much water it expected under her on each reach. It goes in the ship's file and
 * it is the document produced if anything is ever argued about, so it is
 * computed at the time she was planned for rather than at the time it is
 * printed, and it says which tide station and which survey it used.
 */

import { InputError } from '../util/errors';
import type { Minute } from '../util/clock';
import type { Cm } from '../util/units';
import { requireStation } from '../domain/chart/district';
import { plannedDepth, surveyAgeDays } from '../domain/chart/reach';
import { predictHeight } from '../domain/tide/predict';
import { assessReach } from '../domain/ukc/assessment';
import type { ReachAssessment } from '../domain/ukc/assessment';
import { requireVessel } from '../storage/fleet-store';
import { requireMovement } from '../storage/movement-store';
import type { Context } from './context';
import { FAIR_WEATHER, conditionsFromLog, passageFor } from './planning';

export interface ReachLine {
  readonly reach: string;
  readonly at: Minute;
  readonly station: string;
  readonly tideHeight: Cm;
  readonly chartedDepth: Cm;
  readonly plannedDepth: Cm;
  readonly surveyAgeDays: number;
  readonly assessment: ReachAssessment;
}

export interface Certificate {
  readonly movement: string;
  readonly vessel: string;
  readonly vesselName: string;
  readonly draught: Cm;
  readonly startAt: Minute;
  readonly weather: string;
  readonly lines: readonly ReachLine[];
  /** The smallest margin on the passage, which is the number that matters. */
  readonly leastMargin: Cm;
  readonly leastMarginReach: string;
}

export function certificateFor(context: Context, reference: string): Certificate {
  const movement = requireMovement(context.db, reference);
  const startAt = movement.plannedFor;
  if (startAt === undefined) {
    throw new InputError(`movement ${reference} has no planned time to certify`);
  }
  const vessel = requireVessel(context.db, movement.vessel);
  const fromLog = conditionsFromLog(context, startAt);
  const conditions = fromLog.conditions.transit ?? FAIR_WEATHER.transit;
  const passage = passageFor(context, movement);
  const lines = passage.legs.map((leg) => {
    const at = startAt + Math.round((leg.entry + leg.exit) / 2);
    const station = requireStation(context.district, leg.reach.station);
    const tideHeight = predictHeight(station, at);
    return {
      reach: leg.reach.id,
      at,
      station: station.id,
      tideHeight,
      chartedDepth: leg.reach.chartedDepth,
      plannedDepth: plannedDepth(leg.reach, at),
      surveyAgeDays: Math.round(surveyAgeDays(leg.reach, at)),
      assessment: assessReach({
        reach: leg.reach,
        vessel,
        draught: movement.draught,
        policy: context.config.clearance,
        at,
        tideHeight,
        conditions: { ...conditions, speed: leg.speed },
      }),
    };
  });
  const worst = lines.reduce((least, line) =>
    line.assessment.margin < least.assessment.margin ? line : least,
  );
  return {
    movement: reference,
    vessel: vessel.imo,
    vesselName: vessel.name,
    draught: movement.draught,
    startAt,
    weather: fromLog.source,
    lines,
    leastMargin: worst.assessment.margin,
    leastMarginReach: worst.reach,
  };
}

/** Whether the certificate would be signed: every reach clears. */
export function isClear(certificate: Certificate): boolean {
  return certificate.lines.every((line) => line.assessment.passable);
}

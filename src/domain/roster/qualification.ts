/**
 * May this pilot take this job.
 *
 * The licence limits answer most of it, and the rest is endorsements. The
 * district writes an endorsement wherever it wants a named sign off rather than
 * a number: the berths where the turn is tight, night work, and the gas berth,
 * which nobody takes without both the gas endorsement and the berth.
 *
 * Every refusal carries the rule that refused it, because a pilot passed over
 * for a job is entitled to know which line of the licence did it.
 */

import type { Finding } from '../../util/finding';
import { FindingLog } from '../../util/finding';
import type { Cm } from '../../util/units';
import type { Vessel } from '../vessel/vessel';
import { carriesDangerousCargo, pilotageUnits } from '../vessel/vessel';
import type { Pilot } from './pilot';
import { hasEndorsement } from './pilot';

export interface JobDemand {
  readonly vessel: Vessel;
  readonly draught: Cm;
  /** Whether any part of the job falls outside daylight. */
  readonly night: boolean;
  /** The berth the job starts or ends at, if it is a berth job. */
  readonly berth?: string;
  /** Anything else the district wants signed off for this job. */
  readonly extraEndorsements?: readonly string[];
}

export interface Qualification {
  readonly qualified: boolean;
  readonly findings: readonly Finding[];
  /** How much draught the pilot has in hand for this job. */
  readonly draughtHeadroom: Cm;
  /** How many units in hand. */
  readonly unitHeadroom: number;
}

export const NIGHT_ENDORSEMENT = 'NIGHT';
export const GAS_ENDORSEMENT = 'GAS';

export function qualifies(pilot: Pilot, demand: JobDemand): Qualification {
  const log = new FindingLog();
  const units = pilotageUnits(demand.vessel);

  if (!pilot.active) {
    log.block('PIL-OFF-06', 'the pilot is not on the active list', { subject: pilot.id });
  }
  if (demand.draught > pilot.limits.draught) {
    log.block('PIL-DEEP-01', 'the ship is deeper than the licence allows', {
      subject: pilot.id,
      detail: { draught: demand.draught, limit: pilot.limits.draught },
    });
  }
  if (units > pilot.limits.units) {
    log.block('PIL-UNITS-02', 'the ship is bigger than the licence allows', {
      subject: pilot.id,
      detail: { units, limit: pilot.limits.units },
    });
  }
  if (demand.night && !hasEndorsement(pilot, NIGHT_ENDORSEMENT)) {
    log.block('PIL-NIGHT-03', 'the job runs into the dark and the pilot has no night sign off', {
      subject: pilot.id,
    });
  }
  if (demand.berth !== undefined && !hasEndorsement(pilot, demand.berth)) {
    log.block('PIL-BERTH-04', 'the pilot is not signed off for the berth', {
      subject: pilot.id,
      detail: { berth: demand.berth },
    });
  }
  if (carriesDangerousCargo(demand.vessel) && !hasEndorsement(pilot, GAS_ENDORSEMENT)) {
    log.block('PIL-CLASS-05', 'the pilot is not signed off for this class of ship', {
      subject: pilot.id,
      detail: { type: demand.vessel.type },
    });
  }
  for (const endorsement of demand.extraEndorsements ?? []) {
    if (!hasEndorsement(pilot, endorsement)) {
      log.block('PIL-EXTRA-07', 'the job wants an endorsement the pilot does not hold', {
        subject: pilot.id,
        detail: { endorsement },
      });
    }
  }
  const draughtHeadroom = pilot.limits.draught - demand.draught;
  const unitHeadroom = pilot.limits.units - units;
  if (log.clear() && draughtHeadroom < 30) {
    log.advise('PIL-TIGHT-08', 'the job is within thirty centimetres of the licence limit', {
      subject: pilot.id,
      detail: { draughtHeadroom },
    });
  }
  return {
    qualified: log.clear(),
    findings: log.all(),
    draughtHeadroom,
    unitHeadroom,
  };
}

export function qualifiedPilots(pilots: readonly Pilot[], demand: JobDemand): Pilot[] {
  return pilots.filter((pilot) => qualifies(pilot, demand).qualified);
}

/** The endorsements a job asks for, which is what a report lists. */
export function endorsementsWanted(demand: JobDemand): string[] {
  const wanted = new Set<string>(demand.extraEndorsements ?? []);
  if (demand.night) {
    wanted.add(NIGHT_ENDORSEMENT);
  }
  if (demand.berth !== undefined) {
    wanted.add(demand.berth);
  }
  if (carriesDangerousCargo(demand.vessel)) {
    wanted.add(GAS_ENDORSEMENT);
  }
  return [...wanted].sort();
}

/**
 * The pilot with the least headroom who still qualifies, which is who the board
 * gives the job to when it is trying not to spend a senior licence on a small
 * ship.
 */
export function tightestQualified(pilots: readonly Pilot[], demand: JobDemand): Pilot | undefined {
  return qualifiedPilots(pilots, demand).reduce<Pilot | undefined>((best, pilot) => {
    if (best === undefined) {
      return pilot;
    }
    return pilot.limits.draught < best.limits.draught ? pilot : best;
  }, undefined);
}

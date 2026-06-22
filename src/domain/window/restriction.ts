/**
 * The standing orders: which movements are held to daylight, how many tugs a
 * ship takes, and when the channel is one way.
 *
 * These read off the ship, the berth and the conditions rather than off the
 * tide, so they are worked out once for a movement and then applied to the
 * window the tide left. A rule that lands here has a threshold in it; anything
 * that needs the curve belongs in the sweep.
 */

import type { Finding } from '../../util/finding';
import { FindingLog } from '../../util/finding';
import { InputError } from '../../util/errors';
import type { Cm } from '../../util/units';
import type { Vessel } from '../vessel/vessel';
import { carriesDangerousCargo, pilotageUnits, sizeClass } from '../vessel/vessel';
import type { CargoDeclaration } from '../vessel/cargo';
import { extraTugs, forcesDaylight as cargoForcesDaylight } from '../vessel/cargo';
import type { Passage } from '../chart/passage';

export interface RestrictionRules {
  /** Pilotage units above which a movement is daylight only. */
  readonly daylightUnits: number;
  /** Draught above which a movement is daylight only. */
  readonly daylightDraught: Cm;
  /** Wind above which a movement is not made at all, in knots. */
  readonly windCeiling: number;
  /** Visibility below which a movement is not made, in metres. */
  readonly visibilityFloor: number;
  /** Units per tug, after the first. */
  readonly unitsPerTug: number;
  /** Tugs a ship with a working bow thruster may drop. */
  readonly thrusterCredit: number;
  /** Maximum tugs the district can raise. */
  readonly tugsAvailable: number;
  /** Units above which the channel is closed to opposing traffic. */
  readonly oneWayUnits: number;
}

export const STANDING_ORDERS: RestrictionRules = {
  daylightUnits: 600,
  daylightDraught: 1200,
  windCeiling: 35,
  visibilityFloor: 1000,
  unitsPerTug: 250,
  thrusterCredit: 1,
  tugsAvailable: 4,
  oneWayUnits: 400,
};

export interface MovementConditions {
  /** Wind in knots. */
  readonly wind: number;
  /** Visibility in metres. */
  readonly visibility: number;
  /** Whether the master has asked for daylight. */
  readonly masterRequestsDaylight?: boolean;
  /** Whether the ship is under her own power. */
  readonly deadShip?: boolean;
  /** What she declared she is carrying, where a declaration was made. */
  readonly cargo?: CargoDeclaration;
}

export interface Restrictions {
  readonly daylightOnly: boolean;
  readonly daylightReasons: readonly string[];
  readonly tugs: number;
  readonly oneWay: boolean;
  readonly findings: readonly Finding[];
}

export function tugsRequired(
  rules: RestrictionRules,
  vessel: Vessel,
  conditions: MovementConditions,
): number {
  const units = pilotageUnits(vessel);
  let tugs = 1 + Math.floor(units / rules.unitsPerTug);
  if (carriesDangerousCargo(vessel)) {
    tugs += 1;
  }
  tugs += extraTugs(conditions.cargo);
  if (conditions.deadShip === true) {
    tugs += 2;
  }
  if (vessel.bowThruster && conditions.deadShip !== true) {
    tugs -= rules.thrusterCredit;
  }
  if (conditions.wind >= rules.windCeiling / 2) {
    tugs += 1;
  }
  return Math.max(0, tugs);
}

export function assessRestrictions(input: {
  rules?: RestrictionRules;
  vessel: Vessel;
  draught: Cm;
  passage: Passage;
  conditions: MovementConditions;
}): Restrictions {
  const rules = input.rules ?? STANDING_ORDERS;
  const { vessel, draught, conditions } = input;
  if (conditions.wind < 0) {
    throw new InputError('a negative wind speed is not a wind speed');
  }
  if (conditions.visibility < 0) {
    throw new InputError('a negative visibility is not a visibility');
  }
  const log = new FindingLog();
  const units = pilotageUnits(vessel);
  const daylightReasons: string[] = [];

  if (units > rules.daylightUnits) {
    daylightReasons.push('RES-DAY-01');
    log.note('RES-DAY-01', 'over the daylight size for the district', {
      detail: { units, limit: rules.daylightUnits },
    });
  }
  if (draught > rules.daylightDraught) {
    daylightReasons.push('RES-DAY-02');
    log.note('RES-DAY-02', 'over the daylight draught for the district', {
      detail: { draught, limit: rules.daylightDraught },
    });
  }
  if (conditions.masterRequestsDaylight === true) {
    daylightReasons.push('RES-DAY-03');
    log.note('RES-DAY-03', 'the master has asked for daylight');
  }
  if (conditions.deadShip === true) {
    daylightReasons.push('RES-DAY-04');
    log.note('RES-DAY-04', 'a dead ship tow is daylight only');
  }
  if (cargoForcesDaylight(conditions.cargo)) {
    daylightReasons.push('RES-DAY-09');
    log.note('RES-DAY-09', 'class one cargo moves in daylight whatever her size');
  }

  if (conditions.wind >= rules.windCeiling) {
    log.block('RES-WIND-05', 'the wind is over the ceiling for any movement', {
      detail: { wind: conditions.wind, ceiling: rules.windCeiling },
    });
  }
  if (conditions.visibility < rules.visibilityFloor) {
    log.block('RES-VIS-06', 'the visibility is under the floor for any movement', {
      detail: { visibility: conditions.visibility, floor: rules.visibilityFloor },
    });
  }

  const tugs = tugsRequired(rules, vessel, conditions);
  if (tugs > rules.tugsAvailable) {
    log.block('RES-TUG-07', 'the movement wants more tugs than the district has', {
      detail: { wanted: tugs, available: rules.tugsAvailable },
    });
  }
  if (sizeClass(vessel) === 'very-large' && tugs === 0) {
    log.advise('RES-TUG-08', 'a ship this size is being planned without a tug');
  }

  return {
    daylightOnly: daylightReasons.length > 0,
    daylightReasons,
    tugs,
    oneWay: units > rules.oneWayUnits,
    findings: log.all(),
  };
}

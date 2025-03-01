/**
 * The ship as the district knows her: the dimensions the tariff and the
 * clearance rules both read, and nothing else.
 *
 * Pilotage units are the district's own measure of a ship, and they are the
 * length, the beam and the summer draught multiplied together. They are not
 * tonnage and they are not displacement. A ship's units decide her tariff band,
 * her tug requirement and which grade of licence may take her, so they are
 * computed in one place and read everywhere.
 */

import { InputError } from '../../util/errors';
import type { Cm } from '../../util/units';
import { assertCm, roundHalf } from '../../util/units';
import { normaliseImo } from './imo';

export type VesselType =
  | 'bulk'
  | 'container'
  | 'tanker'
  | 'gas'
  | 'general'
  | 'roro'
  | 'passenger'
  | 'other';

export interface Vessel {
  readonly imo: string;
  readonly name: string;
  readonly type: VesselType;
  /** Length overall in centimetres. */
  readonly length: number;
  readonly beam: number;
  /** Summer draught in centimetres, the deepest the ship is ever presented at. */
  readonly summerDraught: Cm;
  /** Air draught at the summer draught, in centimetres. */
  readonly airDraught: Cm;
  readonly grossTonnage: number;
  readonly deadweight: number;
  /** Block coefficient in thousandths, so 0.82 is 820. */
  readonly blockCoefficient: number;
  /** Whether the ship has a bow thruster, which the tug rules read. */
  readonly bowThruster: boolean;
}

const DEFAULT_BLOCK: Record<VesselType, number> = {
  bulk: 830,
  container: 680,
  tanker: 820,
  gas: 720,
  general: 750,
  roro: 620,
  passenger: 600,
  other: 750,
};

export function makeVessel(input: {
  imo: string;
  name: string;
  type: VesselType;
  length: number;
  beam: number;
  summerDraught: number;
  airDraught: number;
  grossTonnage: number;
  deadweight?: number;
  blockCoefficient?: number;
  bowThruster?: boolean;
}): Vessel {
  const imo = normaliseImo(input.imo);
  if (input.name.trim() === '') {
    throw new InputError(`vessel ${imo} has no name`);
  }
  const length = assertCm(input.length, 'length overall');
  const beam = assertCm(input.beam, 'beam');
  const summerDraught = assertCm(input.summerDraught, 'summer draught');
  const airDraught = assertCm(input.airDraught, 'air draught');
  if (length <= 0 || beam <= 0 || summerDraught <= 0 || airDraught <= 0) {
    throw new InputError(`vessel ${imo} has a dimension of zero`);
  }
  if (beam > length) {
    throw new InputError(`vessel ${imo} is wider than she is long`);
  }
  if (summerDraught > length) {
    throw new InputError(`vessel ${imo} is deeper than she is long`);
  }
  if (!Number.isInteger(input.grossTonnage) || input.grossTonnage <= 0) {
    throw new InputError(`vessel ${imo} has no gross tonnage`);
  }
  const deadweight = input.deadweight ?? 0;
  if (!Number.isInteger(deadweight) || deadweight < 0) {
    throw new InputError(`vessel ${imo} has an impossible deadweight`);
  }
  const blockCoefficient = input.blockCoefficient ?? DEFAULT_BLOCK[input.type];
  if (!Number.isInteger(blockCoefficient) || blockCoefficient < 400 || blockCoefficient > 999) {
    throw new InputError(
      `vessel ${imo} has a block coefficient outside anything that floats: ${blockCoefficient}`,
    );
  }
  return {
    imo,
    name: input.name.trim().toUpperCase(),
    type: input.type,
    length,
    beam,
    summerDraught,
    airDraught,
    grossTonnage: input.grossTonnage,
    deadweight,
    blockCoefficient,
    bowThruster: input.bowThruster ?? false,
  };
}

/**
 * Pilotage units: length by beam by summer draught in metres, divided by a
 * hundred and rounded to the nearest whole unit. A unit is never less than one.
 */
export function pilotageUnits(vessel: Vessel): number {
  const metres = (vessel.length / 100) * (vessel.beam / 100) * (vessel.summerDraught / 100);
  return Math.max(1, roundHalf(metres / 100));
}

/** Units at a declared draught rather than at the summer marks. */
export function unitsAtDraught(vessel: Vessel, draught: Cm): number {
  if (draught <= 0) {
    throw new InputError(`a draught of ${draught} is not a draught`);
  }
  const metres = (vessel.length / 100) * (vessel.beam / 100) * (draught / 100);
  return Math.max(1, roundHalf(metres / 100));
}

/** Displacement in tonnes, from the block coefficient and the box dimensions. */
export function displacement(vessel: Vessel, draught: Cm = vessel.summerDraught): number {
  const cubic = (vessel.length / 100) * (vessel.beam / 100) * (draught / 100);
  return roundHalf((cubic * (vessel.blockCoefficient / 1000) * 1025) / 1000);
}

/** Length to beam ratio in hundredths, which the handling rules read. */
export function slenderness(vessel: Vessel): number {
  return roundHalf((vessel.length / vessel.beam) * 100);
}

export type SizeClass = 'small' | 'handy' | 'panamax' | 'large' | 'very-large';

export function sizeClass(vessel: Vessel): SizeClass {
  const units = pilotageUnits(vessel);
  if (units < 30) {
    return 'small';
  }
  if (units < 90) {
    return 'handy';
  }
  if (units < 200) {
    return 'panamax';
  }
  if (units < 400) {
    return 'large';
  }
  return 'very-large';
}

export function carriesDangerousCargo(vessel: Vessel): boolean {
  return vessel.type === 'tanker' || vessel.type === 'gas';
}

export function describeVessel(vessel: Vessel): string {
  return (
    `${vessel.name} (${vessel.imo}), ${vessel.type}, ` +
    `${vessel.length / 100} m by ${vessel.beam / 100} m, ${pilotageUnits(vessel)} units`
  );
}

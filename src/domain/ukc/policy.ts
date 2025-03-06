/**
 * The district's under keel clearance policy, and the allowances that go into
 * the water a ship needs.
 *
 * The clearance the rules require is not the whole story. Before any of it can
 * be counted, the draught has to be corrected for the water she is floating in,
 * for how far she lists in a turn, for how far she lifts and drops in a swell,
 * and for how much she settles because she is moving. Each of those is a
 * separate allowance with a rule id of its own, so a finding can say which one
 * used up the water.
 */

import { InputError } from '../../util/errors';
import type { Cm } from '../../util/units';
import { assertCm, ceilToStep, roundHalf } from '../../util/units';
import type { ChannelType } from '../chart/reach';
import type { Vessel } from '../vessel/vessel';
import { carriesDangerousCargo } from '../vessel/vessel';

export interface UkcPolicy {
  readonly id: string;
  /** Required net clearance as tenths of a percent of the static draught. */
  readonly percentOfDraught: number;
  /** Floor on the net clearance whatever the percentage works out at. */
  readonly minimumNet: Cm;
  /** Extra net clearance over a bar or a rock bottom. */
  readonly hardBottomExtra: Cm;
  /** Extra net clearance for a tanker or a gas carrier. */
  readonly dangerousCargoExtra: Cm;
  /** Fraction of the significant wave height counted as vertical response, in thousandths. */
  readonly waveResponse: number;
  /** Heel the district plans a turn on, in tenths of a degree. */
  readonly plannedHeel: number;
  /** Clearance is reported rounded up to this many centimetres. */
  readonly reportingStep: number;
}

export const STANDARD_POLICY: UkcPolicy = {
  id: 'STANDARD',
  percentOfDraught: 100,
  minimumNet: 60,
  hardBottomExtra: 30,
  dangerousCargoExtra: 20,
  waveResponse: 500,
  plannedHeel: 10,
  reportingStep: 1,
};

export function makePolicy(input: Partial<UkcPolicy> & { id: string }): UkcPolicy {
  const policy = { ...STANDARD_POLICY, ...input };
  if (!/^[A-Z][A-Z0-9-]{1,15}$/.test(policy.id)) {
    throw new InputError(`policy id must be upper case, got ${JSON.stringify(policy.id)}`);
  }
  if (policy.percentOfDraught < 0 || policy.percentOfDraught > 500) {
    throw new InputError(`policy ${policy.id} asks for an impossible percentage of draught`);
  }
  assertCm(policy.minimumNet, 'minimum net clearance');
  assertCm(policy.hardBottomExtra, 'hard bottom extra');
  assertCm(policy.dangerousCargoExtra, 'dangerous cargo extra');
  if (policy.minimumNet < 0 || policy.hardBottomExtra < 0 || policy.dangerousCargoExtra < 0) {
    throw new InputError(`policy ${policy.id} carries a negative clearance`);
  }
  if (policy.waveResponse < 0 || policy.waveResponse > 1000) {
    throw new InputError(`policy ${policy.id} has a wave response outside nought to one`);
  }
  if (policy.plannedHeel < 0 || policy.plannedHeel > 150) {
    throw new InputError(`policy ${policy.id} plans a heel no ship would survive`);
  }
  if (!Number.isInteger(policy.reportingStep) || policy.reportingStep <= 0) {
    throw new InputError(`policy ${policy.id} has no reporting step`);
  }
  return policy;
}

export interface ClearanceDemand {
  readonly required: Cm;
  readonly reasons: readonly string[];
}

/**
 * The net clearance the district requires under this ship on this bottom. The
 * percentage and the floor are alternatives and the extras are additions, so a
 * shallow draught tanker over a bar picks up both extras on top of the floor.
 */
export function requiredNetClearance(
  policy: UkcPolicy,
  vessel: Vessel,
  draught: Cm,
  options: { hardBottom?: boolean } = {},
): ClearanceDemand {
  if (draught <= 0) {
    throw new InputError(`a draught of ${draught} is not a draught`);
  }
  const fromPercent = roundHalf((draught * policy.percentOfDraught) / 1000);
  const reasons: string[] = [];
  let required: number;
  if (fromPercent >= policy.minimumNet) {
    required = fromPercent;
    reasons.push('UKC-PCT-01');
  } else {
    required = policy.minimumNet;
    reasons.push('UKC-MIN-02');
  }
  if (options.hardBottom === true) {
    required += policy.hardBottomExtra;
    reasons.push('UKC-BAR-03');
  }
  if (carriesDangerousCargo(vessel)) {
    required += policy.dangerousCargoExtra;
    reasons.push('UKC-CARGO-04');
  }
  return { required: ceilToStep(required, policy.reportingStep), reasons };
}

/**
 * Heel allowance: half the beam through the sine of the planned heel. A wide
 * ship loses more water to a turn than a narrow one at the same angle.
 */
export function heelAllowance(policy: UkcPolicy, vessel: Vessel): Cm {
  const radians = ((policy.plannedHeel / 10) * Math.PI) / 180;
  return roundHalf((vessel.beam / 2) * Math.sin(radians));
}

/** Vertical response to a swell, as a fraction of the significant wave height. */
export function waveAllowance(policy: UkcPolicy, waveHeight: Cm, channel: ChannelType): Cm {
  if (waveHeight < 0) {
    throw new InputError('a negative wave height is not a sea state');
  }
  if (channel === 'canal') {
    return 0;
  }
  const shelter = channel === 'restricted' ? 0.5 : 1;
  return roundHalf((waveHeight * policy.waveResponse * shelter) / 1000);
}

/**
 * How much deeper a ship floats in water lighter than salt. Density is given in
 * thousandths, so salt water is 1025 and a river in flood can be 1005.
 */
export function densityAllowance(draught: Cm, density: number): Cm {
  if (density < 950 || density > 1050) {
    throw new InputError(`a water density of ${density} is outside anything measurable`);
  }
  return Math.max(0, roundHalf(draught * (1025 / density - 1)));
}

export function describePolicy(policy: UkcPolicy): string {
  return (
    `${policy.id}: ${(policy.percentOfDraught / 10).toFixed(1)}% of draught or ` +
    `${policy.minimumNet} cm, whichever is greater`
  );
}

/**
 * Bridges, power cables and pipeline crossings.
 *
 * These are the constraint that runs the other way. Charted clearance is
 * measured above chart datum, so the water taking a ship over the bar is the
 * same water taking her mast into the bridge, and a ship that is both deep and
 * tall has a window bounded from both sides. Sometimes there is no window at
 * all, and saying so early is most of the value of this module.
 */

import { InputError } from '../../util/errors';
import type { Cm } from '../../util/units';
import { assertCm } from '../../util/units';

export type OverheadKind = 'bridge' | 'cable' | 'pipeline';

export interface Overhead {
  readonly id: string;
  readonly name: string;
  readonly kind: OverheadKind;
  /** The reach the structure crosses. */
  readonly reach: string;
  /** Charted clearance above chart datum, in centimetres. */
  readonly clearance: Cm;
  /** Tide station the crossing is planned against. */
  readonly station: string;
  /** Minimum air gap the district requires under the structure. */
  readonly airGap: Cm;
}

const OVERHEAD_ID = /^[A-Z][A-Z0-9-]{1,15}$/;

export function makeOverhead(input: {
  id: string;
  name: string;
  kind: OverheadKind;
  reach: string;
  clearance: number;
  station: string;
  airGap?: number;
}): Overhead {
  if (!OVERHEAD_ID.test(input.id)) {
    throw new InputError(`overhead id must be upper case, got ${JSON.stringify(input.id)}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`overhead ${input.id} has no name`);
  }
  const clearance = assertCm(input.clearance, 'charted clearance');
  if (clearance <= 0) {
    throw new InputError(`overhead ${input.id} has no clearance`);
  }
  const airGap = assertCm(input.airGap ?? 200, 'air gap');
  if (airGap < 0) {
    throw new InputError(`overhead ${input.id} has a negative air gap`);
  }
  return {
    id: input.id,
    name: input.name.trim(),
    kind: input.kind,
    reach: input.reach,
    clearance,
    station: input.station,
    airGap,
  };
}

/** What is actually left under the structure at a state of tide. */
export function clearanceAtTide(overhead: Overhead, tideHeight: Cm): Cm {
  return overhead.clearance - tideHeight;
}

/** The most tide a ship of this air draught can take under the structure. */
export function highestPassableTide(overhead: Overhead, airDraught: Cm): Cm {
  return overhead.clearance - overhead.airGap - airDraught;
}

/** Whether a ship of this air draught fits at this state of tide. */
export function fitsUnder(overhead: Overhead, airDraught: Cm, tideHeight: Cm): boolean {
  return clearanceAtTide(overhead, tideHeight) - airDraught >= overhead.airGap;
}

/** How much room is over the masthead, which is what the finding reports. */
export function spareAir(overhead: Overhead, airDraught: Cm, tideHeight: Cm): Cm {
  return clearanceAtTide(overhead, tideHeight) - airDraught - overhead.airGap;
}

/** A ship this tall cannot pass on any tide, however low. */
export function neverPasses(overhead: Overhead, airDraught: Cm): boolean {
  return highestPassableTide(overhead, airDraught) < 0;
}

export function describeOverhead(overhead: Overhead): string {
  return `${overhead.id} ${overhead.name} (${overhead.kind}), ${overhead.clearance} cm above datum`;
}

/**
 * Berths and anchorages: where a movement starts or ends.
 *
 * A berth has its own depth alongside, and it is charted against the same datum
 * as the channel, so a ship can perfectly well have water all the way up the
 * river and then not be able to lie at the berth she is going to.
 */

import { InputError } from '../../util/errors';
import type { Cm } from '../../util/units';
import { assertCm } from '../../util/units';

export type BerthKind = 'quay' | 'anchorage' | 'buoys' | 'sea';

export interface Berth {
  readonly id: string;
  readonly name: string;
  readonly kind: BerthKind;
  /** The reach the berth is reached from. */
  readonly reach: string;
  /** Charted depth alongside, below chart datum. */
  readonly depth: Cm;
  /** Longest ship the berth takes, in centimetres of length overall. */
  readonly maxLength: Cm;
  /** Required clearance under the keel while lying alongside. */
  readonly restingClearance: Cm;
  readonly terminal: string;
}

const BERTH_ID = /^[A-Z][A-Z0-9-]{1,15}$/;

export function makeBerth(input: {
  id: string;
  name: string;
  kind: BerthKind;
  reach: string;
  depth: number;
  maxLength: number;
  restingClearance?: number;
  terminal?: string;
}): Berth {
  if (!BERTH_ID.test(input.id)) {
    throw new InputError(`berth id must be upper case, got ${JSON.stringify(input.id)}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`berth ${input.id} has no name`);
  }
  const depth = assertCm(input.depth, 'berth depth');
  if (depth <= 0) {
    throw new InputError(`berth ${input.id} has no charted depth`);
  }
  const maxLength = assertCm(input.maxLength, 'maximum length');
  if (maxLength <= 0) {
    throw new InputError(`berth ${input.id} takes no length of ship`);
  }
  const restingClearance = assertCm(input.restingClearance ?? 30, 'resting clearance');
  if (restingClearance < 0) {
    throw new InputError(`berth ${input.id} has a negative resting clearance`);
  }
  return {
    id: input.id,
    name: input.name.trim(),
    kind: input.kind,
    reach: input.reach,
    depth,
    maxLength,
    restingClearance,
    terminal: input.terminal ?? 'unassigned',
  };
}

/** The deepest ship that can lie here at a state of tide. */
export function deepestLyingDraught(berth: Berth, tideHeight: Cm): Cm {
  return berth.depth + tideHeight - berth.restingClearance;
}

export function takesLength(berth: Berth, lengthOverall: Cm): boolean {
  return lengthOverall <= berth.maxLength;
}

export function canLie(berth: Berth, draught: Cm, tideHeight: Cm): boolean {
  return draught <= deepestLyingDraught(berth, tideHeight);
}

/** The least tide that lets a ship of this draught stay alongside. */
export function lowestRestingTide(berth: Berth, draught: Cm): Cm {
  return draught + berth.restingClearance - berth.depth;
}

/** An anchorage is planned differently from a quay, so the kind is asked about. */
export function isAfloatBerth(berth: Berth): boolean {
  return berth.kind === 'anchorage' || berth.kind === 'buoys' || berth.kind === 'sea';
}

export function describeBerth(berth: Berth): string {
  return `${berth.id} ${berth.name} (${berth.kind}) on ${berth.reach}, ${berth.depth} cm`;
}

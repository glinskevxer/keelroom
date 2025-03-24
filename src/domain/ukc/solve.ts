/**
 * The two questions the despatcher actually asks, both of which are inverses of
 * the assessment rather than formulas of their own.
 *
 * How much tide does this ship need on this reach, and how deep a ship can I
 * take on the tide I have. Neither can be rearranged out of the assessment,
 * because squat depends on the water the ship is in, so both are solved by
 * bisection over an assessment that is run again at every step. The searches
 * are only valid because the margin moves one way: more tide is never worse,
 * and more draught is never better.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import type { Cm } from '../../util/units';
import type { Reach } from '../chart/reach';
import type { Vessel } from '../vessel/vessel';
import type { UkcPolicy } from './policy';
import { assessReach } from './assessment';
import type { ReachAssessment, TransitConditions } from './assessment';

export interface SolveInput {
  readonly reach: Reach;
  readonly vessel: Vessel;
  readonly policy: UkcPolicy;
  readonly at: Minute;
  readonly conditions: TransitConditions;
}

/** The margin at a draught and a state of tide, in centimetres. */
export function marginAt(input: SolveInput, draught: Cm, tideHeight: Cm): Cm {
  return assess(input, draught, tideHeight).margin;
}

function assess(input: SolveInput, draught: Cm, tideHeight: Cm): ReachAssessment {
  return assessReach({
    reach: input.reach,
    vessel: input.vessel,
    draught,
    policy: input.policy,
    at: input.at,
    tideHeight,
    conditions: input.conditions,
  });
}

export interface SearchBounds {
  readonly lowest: Cm;
  readonly highest: Cm;
}

const DEFAULT_TIDE_BOUNDS: SearchBounds = { lowest: -200, highest: 1200 };
const DEFAULT_DRAUGHT_BOUNDS: SearchBounds = { lowest: 100, highest: 2500 };

/**
 * The least height of tide that lets this ship pass this reach, or nothing if
 * no tide inside the bounds does.
 */
export function leastTideFor(
  input: SolveInput,
  draught: Cm,
  bounds: SearchBounds = DEFAULT_TIDE_BOUNDS,
): Cm | undefined {
  checkBounds(bounds);
  if (marginAt(input, draught, bounds.lowest) >= 0) {
    return bounds.lowest;
  }
  if (marginAt(input, draught, bounds.highest) < 0) {
    return undefined;
  }
  let low = bounds.lowest;
  let high = bounds.highest;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (marginAt(input, draught, middle) >= 0) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

/**
 * The deepest whole centimetre of draught this ship may be presented at on the
 * tide given, or nothing if she cannot pass at any draught worth having.
 */
export function deepestDraughtAt(
  input: SolveInput,
  tideHeight: Cm,
  bounds: SearchBounds = DEFAULT_DRAUGHT_BOUNDS,
): Cm | undefined {
  checkBounds(bounds);
  if (marginAt(input, bounds.lowest, tideHeight) < 0) {
    return undefined;
  }
  if (marginAt(input, bounds.highest, tideHeight) >= 0) {
    return bounds.highest;
  }
  let low = bounds.lowest;
  let high = bounds.highest;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (marginAt(input, middle, tideHeight) >= 0) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

function checkBounds(bounds: SearchBounds): void {
  if (!Number.isInteger(bounds.lowest) || !Number.isInteger(bounds.highest)) {
    throw new InputError('search bounds must be whole centimetres');
  }
  if (bounds.highest <= bounds.lowest) {
    throw new InputError('search bounds are inverted');
  }
}

/**
 * How much more draught the ship could have taken on the tide she is planned
 * for. Negative means she is over the limit as planned.
 */
export function spareDraught(input: SolveInput, draught: Cm, tideHeight: Cm): Cm {
  const deepest = deepestDraughtAt(input, tideHeight);
  if (deepest === undefined) {
    return -draught;
  }
  return deepest - draught;
}

/**
 * How much tide the ship has in hand: the height she is planned on less the
 * least she needs. Undefined when no tide in range would do.
 */
export function spareTide(input: SolveInput, draught: Cm, tideHeight: Cm): Cm | undefined {
  const least = leastTideFor(input, draught);
  return least === undefined ? undefined : tideHeight - least;
}

/**
 * What a centimetre of tide is worth in draught, in hundredths of a centimetre.
 *
 * It is not one for one, and which way it goes depends on the policy. A
 * clearance written as a percentage of draught gives some of the loss back,
 * because a lighter ship is also required to keep less water under her, while
 * squat pushes the other way because shallower water settles her further. The
 * district reads this number rather than assuming either.
 */
export function exchangeRate(input: SolveInput, draught: Cm, tideHeight: Cm): number {
  const here = deepestDraughtAt(input, tideHeight);
  const lower = deepestDraughtAt(input, tideHeight - 50);
  if (here === undefined || lower === undefined) {
    throw new InputError('the exchange rate needs a passable ship at both states of tide');
  }
  return Math.round(((here - lower) / 50) * 100);
}

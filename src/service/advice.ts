/**
 * The questions the agents ask before they order anything.
 *
 * How deep can she come on Thursday. When is the best water this week. What
 * would another twenty centimetres cost her in waiting. None of these is a
 * movement, so none of them writes anything down; they are the planner run
 * against a ship that has not been ordered yet.
 */

import { InputError } from '../util/errors';
import type { Minute } from '../util/clock';
import { MINUTES_PER_DAY } from '../util/clock';
import type { Interval } from '../util/interval';
import { makeInterval, totalMinutes } from '../util/interval';
import type { Cm } from '../util/units';
import { requireBerth, reachesToBerth } from '../domain/chart/district';
import { buildPassage } from '../domain/chart/passage';
import type { Direction } from '../domain/chart/passage';
import { sweep } from '../domain/window/sweep';
import type { TransitPlan } from '../domain/window/sweep';
import { requireVessel } from '../storage/fleet-store';
import type { Context } from './context';
import { FAIR_WEATHER } from './planning';

export interface AdviceRequest {
  readonly vessel: string;
  readonly berth: string;
  readonly direction: Direction;
  readonly period: Interval;
}

function planFor(context: Context, request: AdviceRequest, draught: Cm): TransitPlan {
  const vessel = requireVessel(context.db, request.vessel);
  const berth = requireBerth(context.district, request.berth);
  return {
    district: context.district,
    passage: buildPassage(reachesToBerth(context.district, berth), request.direction, {
      speed: context.config.transitSpeed,
      startDelay: 20,
      endDelay: 30,
    }),
    vessel,
    draught,
    policy: context.config.clearance,
    conditions: FAIR_WEATHER.transit,
  };
}

export interface DraughtAdvice {
  readonly draught: Cm;
  readonly windowMinutes: number;
  readonly windows: readonly Interval[];
}

/** What she gets at a draught: the windows, and how much of the period they cover. */
export function adviseAt(context: Context, request: AdviceRequest, draught: Cm): DraughtAdvice {
  const result = sweep(planFor(context, request, draught), request.period);
  return {
    draught,
    windowMinutes: totalMinutes(result.windows),
    windows: result.windows,
  };
}

/**
 * The deepest she can be presented at and still have a window of at least the
 * length asked for. Searched by bisection, because window minutes fall as she
 * loads and the search only holds while they do.
 */
export function deepestForWindow(
  context: Context,
  request: AdviceRequest,
  wantMinutes: number,
  bounds: { lowest: Cm; highest: Cm },
): Cm | undefined {
  if (bounds.highest <= bounds.lowest) {
    throw new InputError('the draught bounds are inverted');
  }
  if (adviseAt(context, request, bounds.lowest).windowMinutes < wantMinutes) {
    return undefined;
  }
  if (adviseAt(context, request, bounds.highest).windowMinutes >= wantMinutes) {
    return bounds.highest;
  }
  let low = bounds.lowest;
  let high = bounds.highest;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (adviseAt(context, request, middle).windowMinutes >= wantMinutes) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

export interface DraughtLadder {
  readonly steps: readonly DraughtAdvice[];
}

/** What each ten centimetres costs her, which is the table the agents want. */
export function draughtLadder(
  context: Context,
  request: AdviceRequest,
  from: Cm,
  to: Cm,
  step: Cm = 10,
): DraughtLadder {
  if (step <= 0) {
    throw new InputError('a ladder climbs by a positive number of centimetres');
  }
  const steps: DraughtAdvice[] = [];
  for (let draught = from; draught <= to; draught += step) {
    steps.push(adviseAt(context, request, draught));
  }
  return { steps };
}

/** The best day of the next several for a ship of a given draught. */
export function bestDay(
  context: Context,
  request: Omit<AdviceRequest, 'period'>,
  draught: Cm,
  from: Minute,
  days: number,
): { day: Minute; minutes: number }[] {
  const found: { day: Minute; minutes: number }[] = [];
  for (let index = 0; index < days; index += 1) {
    const day = from + index * MINUTES_PER_DAY;
    const period = makeInterval(day, day + MINUTES_PER_DAY);
    found.push({
      day,
      minutes: adviseAt(context, { ...request, period }, draught).windowMinutes,
    });
  }
  return found.sort((a, b) => b.minutes - a.minutes || a.day - b.day);
}

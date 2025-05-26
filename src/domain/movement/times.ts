/**
 * The times a pilot writes on the card, and the detention that falls out of
 * them.
 *
 * Detention is the money side of a ship not being ready. The pilot is ordered
 * for a time; if he boards later than that through no fault of the district, the
 * waiting is chargeable once a grace period has run out, and it is charged in
 * whole started blocks rather than by the minute. A delay the district caused,
 * a tug that did not turn up or a berth that was not clear, is recorded the same
 * way and charged to nobody.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';

export type DelayCause = 'vessel' | 'berth' | 'tug' | 'weather' | 'district' | 'traffic';

export interface Delay {
  readonly cause: DelayCause;
  readonly from: Minute;
  readonly to: Minute;
  readonly note?: string;
}

export interface MovementTimes {
  /** The time the pilot was ordered for. */
  readonly orderedFor: Minute;
  /** When the pilot actually boarded. */
  readonly boarded?: Minute;
  /** When she let go, or weighed. */
  readonly letGo?: Minute;
  /** When she was all fast, or the pilot landed. */
  readonly allFast?: Minute;
  readonly delays?: readonly Delay[];
}

export interface DetentionRules {
  /** Minutes of waiting allowed before anything is charged. */
  readonly grace: number;
  /** The block detention is charged in. */
  readonly block: number;
  /** Causes the ship pays for. */
  readonly chargeable: readonly DelayCause[];
}

export const STANDARD_DETENTION: DetentionRules = {
  grace: 30,
  block: 30,
  chargeable: ['vessel', 'berth', 'tug'],
};

export function makeDelay(cause: DelayCause, from: Minute, to: Minute, note?: string): Delay {
  if (to < from) {
    throw new InputError('a delay cannot end before it starts');
  }
  return { cause, from, to, ...(note === undefined ? {} : { note }) };
}

export function delayMinutes(delay: Delay): number {
  return delay.to - delay.from;
}

/** Minutes the pilot waited past the time he was ordered for. */
export function waitingMinutes(times: MovementTimes): number {
  if (times.boarded === undefined) {
    return 0;
  }
  return Math.max(0, times.boarded - times.orderedFor);
}

/** Minutes of delay the ship is answerable for, whenever they happened. */
export function chargeableDelayMinutes(
  times: MovementTimes,
  rules: DetentionRules = STANDARD_DETENTION,
): number {
  return (times.delays ?? [])
    .filter((delay) => rules.chargeable.includes(delay.cause))
    .reduce((total, delay) => total + delayMinutes(delay), 0);
}

export function unchargeableDelayMinutes(
  times: MovementTimes,
  rules: DetentionRules = STANDARD_DETENTION,
): number {
  return (times.delays ?? [])
    .filter((delay) => !rules.chargeable.includes(delay.cause))
    .reduce((total, delay) => total + delayMinutes(delay), 0);
}

/**
 * Detention in whole started blocks, after the grace period. Waiting to board
 * and delays during the job are added together first, so two twenty minute
 * holds are charged as an hour rather than as nothing.
 */
export function detentionBlocks(
  times: MovementTimes,
  rules: DetentionRules = STANDARD_DETENTION,
): number {
  if (rules.block <= 0) {
    throw new InputError('detention must be charged in a block of some length');
  }
  const total = waitingMinutes(times) + chargeableDelayMinutes(times, rules);
  const beyond = total - rules.grace;
  if (beyond <= 0) {
    return 0;
  }
  return Math.ceil(beyond / rules.block);
}

export function detentionMinutes(
  times: MovementTimes,
  rules: DetentionRules = STANDARD_DETENTION,
): number {
  return detentionBlocks(times, rules) * rules.block;
}

/** Boarding to landing, which is what the duty log records. */
export function pilotOnBoardMinutes(times: MovementTimes): number {
  if (times.boarded === undefined || times.allFast === undefined) {
    return 0;
  }
  if (times.allFast < times.boarded) {
    throw new InputError('the pilot landed before he boarded');
  }
  return times.allFast - times.boarded;
}

/** Let go to all fast, which is the movement proper. */
export function runningMinutes(times: MovementTimes): number {
  if (times.letGo === undefined || times.allFast === undefined) {
    return 0;
  }
  return Math.max(0, times.allFast - times.letGo);
}

export function isComplete(times: MovementTimes): boolean {
  return times.boarded !== undefined && times.allFast !== undefined;
}

/** The delays grouped by cause, which is what the monthly return wants. */
export function delaysByCause(times: MovementTimes): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const delay of times.delays ?? []) {
    totals[delay.cause] = (totals[delay.cause] ?? 0) + delayMinutes(delay);
  }
  return totals;
}

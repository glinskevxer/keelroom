/**
 * What a movement costs when it does not happen, and what waiting costs when it
 * does.
 *
 * A cancellation is priced off how much notice the district got, and off how far
 * the job had already gone. Notice is measured to the time the ship was planned
 * for, not to the time the agent originally asked for, because the district
 * plans against the window it offered. Once a pilot has boarded there is no
 * notice left to give and the movement is charged in full whatever happens
 * afterwards.
 */

import { InputError } from '../../util/errors';
import type { Cents } from '../../util/units';
import { applyBps } from '../../util/units';
import type { MovementStatus } from '../movement/movement';
import type { TariffBook } from './book';
import type { ChargeLine } from './charge';
import { makeLine } from './charge';

export interface CancellationStep {
  /** Cancellations with at least this many hours of notice fall in the step. */
  readonly noticeHours: number;
  /** Portion of the base charged, in basis points. */
  readonly rate: number;
}

export interface PenaltyRules {
  /** Steps in descending order of notice. */
  readonly steps: readonly CancellationStep[];
  /** Rate charged once the pilot has boarded, whatever the notice. */
  readonly afterBoarding: number;
  /** Rate charged when the district itself cancels. */
  readonly districtCancels: number;
}

export const STANDARD_PENALTIES: PenaltyRules = {
  steps: [
    { noticeHours: 6, rate: 0 },
    { noticeHours: 2, rate: 5000 },
    { noticeHours: 0, rate: 10000 },
  ],
  afterBoarding: 10000,
  districtCancels: 0,
};

export function makePenaltyRules(input: Partial<PenaltyRules> = {}): PenaltyRules {
  const rules = { ...STANDARD_PENALTIES, ...input };
  if (rules.steps.length === 0) {
    throw new InputError('the cancellation scale has no steps');
  }
  let previous = Number.POSITIVE_INFINITY;
  for (const step of rules.steps) {
    if (!Number.isInteger(step.noticeHours) || step.noticeHours < 0) {
      throw new InputError('a cancellation step needs whole hours of notice');
    }
    if (step.noticeHours >= previous) {
      throw new InputError('the cancellation scale must run from most notice to least');
    }
    if (!Number.isInteger(step.rate) || step.rate < 0 || step.rate > 10000) {
      throw new InputError(`a cancellation rate of ${step.rate} is not a portion of the charge`);
    }
    previous = step.noticeHours;
  }
  return rules;
}

export interface CancellationInput {
  readonly base: Cents;
  /** Hours between the cancellation and the time the ship was planned for. */
  readonly noticeHours: number;
  readonly status: MovementStatus;
  /** Whether it was the district that cancelled rather than the ship. */
  readonly byDistrict?: boolean;
}

export interface Cancellation {
  readonly rate: number;
  readonly amount: Cents;
  readonly reason: string;
}

export function cancellationCharge(rules: PenaltyRules, input: CancellationInput): Cancellation {
  if (input.byDistrict === true) {
    return {
      rate: rules.districtCancels,
      amount: applyBps(input.base, rules.districtCancels),
      reason: 'CAN-PORT-04',
    };
  }
  if (input.status === 'boarded' || input.status === 'underway') {
    return {
      rate: rules.afterBoarding,
      amount: applyBps(input.base, rules.afterBoarding),
      reason: 'CAN-ABOARD-03',
    };
  }
  const step = [...rules.steps]
    .sort((a, b) => b.noticeHours - a.noticeHours)
    .find((candidate) => input.noticeHours >= candidate.noticeHours);
  if (step === undefined) {
    throw new InputError('the cancellation scale does not cover this much notice');
  }
  return {
    rate: step.rate,
    amount: applyBps(input.base, step.rate),
    reason: step.rate === 0 ? 'CAN-FREE-01' : 'CAN-LATE-02',
  };
}

export function cancellationLines(rules: PenaltyRules, input: CancellationInput): ChargeLine[] {
  const cancellation = cancellationCharge(rules, input);
  if (cancellation.amount === 0) {
    return [];
  }
  return [
    makeLine(
      'CANCEL',
      `cancellation at ${(cancellation.rate / 100).toFixed(0)} percent of the charge`,
      cancellation.amount,
    ),
  ];
}

/** Detention, charged by the block the times module counted. */
export function detentionLines(book: TariffBook, blocks: number): ChargeLine[] {
  if (!Number.isInteger(blocks) || blocks < 0) {
    throw new InputError(`detention is charged in whole blocks, got ${blocks}`);
  }
  if (blocks === 0 || book.detentionBlock === 0) {
    return [];
  }
  return [makeLine('DETENTION', `detention, ${blocks} blocks`, blocks * book.detentionBlock)];
}

/** The notice at which a cancellation would become free, for the despatcher. */
export function freeCancellationHours(rules: PenaltyRules): number | undefined {
  return [...rules.steps]
    .sort((a, b) => a.noticeHours - b.noticeHours)
    .find((step) => step.rate === 0)?.noticeHours;
}

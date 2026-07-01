/**
 * Disputes.
 *
 * An agent who says an invoice is wrong is not an agent who is refusing to pay,
 * and the district treats the two differently: a disputed invoice stops being
 * chased and stops counting against the credit limit until somebody has read it.
 * What it does not do is disappear, and a dispute nobody has answered inside the
 * days the district allows itself is a finding rather than a filing cabinet.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import { MINUTES_PER_DAY } from '../../util/clock';
import type { Cents } from '../../util/units';
import { assertCents } from '../../util/units';

export type DisputeGround =
  | 'not-our-movement'
  | 'wrong-rate'
  | 'wrong-units'
  | 'detention-not-ours'
  | 'already-paid'
  | 'other';

export type DisputeOutcome = 'open' | 'upheld' | 'rejected' | 'withdrawn';

export interface Dispute {
  readonly invoice: string;
  readonly agent: string;
  readonly ground: DisputeGround;
  /** How much of the invoice is disputed, which is often not all of it. */
  readonly amount: Cents;
  readonly raisedAt: Minute;
  readonly note: string;
  readonly outcome: DisputeOutcome;
  readonly settledAt?: Minute;
  readonly answer?: string;
}

const GROUNDS: readonly DisputeGround[] = [
  'not-our-movement',
  'wrong-rate',
  'wrong-units',
  'detention-not-ours',
  'already-paid',
  'other',
];

export function disputeGrounds(): readonly DisputeGround[] {
  return GROUNDS;
}

export function isDisputeGround(candidate: string): candidate is DisputeGround {
  return (GROUNDS as readonly string[]).includes(candidate);
}

export function raiseDispute(input: {
  invoice: string;
  agent: string;
  ground: string;
  amount: number;
  raisedAt: Minute;
  note: string;
}): Dispute {
  if (!isDisputeGround(input.ground)) {
    throw new InputError(`${input.ground} is not a ground the district recognises`);
  }
  const amount = assertCents(input.amount, 'disputed amount');
  if (amount <= 0) {
    throw new InputError('a dispute is over a positive amount');
  }
  if (input.note.trim().length < 5) {
    throw new InputError('a dispute carries what the agent actually said');
  }
  return {
    invoice: input.invoice,
    agent: input.agent,
    ground: input.ground,
    amount,
    raisedAt: input.raisedAt,
    note: input.note.trim(),
    outcome: 'open',
  };
}

export function settle(
  dispute: Dispute,
  outcome: Exclude<DisputeOutcome, 'open'>,
  at: Minute,
  answer: string,
): Dispute {
  if (dispute.outcome !== 'open') {
    throw new InputError(`the dispute over ${dispute.invoice} was settled already`, {
      outcome: dispute.outcome,
    });
  }
  if (answer.trim() === '') {
    throw new InputError('settling a dispute takes an answer in words');
  }
  return { ...dispute, outcome, settledAt: at, answer: answer.trim() };
}

export function isOpen(dispute: Dispute): boolean {
  return dispute.outcome === 'open';
}

/** Disputes nobody has answered inside the days the district allows. */
export function overdue(disputes: readonly Dispute[], at: Minute, withinDays = 14): Dispute[] {
  return disputes
    .filter((dispute) => isOpen(dispute) && at - dispute.raisedAt > withinDays * MINUTES_PER_DAY)
    .sort((a, b) => a.raisedAt - b.raisedAt || a.invoice.localeCompare(b.invoice));
}

/** What is under dispute on one invoice, which the chasing leaves alone. */
export function disputedOn(disputes: readonly Dispute[], invoice: string): Cents {
  return disputes
    .filter((dispute) => dispute.invoice === invoice && isOpen(dispute))
    .reduce((total, dispute) => total + dispute.amount, 0);
}

export function openFor(disputes: readonly Dispute[], agent: string): Dispute[] {
  return disputes.filter((dispute) => dispute.agent === agent && isOpen(dispute));
}

export function describeDispute(dispute: Dispute): string {
  const settled = dispute.outcome === 'open' ? 'open' : `${dispute.outcome}`;
  return `${dispute.invoice} ${dispute.ground} (${settled}): ${dispute.note}`;
}

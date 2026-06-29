/**
 * Deposits.
 *
 * An agent the district does not extend credit to lodges money before the ship
 * moves, and the movements are run down against it. A deposit is not a payment:
 * it belongs to the agent until a movement has run, and what is left of it goes
 * back rather than being kept against the next call. Keeping those two apart is
 * the whole reason this is a separate record and not just a credit balance.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import type { Cents } from '../../util/units';
import { assertCents } from '../../util/units';

export interface Deposit {
  readonly reference: string;
  readonly agent: string;
  readonly amount: Cents;
  readonly lodgedAt: Minute;
  /** The movement it was lodged against, where it is for one. */
  readonly movement?: string;
  readonly note?: string;
}

export interface DepositDraw {
  readonly deposit: string;
  readonly movement: string;
  readonly amount: Cents;
  readonly at: Minute;
}

export function makeDeposit(input: {
  reference: string;
  agent: string;
  amount: number;
  lodgedAt: Minute;
  movement?: string;
  note?: string;
}): Deposit {
  if (input.reference.trim() === '') {
    throw new InputError('a deposit needs a reference');
  }
  const amount = assertCents(input.amount, 'deposit');
  if (amount <= 0) {
    throw new InputError('a deposit is for a positive amount');
  }
  return {
    reference: input.reference.trim(),
    agent: input.agent,
    amount,
    lodgedAt: input.lodgedAt,
    ...(input.movement === undefined ? {} : { movement: input.movement }),
    ...(input.note === undefined ? {} : { note: input.note.trim() }),
  };
}

export function drawnFrom(draws: readonly DepositDraw[], deposit: string): Cents {
  return draws
    .filter((draw) => draw.deposit === deposit)
    .reduce((total, draw) => total + draw.amount, 0);
}

export function remainingOn(deposit: Deposit, draws: readonly DepositDraw[]): Cents {
  return Math.max(0, deposit.amount - drawnFrom(draws, deposit.reference));
}

/** Everything the agent has lodged and not yet used. */
export function heldFor(
  agent: string,
  deposits: readonly Deposit[],
  draws: readonly DepositDraw[],
): Cents {
  return deposits
    .filter((deposit) => deposit.agent === agent)
    .reduce((total, deposit) => total + remainingOn(deposit, draws), 0);
}

export interface DrawResult {
  readonly draws: readonly DepositDraw[];
  /** What the deposits could not cover, which goes on an invoice. */
  readonly short: Cents;
}

/**
 * Draw a charge down against what the agent has lodged, oldest deposit first,
 * and say what is left over to bill.
 */
export function drawDown(input: {
  agent: string;
  movement: string;
  amount: Cents;
  at: Minute;
  deposits: readonly Deposit[];
  draws: readonly DepositDraw[];
}): DrawResult {
  assertCents(input.amount, 'charge');
  if (input.amount < 0) {
    throw new InputError('a charge drawn against a deposit is positive');
  }
  const held = input.deposits
    .filter((deposit) => deposit.agent === input.agent)
    .sort((a, b) => a.lodgedAt - b.lodgedAt || a.reference.localeCompare(b.reference));
  const made: DepositDraw[] = [];
  let left = input.amount;
  for (const deposit of held) {
    if (left <= 0) {
      break;
    }
    const available = remainingOn(deposit, [...input.draws, ...made]);
    if (available <= 0) {
      continue;
    }
    const amount = Math.min(available, left);
    made.push({ deposit: deposit.reference, movement: input.movement, amount, at: input.at });
    left -= amount;
  }
  return { draws: made, short: left };
}

/** Deposits with nothing left on them, which the refund run picks up. */
export function exhausted(deposits: readonly Deposit[], draws: readonly DepositDraw[]): Deposit[] {
  return deposits.filter((deposit) => remainingOn(deposit, draws) === 0);
}

export function refundable(
  agent: string,
  deposits: readonly Deposit[],
  draws: readonly DepositDraw[],
): { deposit: string; amount: Cents }[] {
  return deposits
    .filter((deposit) => deposit.agent === agent && remainingOn(deposit, draws) > 0)
    .map((deposit) => ({ deposit: deposit.reference, amount: remainingOn(deposit, draws) }));
}

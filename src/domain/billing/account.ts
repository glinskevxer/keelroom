/**
 * The agent's account with the district.
 *
 * Everything about how an agent is charged and chased lives here: the payment
 * terms, the discount their volume agreement carries, the credit limit, and
 * whether they are on stop. An agent on stop can still order a movement, and
 * the district can still refuse to run it, which is a decision for a person
 * rather than for this module; what this module does is say where the account
 * stands.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import { MINUTES_PER_DAY } from '../../util/clock';
import type { Cents } from '../../util/units';
import { assertCents } from '../../util/units';

export interface Account {
  readonly agent: string;
  readonly name: string;
  /** Days from the invoice date to the due date. */
  readonly termsDays: number;
  /** Volume discount in basis points. */
  readonly discount: number;
  /** Most the agent may owe before the district stops them. */
  readonly creditLimit: Cents;
  /** Whether the district has stopped them by hand. */
  readonly stopped: boolean;
  /** Whether a movement may be ordered without a deposit. */
  readonly requiresDeposit: boolean;
}

const AGENT = /^[A-Z][A-Z0-9-]{1,11}$/;

export function makeAccount(input: {
  agent: string;
  name: string;
  termsDays?: number;
  discount?: number;
  creditLimit?: number;
  stopped?: boolean;
  requiresDeposit?: boolean;
}): Account {
  if (!AGENT.test(input.agent)) {
    throw new InputError(`agent code must be upper case, got ${JSON.stringify(input.agent)}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`account ${input.agent} has no name`);
  }
  const termsDays = input.termsDays ?? 30;
  if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 180) {
    throw new InputError(`account ${input.agent} has terms nobody agreed to`);
  }
  const discount = input.discount ?? 0;
  if (!Number.isInteger(discount) || discount < 0 || discount > 5000) {
    throw new InputError(`account ${input.agent} has a discount that is not one`);
  }
  const creditLimit = assertCents(input.creditLimit ?? 0, 'credit limit');
  if (creditLimit < 0) {
    throw new InputError(`account ${input.agent} has a negative credit limit`);
  }
  return {
    agent: input.agent,
    name: input.name.trim(),
    termsDays,
    discount,
    creditLimit,
    stopped: input.stopped ?? false,
    requiresDeposit: input.requiresDeposit ?? false,
  };
}

/** The date an invoice raised on a day falls due. */
export function dueDate(account: Account, raisedAt: Minute): Minute {
  return raisedAt + account.termsDays * MINUTES_PER_DAY;
}

export type StandingReason = 'stopped' | 'over-limit' | 'clear';

export interface Standing {
  readonly reason: StandingReason;
  readonly balance: Cents;
  readonly headroom: Cents;
  readonly canOrder: boolean;
}

/** Where the account stands at a balance, which is what the order desk reads. */
export function standing(account: Account, balance: Cents): Standing {
  const headroom = account.creditLimit - balance;
  if (account.stopped) {
    return { reason: 'stopped', balance, headroom, canOrder: false };
  }
  if (account.creditLimit > 0 && balance > account.creditLimit) {
    return { reason: 'over-limit', balance, headroom, canOrder: false };
  }
  return { reason: 'clear', balance, headroom, canOrder: true };
}

/** Whether one more movement of this size would take the account over. */
export function wouldExceedLimit(account: Account, balance: Cents, charge: Cents): boolean {
  if (account.creditLimit === 0) {
    return false;
  }
  return balance + charge > account.creditLimit;
}

export function withStop(account: Account, stopped: boolean): Account {
  return { ...account, stopped };
}

export function withDiscount(account: Account, discount: number): Account {
  return makeAccount({ ...account, discount });
}

export function withLimit(account: Account, creditLimit: Cents): Account {
  return makeAccount({ ...account, creditLimit });
}

export function describeAccount(account: Account): string {
  const stopped = account.stopped ? ', on stop' : '';
  return (
    `${account.agent} ${account.name}, ${account.termsDays} day terms, ` +
    `${(account.discount / 100).toFixed(1)} percent${stopped}`
  );
}

/**
 * Payments, what they are set against, and how old the rest of it is.
 *
 * Agents pay in round sums against a statement rather than against invoices, so
 * the allocation is the district's job. The rule is oldest first, and a payment
 * that does not cover an invoice leaves it part paid rather than being held in
 * suspense, because the ageing report is read off the invoices and money
 * sitting in suspense is money nobody chases.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import { MINUTES_PER_DAY } from '../../util/clock';
import type { Cents } from '../../util/units';
import { assertCents } from '../../util/units';
import type { CreditNote } from './credit';
import { creditedTotal } from './credit';
import type { Invoice } from './invoice';
import { grossTotal, isOutstanding } from './invoice';

export interface Payment {
  readonly reference: string;
  readonly agent: string;
  readonly amount: Cents;
  readonly receivedAt: Minute;
}

export interface Allocation {
  readonly invoice: string;
  readonly amount: Cents;
}

export interface AllocationResult {
  readonly allocations: readonly Allocation[];
  /** Money left over after every open invoice was covered. */
  readonly unallocated: Cents;
}

export function makePayment(input: {
  reference: string;
  agent: string;
  amount: number;
  receivedAt: Minute;
}): Payment {
  if (input.reference.trim() === '') {
    throw new InputError('a payment needs a reference');
  }
  const amount = assertCents(input.amount, 'payment');
  if (amount <= 0) {
    throw new InputError('a payment is for a positive amount');
  }
  return {
    reference: input.reference.trim(),
    agent: input.agent,
    amount,
    receivedAt: input.receivedAt,
  };
}

/** What is still owed on one invoice, credits and payments taken off. */
export function outstandingOn(
  invoice: Invoice,
  credits: readonly CreditNote[],
  allocations: readonly Allocation[],
): Cents {
  const paid = allocations
    .filter((allocation) => allocation.invoice === invoice.number)
    .reduce((total, allocation) => total + allocation.amount, 0);
  return Math.max(0, grossTotal(invoice) - creditedTotal(credits, invoice.number) - paid);
}

/** Set a payment against the open invoices, oldest first. */
export function allocate(
  payment: Payment,
  invoices: readonly Invoice[],
  credits: readonly CreditNote[] = [],
  already: readonly Allocation[] = [],
): AllocationResult {
  const open = invoices
    .filter((invoice) => invoice.agent === payment.agent && isOutstanding(invoice))
    .sort((a, b) => a.raisedAt - b.raisedAt || a.number.localeCompare(b.number));
  const allocations: Allocation[] = [];
  let left = payment.amount;
  for (const invoice of open) {
    if (left <= 0) {
      break;
    }
    const owed = outstandingOn(invoice, credits, already);
    if (owed <= 0) {
      continue;
    }
    const amount = Math.min(owed, left);
    allocations.push({ invoice: invoice.number, amount });
    left -= amount;
  }
  return { allocations, unallocated: left };
}

/** Everything the agent owes across their open invoices. */
export function balanceFor(
  agent: string,
  invoices: readonly Invoice[],
  credits: readonly CreditNote[] = [],
  allocations: readonly Allocation[] = [],
): Cents {
  return invoices
    .filter((invoice) => invoice.agent === agent && isOutstanding(invoice))
    .reduce((total, invoice) => total + outstandingOn(invoice, credits, allocations), 0);
}

export interface AgeingBuckets {
  readonly current: Cents;
  readonly thirty: Cents;
  readonly sixty: Cents;
  readonly ninety: Cents;
  readonly older: Cents;
  readonly total: Cents;
}

const EMPTY: AgeingBuckets = {
  current: 0,
  thirty: 0,
  sixty: 0,
  ninety: 0,
  older: 0,
  total: 0,
};

/** The ageing report, bucketed by how far past due each invoice is. */
export function ageing(
  agent: string,
  invoices: readonly Invoice[],
  at: Minute,
  credits: readonly CreditNote[] = [],
  allocations: readonly Allocation[] = [],
): AgeingBuckets {
  let buckets = { ...EMPTY };
  for (const invoice of invoices) {
    if (invoice.agent !== agent || !isOutstanding(invoice)) {
      continue;
    }
    const owed = outstandingOn(invoice, credits, allocations);
    if (owed === 0) {
      continue;
    }
    const days = Math.floor((at - invoice.dueAt) / MINUTES_PER_DAY);
    if (days <= 0) {
      buckets = { ...buckets, current: buckets.current + owed };
    } else if (days <= 30) {
      buckets = { ...buckets, thirty: buckets.thirty + owed };
    } else if (days <= 60) {
      buckets = { ...buckets, sixty: buckets.sixty + owed };
    } else if (days <= 90) {
      buckets = { ...buckets, ninety: buckets.ninety + owed };
    } else {
      buckets = { ...buckets, older: buckets.older + owed };
    }
    buckets = { ...buckets, total: buckets.total + owed };
  }
  return buckets;
}

/** The oldest invoice still owing, which is what the chaser letter quotes. */
export function oldestOutstanding(
  agent: string,
  invoices: readonly Invoice[],
  credits: readonly CreditNote[] = [],
  allocations: readonly Allocation[] = [],
): Invoice | undefined {
  return invoices
    .filter(
      (invoice) =>
        invoice.agent === agent &&
        isOutstanding(invoice) &&
        outstandingOn(invoice, credits, allocations) > 0,
    )
    .sort((a, b) => a.raisedAt - b.raisedAt || a.number.localeCompare(b.number))[0];
}

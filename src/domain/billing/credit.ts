/**
 * Credit notes, and the reasons the district allows one.
 *
 * An issued invoice is never altered, so everything that would have altered it
 * becomes a credit note against it: a movement charged that never ran, a rate
 * applied that the agreement did not carry, detention the district itself
 * caused. Each reason has a code and each code has a rule about how much may be
 * credited, because a credit note for more than the invoice is how money leaves
 * a district quietly.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import type { Cents } from '../../util/units';
import { assertCents } from '../../util/units';
import { format, isReference, makeSeries, next } from '../../util/sequence';
import type { Invoice } from './invoice';
import { grossTotal, isOutstanding, totalForCode } from './invoice';

export type CreditReason =
  | 'movement-not-run'
  | 'rate-in-error'
  | 'detention-in-error'
  | 'goodwill'
  | 'duplicate';

export interface CreditNote {
  readonly number: string;
  readonly invoice: string;
  readonly agent: string;
  readonly reason: CreditReason;
  readonly amount: Cents;
  readonly raisedAt: Minute;
  readonly note: string;
}

export const CREDIT_SERIES = makeSeries('CRN', 5);

/** How much of an invoice each reason may take, in basis points. */
const CEILING: Record<CreditReason, number> = {
  'movement-not-run': 10000,
  'rate-in-error': 10000,
  'detention-in-error': 10000,
  goodwill: 2500,
  duplicate: 10000,
};

export function makeCreditNumber(year: number, sequence: number): string {
  return format(CREDIT_SERIES, year, sequence);
}

export function nextCreditNumber(year: number, issued: readonly string[]): string {
  return next(CREDIT_SERIES, year, issued);
}

export function ceilingFor(reason: CreditReason): number {
  return CEILING[reason];
}

export function raiseCredit(input: {
  number: string;
  invoice: Invoice;
  reason: CreditReason;
  amount: number;
  raisedAt: Minute;
  note: string;
  /** Credits already raised against the same invoice. */
  existing?: readonly CreditNote[];
}): CreditNote {
  if (!isReference(CREDIT_SERIES, input.number)) {
    throw new InputError(`not a CRN reference: ${JSON.stringify(input.number)}`);
  }
  const amount = assertCents(input.amount, 'credit amount');
  if (amount <= 0) {
    throw new InputError('a credit note is for a positive amount');
  }
  if (input.note.trim() === '') {
    throw new InputError('a credit note carries a reason in words as well as a code');
  }
  if (!isOutstanding(input.invoice)) {
    throw new InputError(`invoice ${input.invoice.number} is not open to a credit`, {
      status: input.invoice.status,
    });
  }
  const gross = grossTotal(input.invoice);
  const already = (input.existing ?? [])
    .filter((credit) => credit.invoice === input.invoice.number)
    .reduce((total, credit) => total + credit.amount, 0);
  if (already + amount > gross) {
    throw new InputError('the credits would come to more than the invoice', {
      invoice: input.invoice.number,
      gross,
      already,
    });
  }
  const ceiling = Math.round((gross * CEILING[input.reason]) / 10000);
  if (amount > ceiling) {
    throw new InputError(`a ${input.reason} credit cannot be more than the reason allows`, {
      ceiling,
      amount,
    });
  }
  if (input.reason === 'detention-in-error') {
    const detention = totalForCode(input.invoice, 'DETENTION');
    if (amount > detention) {
      throw new InputError('there is not that much detention on the invoice', {
        detention,
        amount,
      });
    }
  }
  return {
    number: input.number,
    invoice: input.invoice.number,
    agent: input.invoice.agent,
    reason: input.reason,
    amount,
    raisedAt: input.raisedAt,
    note: input.note.trim(),
  };
}

export function creditedTotal(credits: readonly CreditNote[], invoice: string): Cents {
  return credits
    .filter((credit) => credit.invoice === invoice)
    .reduce((total, credit) => total + credit.amount, 0);
}

/** What is left owing on an invoice once the credits are taken off. */
export function netOfCredits(invoice: Invoice, credits: readonly CreditNote[]): Cents {
  return grossTotal(invoice) - creditedTotal(credits, invoice.number);
}

export function fullyCredited(invoice: Invoice, credits: readonly CreditNote[]): boolean {
  return netOfCredits(invoice, credits) === 0;
}

export function creditsByReason(credits: readonly CreditNote[]): Record<string, Cents> {
  const totals: Record<string, Cents> = {};
  for (const credit of credits) {
    totals[credit.reason] = (totals[credit.reason] ?? 0) + credit.amount;
  }
  return totals;
}

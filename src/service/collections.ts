/**
 * Getting the money in.
 *
 * Issuing an invoice, taking a payment against it, raising a credit note when
 * something was charged that should not have been, and telling the district
 * what is owed and how old it is. The allocation rule lives in the domain; this
 * decides what gets written down and marks off the invoices a payment cleared.
 */

import { InputError } from '../util/errors';
import type { Minute } from '../util/clock';
import type { Cents } from '../util/units';
import type { CreditNote, CreditReason } from '../domain/billing/credit';
import { nextCreditNumber, raiseCredit } from '../domain/billing/credit';
import type { Invoice } from '../domain/billing/invoice';
import { grossTotal, moveTo } from '../domain/billing/invoice';
import type { AgeingBuckets, Allocation, Payment } from '../domain/billing/ledger';
import { ageing, allocate, balanceFor, makePayment, outstandingOn } from '../domain/billing/ledger';
import { standing } from '../domain/billing/account';
import type { Standing } from '../domain/billing/account';
import { requireAccount } from '../storage/fleet-store';
import {
  allocationsFor,
  creditsForAgent,
  disputesForAgent,
  disputesOnInvoice,
  findInvoice,
  invoicesForAgent,
  saveCredit,
  saveDispute,
  savePayment,
  setInvoiceStatus,
} from '../storage/billing-store';
import type { Dispute, DisputeOutcome } from '../domain/billing/dispute';
import { disputedOn, isOpen, raiseDispute, settle } from '../domain/billing/dispute';
import type { Context } from './context';
import { localYear } from './context';
import { note } from './audit';

export function issueInvoice(context: Context, number: string): Invoice {
  const invoice = findInvoice(context.db, number);
  if (invoice === undefined) {
    throw new InputError(`there is no invoice ${number}`);
  }
  const issued = moveTo(invoice, 'issued');
  setInvoiceStatus(context.db, number, 'issued');
  note(context, 'invoice-issued', number, { note: `to ${issued.agent}` });
  return issued;
}

export interface PaymentRequest {
  readonly reference: string;
  readonly agent: string;
  readonly amount: Cents;
  readonly receivedAt?: Minute;
}

export interface PaymentResult {
  readonly payment: Payment;
  readonly allocations: readonly Allocation[];
  readonly unallocated: Cents;
  readonly cleared: readonly string[];
}

/** Take a payment, set it against the oldest invoices and close what it cleared. */
export function takePayment(context: Context, request: PaymentRequest): PaymentResult {
  requireAccount(context.db, request.agent);
  const payment = makePayment({
    reference: request.reference,
    agent: request.agent,
    amount: request.amount,
    receivedAt: request.receivedAt ?? context.now(),
  });
  const invoices = invoicesForAgent(context.db, request.agent);
  const credits = creditsForAgent(context.db, request.agent);
  const already = allocationsFor(context.db, request.agent);
  const result = allocate(payment, invoices, credits, already);
  if (result.allocations.length === 0) {
    throw new InputError(`${request.agent} has nothing outstanding to set this payment against`);
  }
  savePayment(context.db, payment, result.allocations);
  note(context, 'payment-taken', payment.reference, {
    note: `from ${payment.agent}`,
    detail: { amount: payment.amount },
  });
  const cleared: string[] = [];
  const afterwards = [...already, ...result.allocations];
  for (const allocation of result.allocations) {
    const invoice = invoices.find((each) => each.number === allocation.invoice);
    if (invoice === undefined) {
      continue;
    }
    if (outstandingOn(invoice, credits, afterwards) === 0) {
      setInvoiceStatus(context.db, invoice.number, 'paid');
      cleared.push(invoice.number);
    }
  }
  return {
    payment,
    allocations: result.allocations,
    unallocated: result.unallocated,
    cleared,
  };
}

export interface CreditRequest {
  readonly invoice: string;
  readonly reason: CreditReason;
  readonly amount: Cents;
  readonly note: string;
  readonly raisedAt?: Minute;
}

export function creditInvoice(context: Context, request: CreditRequest): CreditNote {
  const invoice = findInvoice(context.db, request.invoice);
  if (invoice === undefined) {
    throw new InputError(`there is no invoice ${request.invoice}`);
  }
  const raisedAt = request.raisedAt ?? context.now();
  const year = localYear(context, raisedAt);
  const existing = creditsForAgent(context.db, invoice.agent);
  const credit = raiseCredit({
    number: nextCreditNumber(
      year,
      existing.map((each) => each.number),
    ),
    invoice,
    reason: request.reason,
    amount: request.amount,
    raisedAt,
    note: request.note,
    existing,
  });
  saveCredit(context.db, credit);
  note(context, 'invoice-credited', invoice.number, {
    note: request.note,
    detail: { amount: credit.amount, reason: credit.reason },
  });
  const allocations = allocationsFor(context.db, invoice.agent);
  if (outstandingOn(invoice, [...existing, credit], allocations) === 0) {
    setInvoiceStatus(context.db, invoice.number, 'paid');
  }
  return credit;
}

export interface DisputeRequest {
  readonly invoice: string;
  readonly ground: string;
  readonly amount: Cents;
  readonly note: string;
  readonly raisedAt?: Minute;
}

/** Record what the agent says is wrong, and stop chasing that much of it. */
export function disputeInvoice(context: Context, request: DisputeRequest): Dispute {
  const invoice = findInvoice(context.db, request.invoice);
  if (invoice === undefined) {
    throw new InputError(`there is no invoice ${request.invoice}`);
  }
  const dispute = raiseDispute({
    invoice: invoice.number,
    agent: invoice.agent,
    ground: request.ground,
    amount: request.amount,
    raisedAt: request.raisedAt ?? context.now(),
    note: request.note,
  });
  saveDispute(context.db, dispute);
  setInvoiceStatus(context.db, invoice.number, 'disputed');
  return dispute;
}

/** Answer one, which puts the invoice back on the chasing list. */
export function settleDispute(
  context: Context,
  invoice: string,
  outcome: Exclude<DisputeOutcome, 'open'>,
  answer: string,
): Dispute {
  const open = disputesOnInvoice(context.db, invoice).find(isOpen);
  if (open === undefined) {
    throw new InputError(`there is no open dispute on ${invoice}`);
  }
  const settled = settle(open, outcome, context.now(), answer);
  saveDispute(context.db, settled);
  const held = findInvoice(context.db, invoice);
  if (held !== undefined && held.status === 'disputed') {
    setInvoiceStatus(context.db, invoice, 'issued');
  }
  return settled;
}

export interface AgentStatement {
  readonly agent: string;
  readonly balance: Cents;
  /** What is under dispute, which the chasing leaves alone. */
  readonly disputed: Cents;
  readonly ageing: AgeingBuckets;
  readonly standing: Standing;
  readonly open: readonly { invoice: string; raisedAt: Minute; owed: Cents }[];
}

/** What one agent owes, in the shape the statement is printed from. */
export function statementFor(context: Context, agent: string, at?: Minute): AgentStatement {
  const account = requireAccount(context.db, agent);
  const when = at ?? context.now();
  const invoices = invoicesForAgent(context.db, agent);
  const credits = creditsForAgent(context.db, agent);
  const allocations = allocationsFor(context.db, agent);
  const balance = balanceFor(agent, invoices, credits, allocations);
  const disputes = disputesForAgent(context.db, agent);
  return {
    agent,
    balance,
    disputed: invoices.reduce((total, invoice) => total + disputedOn(disputes, invoice.number), 0),
    ageing: ageing(agent, invoices, when, credits, allocations),
    standing: standing(account, balance),
    open: invoices
      .filter((invoice) => outstandingOn(invoice, credits, allocations) > 0)
      .map((invoice) => ({
        invoice: invoice.number,
        raisedAt: invoice.raisedAt,
        owed: outstandingOn(invoice, credits, allocations),
      })),
  };
}

/** Every agent with something owing, worst first. */
export function debtors(
  context: Context,
  agents: readonly string[],
  at?: Minute,
): AgentStatement[] {
  return agents
    .map((agent) => statementFor(context, agent, at))
    .filter((statement) => statement.balance > 0)
    .sort((a, b) => b.balance - a.balance || a.agent.localeCompare(b.agent));
}

export function invoiceTotal(invoice: Invoice): Cents {
  return grossTotal(invoice);
}

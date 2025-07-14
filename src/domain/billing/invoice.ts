/**
 * The invoice: the assessment turned into a document with a number on it.
 *
 * An invoice is raised against one agent and carries the lines of one or more
 * movements. Once issued it is never edited: a mistake is put right with a
 * credit note, because the numbers have gone to the agent's accounts department
 * and to the district's auditors and both of them expect the sequence to be
 * complete and unaltered.
 */

import { InputError, TransitionError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import { localDate } from '../../util/clock';
import type { Cents } from '../../util/units';
import { applyBps, assertCents } from '../../util/units';
import { format, isReference, makeSeries, next } from '../../util/sequence';
import type { ChargeLine } from '../tariff/charge';
import { totalOf } from '../tariff/charge';

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'disputed' | 'written-off';

export interface InvoiceItem {
  readonly movement: string;
  readonly lines: readonly ChargeLine[];
}

export interface Invoice {
  readonly number: string;
  readonly agent: string;
  readonly status: InvoiceStatus;
  readonly raisedAt: Minute;
  readonly dueAt: Minute;
  readonly currency: string;
  readonly items: readonly InvoiceItem[];
  /** Tax rate applied to the whole invoice, in basis points. */
  readonly taxRate: number;
}

export const INVOICE_SERIES = makeSeries('INV', 5);

export function makeInvoiceNumber(year: number, sequence: number): string {
  return format(INVOICE_SERIES, year, sequence);
}

export function nextInvoiceNumber(year: number, issued: readonly string[]): string {
  return next(INVOICE_SERIES, year, issued);
}

export function makeInvoice(input: {
  number: string;
  agent: string;
  raisedAt: Minute;
  dueAt: Minute;
  items: readonly InvoiceItem[];
  currency?: string;
  taxRate?: number;
  status?: InvoiceStatus;
}): Invoice {
  if (!isReference(INVOICE_SERIES, input.number)) {
    throw new InputError(`not an INV reference: ${JSON.stringify(input.number)}`);
  }
  if (input.items.length === 0) {
    throw new InputError(`invoice ${input.number} has nothing on it`);
  }
  if (input.dueAt < input.raisedAt) {
    throw new InputError(`invoice ${input.number} falls due before it was raised`);
  }
  const taxRate = input.taxRate ?? 0;
  if (!Number.isInteger(taxRate) || taxRate < 0 || taxRate > 5000) {
    throw new InputError(`invoice ${input.number} has a tax rate that is not one`);
  }
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.movement)) {
      throw new InputError(`invoice ${input.number} carries movement ${item.movement} twice`);
    }
    seen.add(item.movement);
    if (item.lines.length === 0) {
      throw new InputError(`movement ${item.movement} has no lines on the invoice`);
    }
    for (const line of item.lines) {
      assertCents(line.amount, `line ${line.code}`);
    }
  }
  return {
    number: input.number,
    agent: input.agent,
    status: input.status ?? 'draft',
    raisedAt: input.raisedAt,
    dueAt: input.dueAt,
    currency: input.currency ?? 'USD',
    items: [...input.items],
    taxRate,
  };
}

export function netTotal(invoice: Invoice): Cents {
  return invoice.items.reduce((total, item) => total + totalOf(item.lines), 0);
}

export function taxTotal(invoice: Invoice): Cents {
  return applyBps(netTotal(invoice), invoice.taxRate);
}

export function grossTotal(invoice: Invoice): Cents {
  return netTotal(invoice) + taxTotal(invoice);
}

/** Every line on the invoice, movement by movement. */
export function allLines(invoice: Invoice): ChargeLine[] {
  return invoice.items.flatMap((item) => item.lines);
}

/** Total for one charge code across the invoice, which the return needs. */
export function totalForCode(invoice: Invoice, code: string): Cents {
  return allLines(invoice)
    .filter((line) => line.code === code)
    .reduce((total, line) => total + line.amount, 0);
}

const ALLOWED: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['issued'],
  issued: ['paid', 'disputed', 'written-off'],
  disputed: ['issued', 'paid', 'written-off'],
  paid: [],
  'written-off': [],
};

export function moveTo(invoice: Invoice, status: InvoiceStatus): Invoice {
  if (!ALLOWED[invoice.status].includes(status)) {
    throw new TransitionError(invoice.status, status, 'an invoice does not go that way');
  }
  return { ...invoice, status };
}

export function isOutstanding(invoice: Invoice): boolean {
  return invoice.status === 'issued' || invoice.status === 'disputed';
}

export function isOverdue(invoice: Invoice, at: Minute): boolean {
  return isOutstanding(invoice) && at > invoice.dueAt;
}

export function daysOverdue(invoice: Invoice, at: Minute): number {
  if (!isOverdue(invoice, at)) {
    return 0;
  }
  return Math.floor((at - invoice.dueAt) / 1440);
}

export function describeInvoice(invoice: Invoice, offset: number): string {
  return (
    `${invoice.number} ${invoice.agent} ${localDate(invoice.raisedAt, offset)} ` +
    `${invoice.items.length} movements ${grossTotal(invoice)} ${invoice.currency} (${invoice.status})`
  );
}

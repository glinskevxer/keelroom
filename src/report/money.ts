/**
 * Invoices, statements and the ageing report.
 *
 * These are the pages that leave the building, so they are the ones where the
 * arithmetic has to be visible: every line, the tax on its own row, and a total
 * that adds up on the page rather than only in the database.
 */

import type { Minute, Offset } from '../util/clock';
import { localDate } from '../util/clock';
import { formatMoney } from '../util/units';
import type { Cents } from '../util/units';
import { renderPairs, renderTable } from '../util/table';
import type { Invoice } from '../domain/billing/invoice';
import { daysOverdue, grossTotal, netTotal, taxTotal } from '../domain/billing/invoice';
import type { AgeingBuckets } from '../domain/billing/ledger';
import type { AgentStatement } from '../service/collections';

export interface MoneyOptions {
  readonly offset: Offset;
  readonly title?: string;
}

export function renderInvoice(invoice: Invoice, options: MoneyOptions): string {
  const rows: string[][] = [];
  for (const item of invoice.items) {
    for (const line of item.lines) {
      rows.push([
        item.movement,
        line.code,
        line.description,
        formatMoney(line.amount, { grouped: true }),
      ]);
    }
  }
  const head = renderPairs([
    ['invoice', invoice.number],
    ['agent', invoice.agent],
    ['raised', localDate(invoice.raisedAt, options.offset)],
    ['due', localDate(invoice.dueAt, options.offset)],
    ['status', invoice.status],
  ]);
  const table = renderTable(
    [
      { heading: 'movement' },
      { heading: 'code' },
      { heading: 'description' },
      { heading: 'amount', align: 'right' },
    ],
    rows,
    { empty: 'no lines' },
  );
  const totals = renderPairs([
    ['net', formatMoney(netTotal(invoice), { grouped: true })],
    ['tax', formatMoney(taxTotal(invoice), { grouped: true })],
    ['total', `${formatMoney(grossTotal(invoice), { grouped: true })} ${invoice.currency}`],
  ]);
  return [head, '', table, '', totals].join('\n');
}

export function renderAgeing(buckets: AgeingBuckets): string {
  return renderTable(
    [
      { heading: 'current', align: 'right' },
      { heading: '1 to 30', align: 'right' },
      { heading: '31 to 60', align: 'right' },
      { heading: '61 to 90', align: 'right' },
      { heading: 'over 90', align: 'right' },
      { heading: 'total', align: 'right' },
    ],
    [
      [
        formatMoney(buckets.current, { grouped: true }),
        formatMoney(buckets.thirty, { grouped: true }),
        formatMoney(buckets.sixty, { grouped: true }),
        formatMoney(buckets.ninety, { grouped: true }),
        formatMoney(buckets.older, { grouped: true }),
        formatMoney(buckets.total, { grouped: true }),
      ],
    ],
    { title: 'ageing' },
  );
}

export function renderStatement(statement: AgentStatement, options: MoneyOptions): string {
  const rows = statement.open.map((line) => [
    line.invoice,
    localDate(line.raisedAt, options.offset),
    formatMoney(line.owed, { grouped: true }),
  ]);
  const head = renderPairs([
    ['agent', statement.agent],
    ['balance', formatMoney(statement.balance, { grouped: true })],
    ['standing', statement.standing.reason],
    ['may order', statement.standing.canOrder ? 'yes' : 'no'],
  ]);
  const table = renderTable(
    [{ heading: 'invoice' }, { heading: 'raised' }, { heading: 'owed', align: 'right' }],
    rows,
    { title: 'open invoices', empty: 'nothing outstanding' },
  );
  return [head, '', table, '', renderAgeing(statement.ageing)].join('\n');
}

export interface OverdueLine {
  readonly invoice: string;
  readonly agent: string;
  readonly days: number;
  readonly owed: Cents;
}

export function overdueLines(invoices: readonly Invoice[], at: Minute): OverdueLine[] {
  return invoices
    .filter((invoice) => daysOverdue(invoice, at) > 0)
    .map((invoice) => ({
      invoice: invoice.number,
      agent: invoice.agent,
      days: daysOverdue(invoice, at),
      owed: grossTotal(invoice),
    }))
    .sort((a, b) => b.days - a.days || a.invoice.localeCompare(b.invoice));
}

export function renderOverdue(invoices: readonly Invoice[], at: Minute): string {
  const rows = overdueLines(invoices, at).map((line) => [
    line.invoice,
    line.agent,
    String(line.days),
    formatMoney(line.owed, { grouped: true }),
  ]);
  return renderTable(
    [
      { heading: 'invoice' },
      { heading: 'agent' },
      { heading: 'days', align: 'right' },
      { heading: 'owed', align: 'right' },
    ],
    rows,
    { title: 'overdue', empty: 'nothing overdue' },
  );
}

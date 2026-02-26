/**
 * Getting the records out again.
 *
 * The port authority wants a movement return every month, the accountants want
 * the invoice lines, and the pilots' association wants the duty hours. All three
 * arrive as csv because all three are read into a spreadsheet at the other end,
 * and all three are built from the same records rather than from three separate
 * queries somebody wrote in a hurry.
 */

import type { Interval } from '../util/interval';
import { writeCsv } from '../util/csv';
import { formatInstant, formatLocal, localDate } from '../util/clock';
import { formatMetres, formatMoney } from '../util/units';
import { pilotOnBoardMinutes, waitingMinutes } from '../domain/movement/times';
import { grossTotal, netTotal, taxTotal } from '../domain/billing/invoice';
import { findTimes, movementsInWindow } from '../storage/movement-store';
import { invoicesRaisedIn } from '../storage/billing-store';
import { allDuty } from '../storage/roster-store';
import { findVessel } from '../storage/fleet-store';
import type { Context } from './context';

export interface Export {
  readonly name: string;
  readonly rows: number;
  readonly csv: string;
}

/** The movement return: one row per movement, with the times as they happened. */
export function movementExport(context: Context, period: Interval): Export {
  const offset = context.district.offset;
  const movements = movementsInWindow(context.db, period.from, period.to);
  const rows = movements.map((movement) => {
    const times = findTimes(context.db, movement.reference);
    const vessel = findVessel(context.db, movement.vessel);
    return [
      movement.reference,
      movement.kind,
      movement.status,
      movement.vessel,
      vessel?.name ?? '',
      movement.agent,
      movement.from,
      movement.to,
      formatMetres(movement.draught),
      formatInstant(movement.requestedFor),
      movement.plannedFor === undefined ? '' : formatInstant(movement.plannedFor),
      times?.boarded === undefined ? '' : formatInstant(times.boarded),
      times?.allFast === undefined ? '' : formatInstant(times.allFast),
      movement.pilot ?? '',
      String(movement.tugs),
      localDate(movement.plannedFor ?? movement.requestedFor, offset),
    ];
  });
  return {
    name: 'movements',
    rows: rows.length,
    csv: writeCsv(
      [
        'reference',
        'kind',
        'status',
        'imo',
        'vessel',
        'agent',
        'from',
        'to',
        'draught_m',
        'requested_for',
        'planned_for',
        'boarded',
        'all_fast',
        'pilot',
        'tugs',
        'local_date',
      ],
      rows,
    ),
  };
}

/** The invoice return: one row per line, so the totals can be rebuilt. */
export function invoiceExport(context: Context, period: Interval): Export {
  const rows: string[][] = [];
  for (const invoice of invoicesRaisedIn(context.db, period.from, period.to)) {
    for (const item of invoice.items) {
      for (const line of item.lines) {
        rows.push([
          invoice.number,
          invoice.agent,
          invoice.status,
          formatInstant(invoice.raisedAt),
          item.movement,
          line.code,
          line.description,
          formatMoney(line.amount),
          formatMoney(netTotal(invoice)),
          formatMoney(taxTotal(invoice)),
          formatMoney(grossTotal(invoice)),
        ]);
      }
    }
  }
  return {
    name: 'invoices',
    rows: rows.length,
    csv: writeCsv(
      [
        'invoice',
        'agent',
        'status',
        'raised_at',
        'movement',
        'code',
        'description',
        'amount',
        'invoice_net',
        'invoice_tax',
        'invoice_gross',
      ],
      rows,
    ),
  };
}

/** The duty return the association reads, in local time because they do. */
export function dutyExport(context: Context, period: Interval): Export {
  const offset = context.district.offset;
  const rows = allDuty(context.db, period.from)
    .filter((entry) => entry.period.from <= period.to)
    .map((entry) => {
      const times = findTimes(context.db, entry.movement);
      return [
        entry.pilot,
        entry.movement,
        formatLocal(entry.period.from, offset),
        formatLocal(entry.period.to, offset),
        String(entry.period.to - entry.period.from),
        times === undefined ? '' : String(pilotOnBoardMinutes(times)),
        times === undefined ? '' : String(waitingMinutes(times)),
      ];
    });
  return {
    name: 'duty',
    rows: rows.length,
    csv: writeCsv(
      ['pilot', 'movement', 'from_local', 'to_local', 'minutes', 'on_board', 'waiting'],
      rows,
    ),
  };
}

export type ExportName = 'movements' | 'invoices' | 'duty';

export function buildExport(context: Context, name: ExportName, period: Interval): Export {
  switch (name) {
    case 'movements':
      return movementExport(context, period);
    case 'invoices':
      return invoiceExport(context, period);
    case 'duty':
      return dutyExport(context, period);
  }
}

export function exportNames(): readonly ExportName[] {
  return ['movements', 'invoices', 'duty'];
}

/**
 * The order book: what is expected, when, and what state it is in.
 *
 * This is the sheet the despatcher works from, so it is ordered by the time the
 * ship is expected rather than by when the order came in, and it shows the
 * planned time where there is one and the requested time where there is not,
 * with a mark to say which it is showing.
 */

import type { Minute } from '../util/clock';
import { formatLocal, localTime } from '../util/clock';
import { formatMetres } from '../util/units';
import { renderTable } from '../util/table';
import type { Column } from '../util/table';
import type { Movement } from '../domain/movement/movement';
import { statusRank } from '../domain/movement/lifecycle';

export interface OrderLine {
  readonly reference: string;
  readonly when: Minute;
  readonly planned: boolean;
  readonly kind: string;
  readonly vessel: string;
  readonly route: string;
  readonly draught: number;
  readonly status: string;
  readonly pilot: string;
}

export function orderLines(movements: readonly Movement[]): OrderLine[] {
  return [...movements]
    .map((movement) => ({
      reference: movement.reference,
      when: movement.plannedFor ?? movement.requestedFor,
      planned: movement.plannedFor !== undefined,
      kind: movement.kind,
      vessel: movement.vessel,
      route: `${movement.from} to ${movement.to}`,
      draught: movement.draught,
      status: movement.status,
      pilot: movement.pilot ?? '',
    }))
    .sort(
      (a, b) =>
        a.when - b.when ||
        statusRank(a.status as never) - statusRank(b.status as never) ||
        a.reference.localeCompare(b.reference),
    );
}

const COLUMNS: Column[] = [
  { heading: 'time' },
  { heading: 'reference' },
  { heading: 'vessel' },
  { heading: 'kind' },
  { heading: 'route' },
  { heading: 'draught', align: 'right' },
  { heading: 'status' },
  { heading: 'pilot' },
];

export interface OrderReportOptions {
  readonly offset: number;
  readonly title?: string;
  /** Show the full date rather than the time alone. */
  readonly withDate?: boolean;
  readonly names?: Readonly<Record<string, string>>;
}

export function renderOrders(movements: readonly Movement[], options: OrderReportOptions): string {
  const rows = orderLines(movements).map((line) => [
    (options.withDate === true
      ? formatLocal(line.when, options.offset)
      : localTime(line.when, options.offset)) + (line.planned ? '' : '?'),
    line.reference,
    options.names?.[line.vessel] ?? line.vessel,
    line.kind,
    line.route,
    formatMetres(line.draught),
    line.status,
    line.pilot,
  ]);
  return renderTable(COLUMNS, rows, {
    ...(options.title === undefined ? {} : { title: options.title }),
    empty: 'nothing on the book',
  });
}

/** Everything still to happen, which is the shortest useful view. */
export function outstanding(movements: readonly Movement[]): Movement[] {
  return movements.filter(
    (movement) =>
      movement.status === 'ordered' ||
      movement.status === 'confirmed' ||
      movement.status === 'assigned',
  );
}

export function running(movements: readonly Movement[]): Movement[] {
  return movements.filter(
    (movement) => movement.status === 'boarded' || movement.status === 'underway',
  );
}

/** Movements with no planned time yet, which is the despatcher's work list. */
export function unplanned(movements: readonly Movement[]): Movement[] {
  return movements.filter(
    (movement) => movement.status === 'ordered' && movement.plannedFor === undefined,
  );
}

export interface OrderCounts {
  readonly ordered: number;
  readonly confirmed: number;
  readonly assigned: number;
  readonly running: number;
  readonly closed: number;
}

export function countByState(movements: readonly Movement[]): OrderCounts {
  const counts = { ordered: 0, confirmed: 0, assigned: 0, running: 0, closed: 0 };
  for (const movement of movements) {
    switch (movement.status) {
      case 'ordered':
        counts.ordered += 1;
        break;
      case 'confirmed':
        counts.confirmed += 1;
        break;
      case 'assigned':
        counts.assigned += 1;
        break;
      case 'boarded':
      case 'underway':
        counts.running += 1;
        break;
      default:
        counts.closed += 1;
    }
  }
  return counts;
}

export function renderCounts(counts: OrderCounts): string {
  return (
    `${counts.ordered} ordered, ${counts.confirmed} confirmed, ${counts.assigned} assigned, ` +
    `${counts.running} running, ${counts.closed} closed`
  );
}

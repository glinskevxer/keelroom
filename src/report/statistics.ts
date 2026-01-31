/**
 * The return, printed.
 */

import type { Offset } from '../util/clock';
import { formatDuration, localDate } from '../util/clock';
import { formatMoney } from '../util/units';
import { renderPairs, renderTable } from '../util/table';
import { averageLateness, cancellationRate, punctuality } from '../domain/statistics/summary';
import type { DistrictReturn } from '../service/statistics';

export interface ReturnOptions {
  readonly offset: Offset;
  readonly title?: string;
}

export function renderReturn(result: DistrictReturn, options: ReturnOptions): string {
  const summary = result.summary;
  const head = renderPairs([
    [
      'period',
      `${localDate(summary.period.from, options.offset)} to ${localDate(summary.period.to, options.offset)}`,
    ],
    ['movements', String(summary.ordered)],
    ['completed', String(summary.completed)],
    ['cancelled', `${summary.cancelled} (${cancellationRate(summary)} percent)`],
    ['refused', String(summary.refused)],
    ['on time', `${summary.onTime} of ${summary.completed} (${punctuality(summary)} percent)`],
    ['average lateness', formatDuration(averageLateness(summary))],
    ['pilot hours', String(summary.pilotHours)],
    ['waiting hours', String(result.waitingHours)],
    ['charged', formatMoney(summary.charged, { grouped: true })],
  ]);
  const delays = renderTable(
    [{ heading: 'cause' }, { heading: 'minutes', align: 'right' }],
    Object.entries(summary.delaysByCause)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([cause, minutes]) => [cause, String(minutes)]),
    { title: 'delay', empty: 'no delays recorded' },
  );
  const pilots = renderTable(
    [
      { heading: 'pilot' },
      { heading: 'jobs', align: 'right' },
      { heading: 'on board', align: 'right' },
    ],
    result.pilots.map((pilot) => [pilot.pilot, String(pilot.jobs), formatDuration(pilot.minutes)]),
    { title: 'pilots', empty: 'no jobs taken' },
  );
  const agents = renderTable(
    [
      { heading: 'agent' },
      { heading: 'movements', align: 'right' },
      { heading: 'charged', align: 'right' },
    ],
    result.agents.map((agent) => [
      agent.agent,
      String(agent.movements),
      formatMoney(agent.charged, { grouped: true }),
    ]),
    { title: 'agents', empty: 'no agents' },
  );
  return [options.title ?? 'district return', '', head, '', delays, '', pilots, '', agents].join(
    '\n',
  );
}

/** The one line a weekly email carries. */
export function returnHeadline(result: DistrictReturn): string {
  const summary = result.summary;
  return (
    `${summary.completed} of ${summary.ordered} movements ran, ` +
    `${punctuality(summary)} percent on time, ${formatMoney(summary.charged, { grouped: true })} charged`
  );
}

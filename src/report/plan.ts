/**
 * Explaining a plan.
 *
 * A window on its own tells the despatcher nothing about why it is that shape.
 * This turns the sweep into the paragraph the pilots argue with: which reach
 * asked for the most water, what she needs and what she has, whether the bridge
 * or the bar is the binding constraint, and what would have to change for the
 * answer to change.
 */

import type { Offset } from '../util/clock';
import { formatDuration, localTime } from '../util/clock';
import { duration } from '../util/interval';
import { formatMetres } from '../util/units';
import { bullet, renderPairs, renderTable } from '../util/table';
import { describeFinding, sortFindings } from '../util/finding';
import type { PlanResult } from '../domain/window/plan';
import { blockingRules, windowMinutes } from '../domain/window/plan';
import { controllingReach } from '../domain/window/sweep';
import { tightestOverhead } from '../domain/window/overhead';

export interface PlanReportOptions {
  readonly offset: Offset;
  readonly title?: string;
}

export function renderWindows(result: PlanResult, options: PlanReportOptions): string {
  const rows = result.windows.map((window, index) => [
    String(index + 1),
    localTime(window.from, options.offset),
    localTime(window.to, options.offset),
    formatDuration(duration(window)),
  ]);
  return renderTable(
    [
      { heading: '#', align: 'right' },
      { heading: 'from' },
      { heading: 'to' },
      { heading: 'open for', align: 'right' },
    ],
    rows,
    {
      title: options.title ?? 'windows',
      empty: 'no window in the range',
    },
  );
}

export function renderReachDemands(result: PlanResult): string {
  const rows = result.depth.reaches.map((reach) => [
    reach.reach,
    reach.leastTide === undefined ? 'no tide will do' : formatMetres(reach.leastTide),
    String(reach.starts.length),
  ]);
  return renderTable(
    [
      { heading: 'reach' },
      { heading: 'tide needed', align: 'right' },
      { heading: 'windows', align: 'right' },
    ],
    rows,
    { title: 'what each reach asks for', empty: 'no reaches on the passage' },
  );
}

/** The two or three lines a despatcher reads before anything else. */
export function summarise(result: PlanResult, options: PlanReportOptions): string {
  const controlling = controllingReach(result.depth);
  const tightest = tightestOverhead(result.air);
  const pairs: [string, string][] = [
    ['windows', String(result.windows.length)],
    ['open for', formatDuration(windowMinutes(result))],
    [
      'controlling reach',
      controlling === undefined
        ? 'none'
        : `${controlling.reach} (${
            controlling.leastTide === undefined
              ? 'no tide will do'
              : `${formatMetres(controlling.leastTide)} m of tide`
          })`,
    ],
  ];
  if (tightest !== undefined) {
    pairs.push([
      'tightest overhead',
      `${tightest.overhead} (under ${formatMetres(tightest.highestTide)} m of tide)`,
    ]);
  }
  pairs.push(['daylight only', result.restrictions.daylightOnly ? 'yes' : 'no']);
  pairs.push(['tugs', String(result.restrictions.tugs)]);
  if (result.windows.length > 0) {
    const first = result.windows[0]!;
    pairs.push([
      'first window',
      `${localTime(first.from, options.offset)} to ${localTime(first.to, options.offset)}`,
    ]);
  }
  return renderPairs(pairs);
}

export function renderFindings(result: PlanResult): string {
  const findings = sortFindings(result.findings);
  if (findings.length === 0) {
    return 'nothing to report';
  }
  return bullet(findings.map(describeFinding));
}

/** Everything, in the order it is read. */
export function renderPlan(result: PlanResult, options: PlanReportOptions): string {
  return [
    summarise(result, options),
    '',
    renderWindows(result, options),
    '',
    renderReachDemands(result),
    '',
    renderFindings(result),
  ].join('\n');
}

/** One line for a list of movements rather than the full report. */
export function planHeadline(result: PlanResult, options: PlanReportOptions): string {
  if (result.windows.length === 0) {
    const rules = blockingRules(result);
    return `no window (${rules.length === 0 ? 'no reason recorded' : rules.join(', ')})`;
  }
  const first = result.windows[0]!;
  return (
    `${result.windows.length} window${result.windows.length === 1 ? '' : 's'}, ` +
    `first ${localTime(first.from, options.offset)} for ${formatDuration(duration(first))}`
  );
}

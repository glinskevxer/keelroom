/**
 * Tide tables and curves, printed the way the pilots read them.
 *
 * A tide table is high and low water with the height beside it. The curve is
 * for the days when the table is not enough: a deep ship on a neap needs to see
 * where the water is at ten past six, not just that high water is at seven.
 */

import type { Minute, Offset } from '../util/clock';
import { localDate, localTime, MINUTES_PER_DAY, startOfLocalDay } from '../util/clock';
import type { Interval } from '../util/interval';
import { renderTable } from '../util/table';
import { formatMetres } from '../util/units';
import type { Extreme } from '../domain/tide/extremes';
import { findExtremes, rangeAround } from '../domain/tide/extremes';
import { predictSeries } from '../domain/tide/predict';
import type { TideStation } from '../domain/tide/station';
import { describeStation, springRange, tideForm } from '../domain/tide/station';

export interface TideTableOptions {
  readonly offset: Offset;
  readonly title?: string;
}

export function renderTideTable(
  station: TideStation,
  bounds: Interval,
  options: TideTableOptions,
): string {
  const extremes = findExtremes(station, bounds.from, bounds.to);
  const rows = extremes.map((extreme, index) => [
    localDate(extreme.minute, options.offset),
    localTime(extreme.minute, options.offset),
    extreme.kind === 'high' ? 'HW' : 'LW',
    formatMetres(extreme.height),
    rangeAround(extremes, index) === undefined
      ? ''
      : formatMetres(rangeAround(extremes, index) ?? 0),
  ]);
  return renderTable(
    [
      { heading: 'date' },
      { heading: 'time' },
      { heading: 'tide' },
      { heading: 'height', align: 'right' },
      { heading: 'range', align: 'right' },
    ],
    rows,
    {
      title: options.title ?? `${station.id} ${station.name}`,
      empty: 'no turns of the tide in that range',
    },
  );
}

export function renderCurve(
  station: TideStation,
  bounds: Interval,
  options: TideTableOptions & { stepMinutes?: number },
): string {
  const step = options.stepMinutes ?? 30;
  const samples = predictSeries(station, bounds.from, bounds.to, step);
  const rows = samples.map((sample) => [
    localTime(sample.minute, options.offset),
    formatMetres(sample.height),
    bar(sample.height),
  ]);
  return renderTable(
    [{ heading: 'time' }, { heading: 'height', align: 'right' }, { heading: 'curve' }],
    rows,
    { title: options.title ?? `${station.id} curve`, empty: 'nothing to plot' },
  );
}

/** A crude bar so the shape of the tide is visible on a text terminal. */
export function bar(height: number, perMark = 20): string {
  const marks = Math.max(0, Math.round(height / perMark));
  return '#'.repeat(Math.min(marks, 40));
}

/** The one line summary the daily sheet carries above the table. */
export function describeTideDay(station: TideStation, day: Minute, offset: Offset): string {
  const start = startOfLocalDay(day, offset);
  const extremes = findExtremes(station, start, start + MINUTES_PER_DAY);
  const highs = extremes.filter((extreme) => extreme.kind === 'high');
  const tallest = highs.reduce<Extreme | undefined>(
    (best, extreme) => (best === undefined || extreme.height > best.height ? extreme : best),
    undefined,
  );
  if (tallest === undefined) {
    return `${localDate(start, offset)} no high water at ${station.id}`;
  }
  return (
    `${localDate(start, offset)} ${station.id} best water ${formatMetres(tallest.height)} m ` +
    `at ${localTime(tallest.minute, offset)}`
  );
}

export function renderStationSummary(station: TideStation): string {
  return `${describeStation(station)}, ${tideForm(station)}, springs ${formatMetres(springRange(station))} m`;
}

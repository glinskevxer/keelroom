/**
 * The berth diary, derived rather than kept.
 */

import type { Minute } from '../util/clock';
import { MINUTES_PER_DAY } from '../util/clock';
import type { Interval } from '../util/interval';
import { makeInterval } from '../util/interval';
import type { Cm } from '../util/units';
import type { BerthCandidate, BerthConflict, Stay } from '../domain/berth/stay';
import { berthConflicts, candidates, openStays, staysFrom } from '../domain/berth/stay';
import { predictHeight } from '../domain/tide/predict';
import { requireStation } from '../domain/chart/district';
import { requireVessel } from '../storage/fleet-store';
import { movementsInWindow } from '../storage/movement-store';
import type { Context } from './context';

export interface BerthDiary {
  readonly period: Interval;
  readonly stays: readonly Stay[];
  readonly conflicts: readonly BerthConflict[];
  readonly open: readonly Stay[];
}

/** Everything alongside over a period, with anything double booked called out. */
export function diaryFor(context: Context, period: Interval): BerthDiary {
  const movements = movementsInWindow(context.db, period.from - 30 * MINUTES_PER_DAY, period.to);
  const stays = staysFrom(movements);
  return {
    period,
    stays,
    conflicts: berthConflicts(stays, period.to),
    open: openStays(stays),
  };
}

export function diaryForDays(context: Context, from: Minute, days = 7): BerthDiary {
  return diaryFor(context, makeInterval(from, from + days * MINUTES_PER_DAY));
}

export interface BerthSearch {
  readonly vessel: string;
  readonly draught: Cm;
  readonly period: Interval;
}

/** Which berths could take her, at the tide in the middle of the period. */
export function berthsFor(context: Context, search: BerthSearch): BerthCandidate[] {
  const vessel = requireVessel(context.db, search.vessel);
  const diary = diaryFor(context, search.period);
  const middle = Math.round((search.period.from + search.period.to) / 2);
  const station = requireStation(context.district, context.district.reaches[0]?.station ?? '');
  const tideHeight = predictHeight(station, middle);
  return candidates(
    context.district.berths,
    diary.stays,
    search.period,
    { length: vessel.length, draught: search.draught, tideHeight },
    search.period.to,
  );
}

/** How much of a period each berth was occupied for, as a percentage. */
export function utilisation(diary: BerthDiary): { berth: string; percent: number }[] {
  const span = diary.period.to - diary.period.from;
  const totals = new Map<string, number>();
  for (const stay of diary.stays) {
    const from = Math.max(stay.from, diary.period.from);
    const to = Math.min(stay.to ?? diary.period.to, diary.period.to);
    if (to <= from) {
      continue;
    }
    totals.set(stay.berth, (totals.get(stay.berth) ?? 0) + (to - from));
  }
  return [...totals.entries()]
    .map(([berth, minutes]) => ({
      berth,
      percent: span === 0 ? 0 : Math.round((minutes / span) * 100),
    }))
    .sort((a, b) => b.percent - a.percent || a.berth.localeCompare(b.berth));
}

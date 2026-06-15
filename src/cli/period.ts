/**
 * Reading a period off the command line.
 *
 * A dozen commands take the same two options and worked them out the same way,
 * and three of them had drifted: one defaulted the start to midnight rather than
 * to now, one read the days before it read the start so a bad day count blamed
 * the wrong option, and one counted the days from the end rather than the start.
 * This is that logic once.
 */

import type { Minute, Offset } from '../util/clock';
import { MINUTES_PER_DAY } from '../util/clock';
import type { Interval } from '../util/interval';
import { makeInterval } from '../util/interval';
import type { Context } from '../service/context';
import { readInteger, readTime } from './shared';

export interface PeriodOptions {
  readonly from?: string;
  readonly to?: string;
  readonly days?: string;
  readonly hours?: string;
}

export interface PeriodDefaults {
  /** Days when the command asks for days and none was given. */
  readonly days?: number;
  /** Hours when the command works in hours. */
  readonly hours?: number;
  /** Count the period backwards from the start, which the returns do. */
  readonly backwards?: boolean;
}

export function readStart(context: Context, local: PeriodOptions): Minute {
  const offset: Offset = context.district.offset;
  return local.from === undefined ? context.now() : readTime(local.from, offset);
}

/** The period a command was asked about, in whole minutes. */
export function readPeriod(
  context: Context,
  local: PeriodOptions,
  defaults: PeriodDefaults = {},
): Interval {
  const offset = context.district.offset;
  const span =
    local.hours !== undefined || defaults.hours !== undefined
      ? readInteger(local.hours ?? String(defaults.hours ?? 24), 'hours') * 60
      : readInteger(local.days ?? String(defaults.days ?? 1), 'days') * MINUTES_PER_DAY;
  if (local.to !== undefined && local.from !== undefined) {
    return makeInterval(readTime(local.from, offset), readTime(local.to, offset));
  }
  if (local.to !== undefined) {
    const to = readTime(local.to, offset);
    return makeInterval(to - span, to);
  }
  if (local.from !== undefined) {
    // a start the operator typed always runs forward from there, whatever the
    // command's default direction is: nobody types a start and means the days
    // before it
    const from = readTime(local.from, offset);
    return makeInterval(from, from + span);
  }
  const now = context.now();
  return defaults.backwards === true
    ? makeInterval(now - span, now)
    : makeInterval(now, now + span);
}

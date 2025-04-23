/**
 * Duty and rest.
 *
 * A pilot may not be given a job that would break the rest rules, and the rules
 * are written against the jobs already worked rather than against a shift
 * pattern, because there is no shift pattern: the ships come when the tide
 * lets them. So the duty log is the record, and every question about
 * availability is a question about what is in it.
 *
 * The three rules that matter: a minimum rest after a job, a ceiling on duty
 * inside any rolling twenty four hours, and a ceiling inside any rolling seven
 * days. All three are checked against the job being offered, not against the
 * jobs already done, because a job that would breach a ceiling is refused
 * whole rather than trimmed.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import { MINUTES_PER_DAY } from '../../util/clock';
import type { Interval } from '../../util/interval';
import { duration, makeInterval, overlaps } from '../../util/interval';

export interface RestRules {
  /** Minutes of rest after a job before another may be given. */
  readonly minimumRest: number;
  /** Most minutes of duty inside any rolling day. */
  readonly dailyCeiling: number;
  /** Most minutes of duty inside any rolling week. */
  readonly weeklyCeiling: number;
  /** A job longer than this counts as a long job and earns extra rest. */
  readonly longJob: number;
  /** Extra rest after a long job. */
  readonly longJobRest: number;
}

export const STANDARD_REST: RestRules = {
  minimumRest: 600,
  dailyCeiling: 720,
  weeklyCeiling: 3300,
  longJob: 480,
  longJobRest: 300,
};

export interface DutyEntry {
  readonly pilot: string;
  readonly movement: string;
  readonly period: Interval;
}

export function makeDutyEntry(
  pilot: string,
  movement: string,
  from: Minute,
  to: Minute,
): DutyEntry {
  return { pilot, movement, period: makeInterval(from, to) };
}

/** Every entry that touches a window, in time order. */
export function entriesIn(log: readonly DutyEntry[], window: Interval): DutyEntry[] {
  return log
    .filter((entry) => overlaps(entry.period, window))
    .sort((a, b) => a.period.from - b.period.from);
}

/** Minutes of duty inside a window, counting only the overlapping part. */
export function dutyMinutesIn(log: readonly DutyEntry[], window: Interval): number {
  return entriesIn(log, window).reduce((total, entry) => {
    const from = Math.max(entry.period.from, window.from);
    const to = Math.min(entry.period.to, window.to);
    return total + Math.max(0, to - from);
  }, 0);
}

export function lastEntryBefore(log: readonly DutyEntry[], minute: Minute): DutyEntry | undefined {
  return log
    .filter((entry) => entry.period.to <= minute)
    .sort((a, b) => a.period.to - b.period.to)
    .at(-1);
}

/** The rest a pilot owes after a job, which a long job lengthens. */
export function restAfter(rules: RestRules, entry: DutyEntry): number {
  const worked = duration(entry.period);
  return worked >= rules.longJob ? rules.minimumRest + rules.longJobRest : rules.minimumRest;
}

/** The first minute a pilot may start another job after the log given. */
export function availableFrom(
  rules: RestRules,
  log: readonly DutyEntry[],
  notBefore: Minute,
): Minute {
  const last = log.reduce<DutyEntry | undefined>(
    (latest, entry) =>
      latest === undefined || entry.period.to > latest.period.to ? entry : latest,
    undefined,
  );
  if (last === undefined) {
    return notBefore;
  }
  return Math.max(notBefore, last.period.to + restAfter(rules, last));
}

export type RestBreach = 'rest' | 'daily' | 'weekly' | 'overlap';

export interface RestCheck {
  readonly allowed: boolean;
  readonly breaches: readonly RestBreach[];
  readonly dailyAfter: number;
  readonly weeklyAfter: number;
}

/** Would this job break any of the three rules for this pilot. */
export function checkJob(rules: RestRules, log: readonly DutyEntry[], job: Interval): RestCheck {
  if (job.to < job.from) {
    throw new InputError('a duty period cannot end before it starts');
  }
  const breaches: RestBreach[] = [];
  if (log.some((entry) => overlaps(entry.period, job))) {
    breaches.push('overlap');
  }
  const previous = lastEntryBefore(log, job.from);
  if (previous !== undefined && job.from - previous.period.to < restAfter(rules, previous)) {
    breaches.push('rest');
  }
  const withJob = [...log, { pilot: 'candidate', movement: 'candidate', period: job }];
  const dailyAfter = dutyMinutesIn(withJob, {
    from: job.to - MINUTES_PER_DAY,
    to: job.to,
  });
  if (dailyAfter > rules.dailyCeiling) {
    breaches.push('daily');
  }
  const weeklyAfter = dutyMinutesIn(withJob, {
    from: job.to - 7 * MINUTES_PER_DAY,
    to: job.to,
  });
  if (weeklyAfter > rules.weeklyCeiling) {
    breaches.push('weekly');
  }
  return { allowed: breaches.length === 0, breaches, dailyAfter, weeklyAfter };
}

/** Total duty worked, for the pay run and for the fairness reading. */
export function totalDuty(log: readonly DutyEntry[]): number {
  return log.reduce((total, entry) => total + duration(entry.period), 0);
}

export function jobsWorked(log: readonly DutyEntry[], pilot: string): DutyEntry[] {
  return log.filter((entry) => entry.pilot === pilot);
}

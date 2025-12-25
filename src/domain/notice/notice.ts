/**
 * Notices: the things that are true this week and were not true last week.
 *
 * A dredger working the bar, a berth out of use, a cable being laid, a draught
 * cap while a wreck is surveyed. They are published with a start and an end and
 * they bind on everything planned inside that window, which is why they are
 * modelled rather than left as a note somebody reads: a notice that only exists
 * as prose gets applied to the movements whose planner happened to read it.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import type { Interval } from '../../util/interval';
import { contains, makeInterval, overlaps } from '../../util/interval';
import type { Cm } from '../../util/units';
import { assertCm } from '../../util/units';

export type NoticeKind =
  | 'closure'
  | 'draught-cap'
  | 'daylight-only'
  | 'speed-cap'
  | 'no-overtaking'
  | 'information';

export interface Notice {
  readonly id: string;
  readonly kind: NoticeKind;
  /** The reach or berth it binds on, or the district code for a general one. */
  readonly subject: string;
  readonly period: Interval;
  readonly text: string;
  /** Centimetres for a draught cap, tenths of a knot for a speed cap. */
  readonly value?: number;
  readonly issuedAt: Minute;
}

const NOTICE_ID = /^N-\d{4}-\d{3}$/;

export function makeNoticeId(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw new InputError(`${year} is not a year notices are issued in`);
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) {
    throw new InputError(`${sequence} is outside the notice sequence for a year`);
  }
  return `N-${year}-${String(sequence).padStart(3, '0')}`;
}

export function makeNotice(input: {
  id: string;
  kind: NoticeKind;
  subject: string;
  from: Minute;
  to: Minute;
  text: string;
  value?: number;
  issuedAt: Minute;
}): Notice {
  if (!NOTICE_ID.test(input.id)) {
    throw new InputError(`not a notice number: ${JSON.stringify(input.id)}`);
  }
  if (input.text.trim() === '') {
    throw new InputError(`notice ${input.id} says nothing`);
  }
  const period = makeInterval(input.from, input.to);
  if (input.kind === 'draught-cap') {
    const value = assertCm(input.value ?? 0, 'draught cap');
    if (value <= 0) {
      throw new InputError(`notice ${input.id} caps the draught at nothing`);
    }
  }
  if (input.kind === 'speed-cap') {
    if (!Number.isInteger(input.value) || (input.value ?? 0) <= 0) {
      throw new InputError(`notice ${input.id} caps the speed at nothing`);
    }
  }
  return {
    id: input.id,
    kind: input.kind,
    subject: input.subject,
    period,
    text: input.text.trim(),
    ...(input.value === undefined ? {} : { value: input.value }),
    issuedAt: input.issuedAt,
  };
}

export function isInForce(notice: Notice, at: Minute): boolean {
  return contains(notice.period, at);
}

export function bindsOn(notice: Notice, subject: string, period: Interval): boolean {
  return notice.subject === subject && overlaps(notice.period, period);
}

/** Every notice that binds on a subject over a period, in issue order. */
export function noticesFor(
  notices: readonly Notice[],
  subject: string,
  period: Interval,
): Notice[] {
  return notices
    .filter((notice) => bindsOn(notice, subject, period))
    .sort((a, b) => a.issuedAt - b.issuedAt || a.id.localeCompare(b.id));
}

/** The tightest draught cap in force on a subject, if there is one. */
export function draughtCapFor(
  notices: readonly Notice[],
  subject: string,
  period: Interval,
): Cm | undefined {
  const caps = noticesFor(notices, subject, period)
    .filter((notice) => notice.kind === 'draught-cap')
    .map((notice) => notice.value ?? 0);
  return caps.length === 0 ? undefined : Math.min(...caps);
}

export function speedCapFor(
  notices: readonly Notice[],
  subject: string,
  period: Interval,
): number | undefined {
  const caps = noticesFor(notices, subject, period)
    .filter((notice) => notice.kind === 'speed-cap')
    .map((notice) => notice.value ?? 0);
  return caps.length === 0 ? undefined : Math.min(...caps);
}

export function isClosed(notices: readonly Notice[], subject: string, period: Interval): boolean {
  return noticesFor(notices, subject, period).some((notice) => notice.kind === 'closure');
}

export function forcesDaylight(
  notices: readonly Notice[],
  subject: string,
  period: Interval,
): boolean {
  return noticesFor(notices, subject, period).some((notice) => notice.kind === 'daylight-only');
}

/** The periods a subject is closed, which the sweep subtracts. */
export function closurePeriods(notices: readonly Notice[], subject: string): Interval[] {
  return notices
    .filter((notice) => notice.subject === subject && notice.kind === 'closure')
    .map((notice) => notice.period);
}

export function currentNotices(notices: readonly Notice[], at: Minute): Notice[] {
  return notices
    .filter((notice) => isInForce(notice, at))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id));
}

export function expiredBy(notices: readonly Notice[], at: Minute): Notice[] {
  return notices.filter((notice) => notice.period.to < at);
}

export function describeNotice(notice: Notice): string {
  const value = notice.value === undefined ? '' : ` (${notice.value})`;
  return `${notice.id} ${notice.kind}${value} on ${notice.subject}: ${notice.text}`;
}

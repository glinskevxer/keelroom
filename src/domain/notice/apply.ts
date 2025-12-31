/**
 * What the notices in force do to a passage.
 *
 * A closure takes the reach out and there is no window at all. A draught cap
 * refuses a ship deeper than the cap. A daylight notice on any reach holds the
 * whole movement to daylight. A speed cap is the interesting one: it slows the
 * ship through that reach, which moves every later reach along the passage, so
 * the tide the ship meets on the bar is not the tide she would have met. It is
 * not a warning printed beside the plan, it is an input to it.
 */

import type { Finding } from '../../util/finding';
import { FindingLog } from '../../util/finding';
import type { Interval } from '../../util/interval';
import type { Cm } from '../../util/units';
import type { Passage } from '../chart/passage';
import type { Notice } from './notice';
import { draughtCapFor, forcesDaylight, isClosed, noticesFor, speedCapFor } from './notice';

export interface NoticeEffects {
  /** Reaches on the passage that are closed for any of the period. */
  readonly closed: readonly string[];
  /** The tightest draught cap on the passage, if any reach carries one. */
  readonly draughtCap: Cm | undefined;
  /** Whether any notice holds the movement to daylight. */
  readonly daylightOnly: boolean;
  /** Speed caps by reach, in tenths of a knot. */
  readonly speedCaps: Readonly<Record<string, number>>;
  readonly findings: readonly Finding[];
}

export interface NoticeContext {
  readonly notices: readonly Notice[];
  readonly passage: Passage;
  readonly period: Interval;
  readonly draught: Cm;
  /** The district code, for notices that bind on the whole district. */
  readonly district: string;
}

export function noticeEffects(context: NoticeContext): NoticeEffects {
  const log = new FindingLog();
  const closed: string[] = [];
  const speedCaps: Record<string, number> = {};
  let draughtCap: Cm | undefined;
  let daylightOnly = false;

  const subjects = [context.district, ...context.passage.legs.map((leg) => leg.reach.id)];
  for (const subject of subjects) {
    const binding = noticesFor(context.notices, subject, context.period);
    if (binding.length === 0) {
      continue;
    }
    if (isClosed(context.notices, subject, context.period)) {
      closed.push(subject);
      log.block('NOT-CLOSED-01', 'a notice closes this reach for the period', {
        subject,
      });
    }
    const cap = draughtCapFor(context.notices, subject, context.period);
    if (cap !== undefined) {
      draughtCap = draughtCap === undefined ? cap : Math.min(draughtCap, cap);
      if (context.draught > cap) {
        log.block('NOT-DEEP-02', 'a notice caps the draught below what she is presented at', {
          subject,
          detail: { cap, draught: context.draught },
        });
      } else {
        log.note('NOT-CAP-03', 'a draught cap is in force and she is inside it', {
          subject,
          detail: { cap },
        });
      }
    }
    if (forcesDaylight(context.notices, subject, context.period)) {
      daylightOnly = true;
      log.note('NOT-DAY-04', 'a notice holds this movement to daylight', { subject });
    }
    const speed = speedCapFor(context.notices, subject, context.period);
    if (speed !== undefined && subject !== context.district) {
      speedCaps[subject] = speed;
      log.note('NOT-SPEED-05', 'a notice caps the speed through this reach', {
        subject,
        detail: { speed },
      });
    }
    for (const notice of binding) {
      if (notice.kind === 'information') {
        log.note('NOT-INFO-06', notice.text, { subject });
      }
      if (notice.kind === 'no-overtaking') {
        log.advise('NOT-PASS-07', 'no overtaking in this reach while the notice is in force', {
          subject,
        });
      }
    }
  }

  return { closed, draughtCap, daylightOnly, speedCaps, findings: log.all() };
}

/** The speed a reach may be run at, taking the caps into account. */
export function cappedSpeed(effects: NoticeEffects, reach: string, requested: number): number {
  const cap = effects.speedCaps[reach];
  return cap === undefined ? requested : Math.min(cap, requested);
}

export function anyCap(effects: NoticeEffects): boolean {
  return (
    effects.closed.length > 0 ||
    effects.draughtCap !== undefined ||
    effects.daylightOnly ||
    Object.keys(effects.speedCaps).length > 0
  );
}

/**
 * The checks that need the planner rather than the schema.
 *
 * The structural checks live in storage and answer "is this file consistent".
 * These answer the more useful question: "is anything about to go wrong". A
 * movement confirmed on a window that has since closed, a survey old enough that
 * the planned depth is mostly allowance, a ship alongside for a fortnight with
 * no sailing on the book, tugs held for a movement that was cancelled.
 */

import { MINUTES_PER_DAY } from '../util/clock';
import type { Minute } from '../util/clock';
import { makeInterval } from '../util/interval';
import { isStale, surveyAgeDays } from '../domain/chart/reach';
import { currentNotices } from '../domain/notice/notice';
import { standingNotices } from '../storage/notice-store';
import { movementsInWindow } from '../storage/movement-store';
import { bookingsInPeriod } from '../storage/tug-store';
import { loadBoard } from '../storage/roster-store';
import { activePilots } from '../storage/roster-store';
import { expiringPapers } from '../domain/roster/pilot';
import { diaryForDays } from './berths';
import { planMovement } from './planning';
import type { Context } from './context';

export type HealthSeverity = 'warning' | 'note';

export interface HealthFinding {
  readonly check: string;
  readonly severity: HealthSeverity;
  readonly subject: string;
  readonly detail: string;
}

export interface HealthOptions {
  /** How far ahead to look at the movements. */
  readonly days?: number;
  /** Replan every confirmed movement, which is slow and worth it once a day. */
  readonly replan?: boolean;
  readonly staleSurveyDays?: number;
  readonly longStayDays?: number;
}

export function checkDistrict(context: Context, options: HealthOptions = {}): HealthFinding[] {
  const findings: HealthFinding[] = [];
  const days = options.days ?? 7;
  const now = context.now();
  const horizon: Minute = now + days * MINUTES_PER_DAY;

  for (const reach of context.district.reaches) {
    const age = Math.round(surveyAgeDays(reach, now));
    if (isStale(reach, now, options.staleSurveyDays ?? 365)) {
      findings.push({
        check: 'HEALTH-SURVEY',
        severity: 'warning',
        subject: reach.id,
        detail: `the survey is ${age} days old and the planned depth is mostly allowance`,
      });
    }
  }

  // two days back as well, because an order whose time has gone is exactly the
  // thing worth finding and it is behind the horizon by then
  const movements = movementsInWindow(context.db, now - 2 * MINUTES_PER_DAY, horizon);
  for (const movement of movements) {
    if (movement.status === 'confirmed' && movement.plannedFor !== undefined) {
      if (options.replan === true) {
        const plan = planMovement(context, {
          reference: movement.reference,
          bounds: makeInterval(movement.plannedFor - 360, movement.plannedFor + 360),
        });
        const stillOpen = plan.result.windows.some(
          (window) =>
            (movement.plannedFor ?? 0) >= window.from && (movement.plannedFor ?? 0) <= window.to,
        );
        if (!stillOpen) {
          findings.push({
            check: 'HEALTH-WINDOW',
            severity: 'warning',
            subject: movement.reference,
            detail: 'the window she was confirmed on is no longer open',
          });
        }
      }
    }
    if (movement.status === 'ordered' && movement.requestedFor < now) {
      findings.push({
        check: 'HEALTH-LATE',
        severity: 'warning',
        subject: movement.reference,
        detail: 'the time she was ordered for has gone and nothing has been planned',
      });
    }
    if (movement.status === 'assigned' && movement.tugs === 0) {
      findings.push({
        check: 'HEALTH-TUGS',
        severity: 'note',
        subject: movement.reference,
        detail: 'she is assigned with no tugs booked against her',
      });
    }
  }

  const cancelled = new Set(
    movements
      .filter((movement) => movement.status === 'cancelled' || movement.status === 'refused')
      .map((movement) => movement.reference),
  );
  for (const booking of bookingsInPeriod(context.db, makeInterval(now, horizon))) {
    if (cancelled.has(booking.movement)) {
      findings.push({
        check: 'HEALTH-TUGHELD',
        severity: 'warning',
        subject: booking.tug,
        detail: `still booked to ${booking.movement}, which is not going`,
      });
    }
  }

  const diary = diaryForDays(context, now - 30 * MINUTES_PER_DAY, 30 + days);
  const longStay = (options.longStayDays ?? 14) * MINUTES_PER_DAY;
  for (const stay of diary.open) {
    if (now - stay.from > longStay) {
      findings.push({
        check: 'HEALTH-ALONGSIDE',
        severity: 'note',
        subject: stay.berth,
        detail: `${stay.vessel} has been alongside since ${stay.arrival} with no sailing ordered`,
      });
    }
  }
  for (const clash of diary.conflicts) {
    findings.push({
      check: 'HEALTH-BERTH',
      severity: 'warning',
      subject: clash.berth,
      detail: `${clash.first} and ${clash.second} are booked onto it at once`,
    });
  }

  for (const notice of currentNotices(standingNotices(context.db), now)) {
    if (notice.period.to - now < MINUTES_PER_DAY) {
      findings.push({
        check: 'HEALTH-NOTICE',
        severity: 'note',
        subject: notice.id,
        detail: 'runs out inside a day and may want renewing',
      });
    }
  }

  const board = loadBoard(context.db);
  const roster = new Set(activePilots(context.db).map((pilot) => pilot.id));
  for (const entry of board.entries) {
    if (!roster.has(entry.pilot)) {
      findings.push({
        check: 'HEALTH-BOARD',
        severity: 'warning',
        subject: entry.pilot,
        detail: 'on the board and not on the active roster',
      });
    }
  }
  for (const pilot of roster) {
    if (!board.entries.some((entry) => entry.pilot === pilot)) {
      findings.push({
        check: 'HEALTH-BOARD',
        severity: 'warning',
        subject: pilot,
        detail: 'on the active roster and not on the board',
      });
    }
  }

  for (const paper of expiringPapers(activePilots(context.db), now, 60)) {
    findings.push({
      check: 'HEALTH-PAPERS',
      severity: paper.expires < now ? 'warning' : 'note',
      subject: paper.pilot,
      detail:
        paper.expires < now
          ? `the ${paper.paper} has run out`
          : `the ${paper.paper} runs out inside two months`,
    });
  }

  return findings.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1) ||
      a.check.localeCompare(b.check) ||
      a.subject.localeCompare(b.subject),
  );
}

export function warningsOnly(findings: readonly HealthFinding[]): HealthFinding[] {
  return findings.filter((finding) => finding.severity === 'warning');
}

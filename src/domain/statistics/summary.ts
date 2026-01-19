/**
 * The numbers the district reports on itself.
 *
 * Movements run, movements refused, how late the ships were against the time
 * they were planned for, where the delay hours went, and how the work fell
 * across the board. None of it is clever; the value is that it is computed from
 * the same records the despatchers work from rather than from a spreadsheet
 * somebody keeps separately, which is where a district's two sets of numbers
 * come from.
 */

import type { Minute } from '../../util/clock';
import type { Interval } from '../../util/interval';
import { contains } from '../../util/interval';
import type { Cents } from '../../util/units';
import type { Movement } from '../movement/movement';
import type { MovementTimes } from '../movement/times';
import { delaysByCause, pilotOnBoardMinutes, waitingMinutes } from '../movement/times';

export interface MovementRecord {
  readonly movement: Movement;
  readonly times?: MovementTimes;
  /** What it was charged, if it has been priced. */
  readonly charged?: Cents;
}

export interface PeriodSummary {
  readonly period: Interval;
  readonly ordered: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly refused: number;
  /** Movements that ran within fifteen minutes of the planned time. */
  readonly onTime: number;
  readonly lateMinutes: number;
  readonly pilotHours: number;
  readonly charged: Cents;
  readonly delaysByCause: Readonly<Record<string, number>>;
}

function whenOf(record: MovementRecord): Minute {
  return record.movement.plannedFor ?? record.movement.requestedFor;
}

export function inPeriod(records: readonly MovementRecord[], period: Interval): MovementRecord[] {
  return records.filter((record) => contains(period, whenOf(record)));
}

/** Minutes between the planned time and the pilot boarding. Never negative. */
export function latenessOf(record: MovementRecord): number {
  const planned = record.movement.plannedFor;
  const boarded = record.times?.boarded;
  if (planned === undefined || boarded === undefined) {
    return 0;
  }
  return Math.max(0, boarded - planned);
}

export function summarise(
  records: readonly MovementRecord[],
  period: Interval,
  onTimeWithin = 15,
): PeriodSummary {
  const held = inPeriod(records, period);
  let completed = 0;
  let cancelled = 0;
  let refused = 0;
  let onTime = 0;
  let lateMinutes = 0;
  let pilotMinutes = 0;
  let charged = 0;
  const causes: Record<string, number> = {};

  for (const record of held) {
    switch (record.movement.status) {
      case 'completed':
        completed += 1;
        break;
      case 'cancelled':
        cancelled += 1;
        break;
      case 'refused':
        refused += 1;
        break;
      default:
        break;
    }
    const late = latenessOf(record);
    if (record.movement.status === 'completed') {
      lateMinutes += late;
      if (late <= onTimeWithin) {
        onTime += 1;
      }
    }
    if (record.times !== undefined) {
      pilotMinutes += pilotOnBoardMinutes(record.times);
      for (const [cause, minutes] of Object.entries(delaysByCause(record.times))) {
        causes[cause] = (causes[cause] ?? 0) + minutes;
      }
    }
    charged += record.charged ?? 0;
  }

  return {
    period,
    ordered: held.length,
    completed,
    cancelled,
    refused,
    onTime,
    lateMinutes,
    pilotHours: Math.round(pilotMinutes / 60),
    charged,
    delaysByCause: causes,
  };
}

/** Completed movements that ran on time, as a percentage. */
export function punctuality(summary: PeriodSummary): number {
  if (summary.completed === 0) {
    return 100;
  }
  return Math.round((summary.onTime / summary.completed) * 100);
}

export function averageLateness(summary: PeriodSummary): number {
  if (summary.completed === 0) {
    return 0;
  }
  return Math.round(summary.lateMinutes / summary.completed);
}

export function cancellationRate(summary: PeriodSummary): number {
  if (summary.ordered === 0) {
    return 0;
  }
  return Math.round((summary.cancelled / summary.ordered) * 100);
}

export interface PilotWorkload {
  readonly pilot: string;
  readonly jobs: number;
  readonly minutes: number;
}

export function workloadByPilot(records: readonly MovementRecord[]): PilotWorkload[] {
  const held = new Map<string, PilotWorkload>();
  for (const record of records) {
    const pilot = record.movement.pilot;
    if (pilot === undefined) {
      continue;
    }
    const current = held.get(pilot) ?? { pilot, jobs: 0, minutes: 0 };
    held.set(pilot, {
      pilot,
      jobs: current.jobs + 1,
      minutes:
        current.minutes + (record.times === undefined ? 0 : pilotOnBoardMinutes(record.times)),
    });
  }
  return [...held.values()].sort((a, b) => b.jobs - a.jobs || a.pilot.localeCompare(b.pilot));
}

export interface AgentActivity {
  readonly agent: string;
  readonly movements: number;
  readonly charged: Cents;
}

export function activityByAgent(records: readonly MovementRecord[]): AgentActivity[] {
  const held = new Map<string, AgentActivity>();
  for (const record of records) {
    const agent = record.movement.agent;
    const current = held.get(agent) ?? { agent, movements: 0, charged: 0 };
    held.set(agent, {
      agent,
      movements: current.movements + 1,
      charged: current.charged + (record.charged ?? 0),
    });
  }
  return [...held.values()].sort(
    (a, b) => b.charged - a.charged || b.movements - a.movements || a.agent.localeCompare(b.agent),
  );
}

/** Total waiting the district kept ships hanging about for. */
export function waitingHours(records: readonly MovementRecord[]): number {
  const minutes = records.reduce(
    (total, record) => total + (record.times === undefined ? 0 : waitingMinutes(record.times)),
    0,
  );
  return Math.round(minutes / 60);
}

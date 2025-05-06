/**
 * Giving a ship to a pilot.
 *
 * The board decides the order, the licence decides who may, the rest rules
 * decide who can, and leave decides who is even here. The engine walks the
 * board from the top and takes the first pilot who clears all four, recording a
 * pass against everybody it walked over and the rule that did it.
 *
 * Nothing here reorders the board to get a better answer. A despatcher may
 * override the result, and an override is a separate act with its own record,
 * because the whole point of the board is that it is not quietly rearranged.
 */

import type { Finding } from '../../util/finding';
import { FindingLog } from '../../util/finding';
import type { Interval } from '../../util/interval';
import { overlaps } from '../../util/interval';
import type { TurnBoard } from './board';
import { order, passOver, takeTurn } from './board';
import type { DutyEntry, RestRules } from './duty';
import { checkJob, jobsWorked, STANDARD_REST } from './duty';
import type { Pilot } from './pilot';
import type { JobDemand } from './qualification';
import { qualifies } from './qualification';

export interface AssignmentRequest {
  readonly board: TurnBoard;
  readonly pilots: readonly Pilot[];
  readonly duty: readonly DutyEntry[];
  readonly leave?: Readonly<Record<string, readonly Interval[]>>;
  readonly rules?: RestRules;
  readonly demand: JobDemand;
  /** The period the pilot is committed for, boarding to landing. */
  readonly job: Interval;
}

export type PassReason = 'unknown' | 'licence' | 'rest' | 'leave';

export interface PassRecord {
  readonly pilot: string;
  readonly reason: PassReason;
  readonly rule: string;
}

export interface AssignmentResult {
  readonly pilot: Pilot | undefined;
  readonly board: TurnBoard;
  readonly passes: readonly PassRecord[];
  readonly findings: readonly Finding[];
}

const PASS_RULES: Record<PassReason, string> = {
  unknown: 'ASG-NONE-01',
  licence: 'ASG-LIC-02',
  rest: 'ASG-REST-03',
  leave: 'ASG-LEAVE-04',
};

function onLeave(request: AssignmentRequest, pilot: string): boolean {
  const periods = request.leave?.[pilot] ?? [];
  return periods.some((period) => overlaps(period, request.job));
}

/** Why this pilot cannot take this job, or nothing if there is no reason. */
export function reasonToPass(request: AssignmentRequest, pilot: Pilot): PassReason | undefined {
  if (onLeave(request, pilot.id)) {
    return 'leave';
  }
  if (!qualifies(pilot, request.demand).qualified) {
    return 'licence';
  }
  const rules = request.rules ?? STANDARD_REST;
  if (!checkJob(rules, jobsWorked(request.duty, pilot.id), request.job).allowed) {
    return 'rest';
  }
  return undefined;
}

export function assign(request: AssignmentRequest): AssignmentResult {
  const log = new FindingLog();
  const byId = new Map(request.pilots.map((pilot) => [pilot.id, pilot]));
  const passes: PassRecord[] = [];
  let board = request.board;

  for (const pilotId of order(request.board)) {
    const pilot = byId.get(pilotId);
    if (pilot === undefined) {
      passes.push({ pilot: pilotId, reason: 'unknown', rule: PASS_RULES.unknown });
      log.note(PASS_RULES.unknown, 'the board carries a pilot the roster does not', {
        subject: pilotId,
      });
      continue;
    }
    const reason = reasonToPass(request, pilot);
    if (reason === undefined) {
      return {
        pilot,
        board: takeTurn(board, pilot.id, request.job.to),
        passes,
        findings: log.all(),
      };
    }
    passes.push({ pilot: pilotId, reason, rule: PASS_RULES[reason] });
    log.note(PASS_RULES[reason], 'passed over', { subject: pilotId });
    board = passOver(board, pilotId);
  }

  log.block('ASG-EMPTY-05', 'no pilot on the board can take this job', {
    detail: { considered: passes.length },
  });
  return { pilot: undefined, board, passes, findings: log.all() };
}

/** Everybody who could take the job, in board order, without changing anything. */
export function whoCouldTake(request: AssignmentRequest): Pilot[] {
  const byId = new Map(request.pilots.map((pilot) => [pilot.id, pilot]));
  return order(request.board)
    .map((pilotId) => byId.get(pilotId))
    .filter((pilot): pilot is Pilot => pilot !== undefined)
    .filter((pilot) => reasonToPass(request, pilot) === undefined);
}

/** Group the passes by what caused them, which is what the daily report shows. */
export function passesByReason(passes: readonly PassRecord[]): Record<PassReason, string[]> {
  const grouped: Record<PassReason, string[]> = {
    unknown: [],
    licence: [],
    rest: [],
    leave: [],
  };
  for (const pass of passes) {
    grouped[pass.reason].push(pass.pilot);
  }
  return grouped;
}

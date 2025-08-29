/**
 * Giving a confirmed movement to a pilot, and following it while it runs.
 *
 * The assignment engine decides who; this decides what that means to the
 * records. A pilot given a ship goes down the board, the job goes in the duty
 * log against the rest rules, and the movement carries the pilot's id. Every one
 * of those has to happen together or the next assignment is made against a board
 * that does not match the log.
 */

import { InputError } from '../util/errors';
import type { Minute } from '../util/clock';
import type { Interval } from '../util/interval';
import { makeInterval } from '../util/interval';
import { inTransaction } from '../storage/database';
import type { Movement } from '../domain/movement/movement';
import { apply } from '../domain/movement/lifecycle';
import type { MovementTimes } from '../domain/movement/times';
import { makeDutyEntry } from '../domain/roster/duty';
import type { Pilot } from '../domain/roster/pilot';
import type { PassRecord } from '../domain/roster/assign';
import { assign } from '../domain/roster/assign';
import { isDaylight } from '../domain/window/daylight';
import { requireVessel } from '../storage/fleet-store';
import { findTimes, requireMovement, saveMovement, saveTimes } from '../storage/movement-store';
import {
  activePilots,
  leaveByPilot,
  loadBoard,
  recordDuty,
  requirePilot,
  saveBoard,
  allDuty,
} from '../storage/roster-store';
import type { Context } from './context';
import { passageFor } from './planning';

export interface AssignRequest {
  readonly reference: string;
  /** Force this pilot rather than taking the top of the board. */
  readonly pilot?: string;
  /** Why the board was overridden, which is recorded on the movement. */
  readonly override?: string;
}

export interface AssignResult {
  readonly movement: Movement;
  readonly pilot: Pilot;
  readonly passes: readonly PassRecord[];
  readonly period: Interval;
}

/** Boarding to landing, which is what the pilot is committed for. */
export function jobPeriod(context: Context, movement: Movement): Interval {
  const plannedFor = movement.plannedFor;
  if (plannedFor === undefined) {
    throw new InputError(`movement ${movement.reference} has no planned time to work from`);
  }
  const passage = passageFor(context, movement);
  return makeInterval(plannedFor - 30, plannedFor + passage.minutes + 30);
}

export function assignPilot(context: Context, request: AssignRequest): AssignResult {
  const movement = requireMovement(context.db, request.reference);
  if (movement.status !== 'confirmed') {
    throw new InputError(`movement ${request.reference} is not confirmed`, {
      status: movement.status,
    });
  }
  const vessel = requireVessel(context.db, movement.vessel);
  const period = jobPeriod(context, movement);
  const berth = movement.kind === 'departure' ? movement.from : movement.to;
  const demand = {
    vessel,
    draught: movement.draught,
    night:
      !isDaylight(context.position, period.from, context.district.offset) ||
      !isDaylight(context.position, period.to, context.district.offset),
    ...(berth === 'SEA' ? {} : { berth }),
  };
  const board = loadBoard(context.db);
  const pilots = activePilots(context.db);

  if (request.pilot !== undefined) {
    const chosen = requirePilot(context.db, request.pilot);
    return commit(context, movement, chosen, period, [], request.override);
  }

  const result = assign({
    board,
    pilots,
    duty: allDuty(context.db, period.from - 10080),
    leave: leaveByPilot(context.db),
    rules: context.config.rest,
    demand,
    job: period,
  });
  if (result.pilot === undefined) {
    saveBoard(context.db, result.board);
    throw new InputError(`no pilot can take movement ${request.reference}`, {
      considered: result.passes.length,
    });
  }
  return commit(context, movement, result.pilot, period, result.passes, undefined, result.board);
}

function commit(
  context: Context,
  movement: Movement,
  pilot: Pilot,
  period: Interval,
  passes: readonly PassRecord[],
  override?: string,
  board = loadBoard(context.db),
): AssignResult {
  const assigned = apply(movement, { to: 'assigned', pilot: pilot.id });
  const withNoteApplied =
    override === undefined
      ? assigned
      : { ...assigned, notes: [...assigned.notes, `board overridden: ${override}`] };
  inTransaction(context.db, () => {
    saveMovement(context.db, withNoteApplied);
    recordDuty(context.db, makeDutyEntry(pilot.id, movement.reference, period.from, period.to));
    saveBoard(context.db, board);
  });
  return { movement: withNoteApplied, pilot, passes, period };
}

export function boardVessel(context: Context, reference: string, at: Minute): Movement {
  const movement = requireMovement(context.db, reference);
  const boarded = apply(movement, { to: 'boarded', at });
  const times: MovementTimes = {
    ...(findTimes(context.db, reference) ?? {
      orderedFor: movement.plannedFor ?? movement.requestedFor,
    }),
    boarded: at,
  };
  inTransaction(context.db, () => {
    saveMovement(context.db, boarded);
    saveTimes(context.db, reference, times);
  });
  return boarded;
}

export function getUnderway(context: Context, reference: string, at: Minute): Movement {
  const movement = requireMovement(context.db, reference);
  const underway = apply(movement, { to: 'underway', at });
  const existing = findTimes(context.db, reference);
  if (existing === undefined) {
    throw new InputError(`movement ${reference} has no card to write a let go time on`);
  }
  inTransaction(context.db, () => {
    saveMovement(context.db, underway);
    saveTimes(context.db, reference, { ...existing, letGo: at });
  });
  return underway;
}

export function completeMovement(context: Context, reference: string, at: Minute): Movement {
  const movement = requireMovement(context.db, reference);
  const completed = apply(movement, { to: 'completed', at });
  const existing = findTimes(context.db, reference);
  if (existing === undefined) {
    throw new InputError(`movement ${reference} has no card to close`);
  }
  if (existing.boarded !== undefined && at < existing.boarded) {
    throw new InputError('the movement cannot finish before the pilot boarded');
  }
  inTransaction(context.db, () => {
    saveMovement(context.db, completed);
    saveTimes(context.db, reference, { ...existing, allFast: at });
    if (completed.pilot !== undefined && existing.boarded !== undefined) {
      recordDuty(context.db, makeDutyEntry(completed.pilot, reference, existing.boarded, at));
    }
  });
  return completed;
}

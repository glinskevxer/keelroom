/**
 * The lifecycle, and the guards on it.
 *
 * A movement is ordered, confirmed against a window, given a pilot, boarded,
 * run and completed. It can be cancelled from anywhere before it is underway
 * and refused before it is confirmed. What makes this worth a module rather
 * than a status column is the guards: a movement cannot be confirmed without a
 * planned time, cannot be assigned without being confirmed, and cannot be
 * boarded without a pilot. Those are the rules that stop a ship sailing with
 * nobody on the bridge because a field was left blank.
 */

import { TransitionError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import type { Movement, MovementStatus } from './movement';
import { withNote } from './movement';

export type Transition =
  | { readonly to: 'confirmed'; readonly plannedFor: Minute }
  | { readonly to: 'assigned'; readonly pilot: string }
  | { readonly to: 'boarded'; readonly at: Minute }
  | { readonly to: 'underway'; readonly at: Minute }
  | { readonly to: 'completed'; readonly at: Minute }
  | { readonly to: 'cancelled'; readonly reason: string }
  | { readonly to: 'refused'; readonly reason: string };

const ALLOWED: Record<MovementStatus, readonly MovementStatus[]> = {
  ordered: ['confirmed', 'cancelled', 'refused'],
  confirmed: ['assigned', 'confirmed', 'cancelled'],
  assigned: ['boarded', 'confirmed', 'cancelled'],
  boarded: ['underway', 'cancelled'],
  underway: ['completed'],
  completed: [],
  cancelled: [],
  refused: [],
};

export function canMove(from: MovementStatus, to: MovementStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function nextStates(from: MovementStatus): readonly MovementStatus[] {
  return ALLOWED[from] ?? [];
}

export function isTerminal(status: MovementStatus): boolean {
  return ALLOWED[status].length === 0;
}

export function apply(movement: Movement, transition: Transition): Movement {
  if (!canMove(movement.status, transition.to)) {
    throw new TransitionError(
      movement.status,
      transition.to,
      isTerminal(movement.status) ? 'the movement is closed' : 'the lifecycle does not allow it',
    );
  }
  switch (transition.to) {
    case 'confirmed':
      return { ...movement, status: 'confirmed', plannedFor: transition.plannedFor };
    case 'assigned':
      if (movement.plannedFor === undefined) {
        throw new TransitionError(movement.status, 'assigned', 'there is no planned time');
      }
      return { ...movement, status: 'assigned', pilot: transition.pilot };
    case 'boarded':
      if (movement.pilot === undefined) {
        throw new TransitionError(movement.status, 'boarded', 'no pilot has been given the job');
      }
      return { ...movement, status: 'boarded' };
    case 'underway':
      return { ...movement, status: 'underway' };
    case 'completed':
      return { ...movement, status: 'completed' };
    case 'cancelled':
      return withNote({ ...movement, status: 'cancelled' }, `cancelled: ${transition.reason}`);
    case 'refused':
      return withNote({ ...movement, status: 'refused' }, `refused: ${transition.reason}`);
  }
}

/** Replanning a confirmed movement keeps it confirmed and drops the pilot. */
export function replan(movement: Movement, plannedFor: Minute): Movement {
  if (!canMove(movement.status, 'confirmed')) {
    throw new TransitionError(movement.status, 'confirmed', 'the movement cannot be replanned');
  }
  return { ...movement, status: 'confirmed', plannedFor, pilot: undefined };
}

/** Statuses in the order the board shows them, which is roughly time order. */
export const STATUS_ORDER: readonly MovementStatus[] = [
  'ordered',
  'confirmed',
  'assigned',
  'boarded',
  'underway',
  'completed',
  'cancelled',
  'refused',
];

export function statusRank(status: MovementStatus): number {
  const rank = STATUS_ORDER.indexOf(status);
  return rank < 0 ? STATUS_ORDER.length : rank;
}

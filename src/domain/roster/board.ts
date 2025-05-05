/**
 * The turn board.
 *
 * Pilots take the ships in rotation. A pilot who takes a job goes to the bottom
 * of the board; a pilot who is passed over because the ship was outside the
 * licence, or because the rest rules said no, keeps the place. That is the
 * whole of the fairness rule and it is the part of this system the pilots
 * themselves read most closely, so a pass is recorded with the reason it
 * happened rather than being silently skipped.
 *
 * The board is immutable. Every change returns a new board, because the
 * despatcher tries several ships against the same board before committing to
 * one and a board that changed underneath would give a different answer the
 * second time.
 */

import { InputError, NotFoundError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import type { Pilot } from './pilot';
import { bySeniority } from './pilot';

export interface BoardEntry {
  readonly pilot: string;
  /** Lower is nearer the top of the board. */
  readonly turn: number;
  readonly lastJobEnded: Minute | undefined;
  readonly passes: number;
  readonly jobs: number;
}

export interface TurnBoard {
  readonly entries: readonly BoardEntry[];
}

export interface Pass {
  readonly pilot: string;
  readonly rule: string;
}

export function makeBoard(pilots: readonly Pilot[]): TurnBoard {
  if (pilots.length === 0) {
    throw new InputError('a turn board needs at least one pilot');
  }
  const entries = bySeniority(pilots).map((pilot, index) => ({
    pilot: pilot.id,
    turn: index + 1,
    lastJobEnded: undefined,
    passes: 0,
    jobs: 0,
  }));
  return { entries };
}

export function order(board: TurnBoard): string[] {
  return [...board.entries]
    .sort((a, b) => a.turn - b.turn || a.pilot.localeCompare(b.pilot))
    .map((entry) => entry.pilot);
}

export function entryFor(board: TurnBoard, pilot: string): BoardEntry {
  const entry = board.entries.find((candidate) => candidate.pilot === pilot);
  if (entry === undefined) {
    throw new NotFoundError('pilot on the board', pilot);
  }
  return entry;
}

export function positionOf(board: TurnBoard, pilot: string): number {
  return order(board).indexOf(pilot) + 1;
}

export function topOfBoard(board: TurnBoard): string {
  const first = order(board)[0];
  if (first === undefined) {
    throw new InputError('the board is empty');
  }
  return first;
}

/** A pilot who takes a job goes to the bottom and the pass count resets. */
export function takeTurn(board: TurnBoard, pilot: string, endedAt: Minute): TurnBoard {
  entryFor(board, pilot);
  const bottom = board.entries.reduce((worst, entry) => Math.max(worst, entry.turn), 0);
  return {
    entries: board.entries.map((entry) =>
      entry.pilot === pilot
        ? {
            ...entry,
            turn: bottom + 1,
            lastJobEnded: endedAt,
            passes: 0,
            jobs: entry.jobs + 1,
          }
        : entry,
    ),
  };
}

/** A pilot passed over keeps the place and the reason is counted. */
export function passOver(board: TurnBoard, pilot: string): TurnBoard {
  entryFor(board, pilot);
  return {
    entries: board.entries.map((entry) =>
      entry.pilot === pilot ? { ...entry, passes: entry.passes + 1 } : entry,
    ),
  };
}

/** Renumber from one, which is done when the board is printed for the week. */
export function renumber(board: TurnBoard): TurnBoard {
  const sorted = [...board.entries].sort(
    (a, b) => a.turn - b.turn || a.pilot.localeCompare(b.pilot),
  );
  return { entries: sorted.map((entry, index) => ({ ...entry, turn: index + 1 })) };
}

export function addPilot(board: TurnBoard, pilot: Pilot): TurnBoard {
  if (board.entries.some((entry) => entry.pilot === pilot.id)) {
    throw new InputError(`${pilot.id} is already on the board`);
  }
  const bottom = board.entries.reduce((worst, entry) => Math.max(worst, entry.turn), 0);
  return {
    entries: [
      ...board.entries,
      { pilot: pilot.id, turn: bottom + 1, lastJobEnded: undefined, passes: 0, jobs: 0 },
    ],
  };
}

export function removePilot(board: TurnBoard, pilot: string): TurnBoard {
  entryFor(board, pilot);
  return { entries: board.entries.filter((entry) => entry.pilot !== pilot) };
}

/** How evenly the work has fallen, as the spread between most and fewest jobs. */
export function jobSpread(board: TurnBoard): number {
  if (board.entries.length === 0) {
    return 0;
  }
  const counts = board.entries.map((entry) => entry.jobs);
  return Math.max(...counts) - Math.min(...counts);
}

/** Pilots passed over more than this many times running, who the board flags. */
export function repeatedlyPassed(board: TurnBoard, threshold = 3): BoardEntry[] {
  return board.entries
    .filter((entry) => entry.passes >= threshold)
    .sort((a, b) => b.passes - a.passes || a.pilot.localeCompare(b.pilot));
}

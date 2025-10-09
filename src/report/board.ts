/**
 * The turn board as the pilots see it on the wall.
 *
 * Order, whose turn is next, how much each has worked and who has been passed
 * over. The passes matter as much as the jobs: a pilot at the top of the board
 * for a week is a pilot whose licence is too narrow for the ships that came,
 * and the district would rather see that in a column than hear it in a meeting.
 */

import type { Minute, Offset } from '../util/clock';
import { formatDuration, formatLocal } from '../util/clock';
import { renderTable } from '../util/table';
import type { TurnBoard } from '../domain/roster/board';
import { jobSpread, order, repeatedlyPassed } from '../domain/roster/board';
import type { DutyEntry, RestRules } from '../domain/roster/duty';
import { availableFrom, jobsWorked, totalDuty } from '../domain/roster/duty';
import type { Pilot } from '../domain/roster/pilot';

export interface BoardReportOptions {
  readonly offset: Offset;
  readonly now: Minute;
  readonly rules: RestRules;
  readonly title?: string;
}

export interface BoardLine {
  readonly position: number;
  readonly pilot: string;
  readonly name: string;
  readonly grade: string;
  readonly jobs: number;
  readonly passes: number;
  readonly dutyMinutes: number;
  readonly availableFrom: Minute;
}

export function boardLines(
  board: TurnBoard,
  pilots: readonly Pilot[],
  duty: readonly DutyEntry[],
  options: BoardReportOptions,
): BoardLine[] {
  const byId = new Map(pilots.map((pilot) => [pilot.id, pilot]));
  return order(board).map((id, index) => {
    const worked = jobsWorked(duty, id);
    const entry = board.entries.find((each) => each.pilot === id);
    const pilot = byId.get(id);
    return {
      position: index + 1,
      pilot: id,
      name: pilot?.name ?? 'not on the roster',
      grade: pilot?.grade ?? '',
      jobs: entry?.jobs ?? 0,
      passes: entry?.passes ?? 0,
      dutyMinutes: totalDuty(worked),
      availableFrom: availableFrom(options.rules, worked, options.now),
    };
  });
}

export function renderBoard(
  board: TurnBoard,
  pilots: readonly Pilot[],
  duty: readonly DutyEntry[],
  options: BoardReportOptions,
): string {
  const rows = boardLines(board, pilots, duty, options).map((line) => [
    String(line.position),
    line.pilot,
    line.name,
    line.grade,
    String(line.jobs),
    String(line.passes),
    formatDuration(line.dutyMinutes),
    line.availableFrom <= options.now ? 'now' : formatLocal(line.availableFrom, options.offset),
  ]);
  return renderTable(
    [
      { heading: '#', align: 'right' },
      { heading: 'pilot' },
      { heading: 'name' },
      { heading: 'grade' },
      { heading: 'jobs', align: 'right' },
      { heading: 'passes', align: 'right' },
      { heading: 'duty', align: 'right' },
      { heading: 'free from' },
    ],
    rows,
    { title: options.title ?? 'the board', empty: 'nobody on the board' },
  );
}

/** The lines a supervisor is expected to act on. */
export function boardWarnings(board: TurnBoard, threshold = 3): string[] {
  const warnings: string[] = [];
  for (const entry of repeatedlyPassed(board, threshold)) {
    warnings.push(`${entry.pilot} has been passed over ${entry.passes} times running`);
  }
  const spread = jobSpread(board);
  if (spread >= 5) {
    warnings.push(`the work is ${spread} jobs apart between the busiest and the quietest`);
  }
  return warnings;
}

export function whoIsNext(board: TurnBoard): string {
  return order(board)[0] ?? 'nobody';
}

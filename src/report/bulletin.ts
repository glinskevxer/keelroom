/**
 * The morning bulletin.
 *
 * One page, read out at the eight o'clock meeting: the tide, the weather, what
 * is in force, what is expected today, who has the board, and anything the
 * doctor is unhappy about. It is assembled from the same services the rest of
 * the system uses, so it cannot disagree with the screens.
 */

import type { Minute, Offset } from '../util/clock';
import { MINUTES_PER_DAY, formatLocal, localDate, localTime, startOfLocalDay } from '../util/clock';
import { bullet, renderPairs, renderTable } from '../util/table';
import { formatMetres } from '../util/units';
import type { Extreme } from '../domain/tide/extremes';
import type { Movement } from '../domain/movement/movement';
import type { Notice } from '../domain/notice/notice';
import type { Observation } from '../domain/weather/observation';
import type { HealthFinding } from '../service/health';
import { describeObservation } from '../domain/weather/observation';
import { currentNotices } from '../domain/notice/notice';
import { countByState, renderCounts, renderOrders } from './orders';

export interface BulletinInput {
  readonly day: Minute;
  readonly offset: Offset;
  readonly district: string;
  readonly extremes: readonly Extreme[];
  readonly weather: Observation | undefined;
  readonly notices: readonly Notice[];
  readonly movements: readonly Movement[];
  readonly board: readonly string[];
  readonly health: readonly HealthFinding[];
  readonly names?: Readonly<Record<string, string>>;
}

export function tideLine(extremes: readonly Extreme[], offset: Offset): string {
  if (extremes.length === 0) {
    return 'no turns of the tide today';
  }
  return extremes
    .map(
      (extreme) =>
        `${extreme.kind === 'high' ? 'HW' : 'LW'} ${localTime(extreme.minute, offset)} ${formatMetres(extreme.height)}`,
    )
    .join('   ');
}

export function renderBulletin(input: BulletinInput): string {
  const day = startOfLocalDay(input.day, input.offset);
  const head = renderPairs([
    ['district', input.district],
    ['date', localDate(day, input.offset)],
    ['tide', tideLine(input.extremes, input.offset)],
    [
      'weather',
      input.weather === undefined ? 'nothing logged' : describeObservation(input.weather),
    ],
    ['board', input.board.slice(0, 3).join(', ') || 'nobody on the board'],
  ]);
  const inForce = currentNotices(input.notices, input.day);
  const noticeLines =
    inForce.length === 0
      ? 'no notices in force'
      : bullet(inForce.map((notice) => `${notice.subject}: ${notice.text} (${notice.id})`));
  const orders = renderOrders(input.movements, {
    offset: input.offset,
    title: 'expected today',
    ...(input.names === undefined ? {} : { names: input.names }),
  });
  const attention =
    input.health.length === 0
      ? 'nothing wants attention'
      : bullet(
          input.health.map((finding) => `${finding.subject}: ${finding.detail} [${finding.check}]`),
        );
  return [
    `keelroom bulletin for ${localDate(day, input.offset)}`,
    '',
    head,
    '',
    noticeLines,
    '',
    orders,
    '',
    renderCounts(countByState(input.movements)),
    '',
    attention,
  ].join('\n');
}

/** The two lines that go out by radio, for the days nobody reads the page. */
export function bulletinHeadlines(input: BulletinInput): string[] {
  const lines = [
    `${localDate(input.day, input.offset)}: ${input.movements.length} movements, ${tideLine(input.extremes, input.offset)}`,
  ];
  const inForce = currentNotices(input.notices, input.day);
  if (inForce.length > 0) {
    lines.push(`${inForce.length} notices in force, first ${inForce[0]?.id ?? ''}`);
  }
  if (input.health.length > 0) {
    lines.push(`${input.health.length} things want attention`);
  }
  return lines;
}

/** The board, printed the way the bulletin wants it rather than in full. */
export function renderBoardLine(board: readonly string[]): string {
  return renderTable(
    [{ heading: 'turn', align: 'right' }, { heading: 'pilot' }],
    board.map((pilot, index) => [String(index + 1), pilot]),
    { title: 'the board', empty: 'nobody on the board' },
  );
}

export function dayBounds(day: Minute, offset: Offset): { from: Minute; to: Minute } {
  const from = startOfLocalDay(day, offset);
  return { from, to: from + MINUTES_PER_DAY };
}

export function stamp(at: Minute, offset: Offset): string {
  return `issued ${formatLocal(at, offset)}`;
}

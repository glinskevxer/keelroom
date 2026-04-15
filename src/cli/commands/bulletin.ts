/**
 * keelroom bulletin: the page the morning meeting reads.
 */

import type { Command } from 'commander';
import { findExtremes } from '../../domain/tide/extremes';
import { readingAt } from '../../domain/weather/observation';
import { order as boardOrder } from '../../domain/roster/board';
import { standingNotices } from '../../storage/notice-store';
import { movementsInWindow } from '../../storage/movement-store';
import { weatherBetween } from '../../storage/weather-store';
import { loadBoard } from '../../storage/roster-store';
import { allVessels } from '../../storage/fleet-store';
import { checkDistrict } from '../../service/health';
import { bulletinHeadlines, dayBounds, renderBulletin, stamp } from '../../report/bulletin';
import type { Io } from '../output';
import { withDistrict } from '../run';
import { readTime } from '../shared';

export function registerBulletin(program: Command, io: Io): void {
  program
    .command('bulletin')
    .description('the morning page: tide, weather, notices, movements and the board')
    .option('--day <date>', 'which day, if not today')
    .option('--headlines', 'the two lines that go out by radio')
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, local: { day?: string; headlines?: boolean }) => {
          const offset = context.district.offset;
          const day = local.day === undefined ? context.now() : readTime(local.day, offset);
          const bounds = dayBounds(day, offset);
          const station = context.district.stations[0];
          const input = {
            day,
            offset,
            district: `${context.district.code} ${context.district.name}`,
            extremes: station === undefined ? [] : findExtremes(station, bounds.from, bounds.to),
            weather: readingAt(weatherBetween(context.db, bounds.from - 1440, bounds.to), day)
              ?.reading,
            notices: standingNotices(context.db),
            movements: movementsInWindow(context.db, bounds.from, bounds.to),
            board: boardOrder(loadBoard(context.db)),
            health: checkDistrict(context, { days: 1 }),
            names: Object.fromEntries(
              allVessels(context.db).map((vessel) => [vessel.imo, vessel.name]),
            ),
          };
          if (local.headlines === true) {
            const lines = bulletinHeadlines(input);
            say(lines.join('\n'), lines);
            return;
          }
          say(`${renderBulletin(input)}\n\n${stamp(context.now(), offset)}`, {
            day: bounds.from,
            movements: input.movements.length,
            notices: input.notices.length,
            health: input.health,
          });
        },
      ),
    );
}

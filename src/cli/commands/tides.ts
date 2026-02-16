/**
 * keelroom tides: the table and the curve for a station.
 */

import type { Command } from 'commander';
import { NotFoundError } from '../../util/errors';
import { makeInterval } from '../../util/interval';
import { MINUTES_PER_DAY } from '../../util/clock';
import { findStation } from '../../domain/chart/district';
import { findExtremes } from '../../domain/tide/extremes';
import { predictSeries } from '../../domain/tide/predict';
import { renderCurve, renderStationSummary, renderTideTable } from '../../report/tide';
import type { Io } from '../output';
import { withDistrict } from '../run';
import { readInteger, readTime } from '../shared';

export function registerTides(program: Command, io: Io): void {
  const tides = program.command('tides').description('tide tables and curves');

  tides
    .command('table <station>')
    .description('high and low water for a station')
    .option('--from <time>', 'start of the range, district local time')
    .option('--days <days>', 'how many days to print', '2')
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, station: string, local: { from?: string; days: string }) => {
          const found = findStation(context.district, station);
          if (found === undefined) {
            throw new NotFoundError('tide station', station);
          }
          const from =
            local.from === undefined
              ? context.now()
              : readTime(local.from, context.district.offset);
          const days = readInteger(local.days, 'days');
          const bounds = makeInterval(from, from + days * MINUTES_PER_DAY);
          const text = [
            renderStationSummary(found),
            '',
            renderTideTable(found, bounds, { offset: context.district.offset }),
          ].join('\n');
          say(text, {
            station: found.id,
            extremes: findExtremes(found, bounds.from, bounds.to),
          });
        },
      ),
    );

  tides
    .command('curve <station>')
    .description('the height of tide through a day')
    .option('--from <time>', 'start of the range, district local time')
    .option('--hours <hours>', 'how many hours to plot', '12')
    .option('--step <minutes>', 'minutes between samples', '30')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          station: string,
          local: { from?: string; hours: string; step: string },
        ) => {
          const found = findStation(context.district, station);
          if (found === undefined) {
            throw new NotFoundError('tide station', station);
          }
          const from =
            local.from === undefined
              ? context.now()
              : readTime(local.from, context.district.offset);
          const hours = readInteger(local.hours, 'hours');
          const step = readInteger(local.step, 'step');
          const bounds = makeInterval(from, from + hours * 60);
          const text = renderCurve(found, bounds, {
            offset: context.district.offset,
            stepMinutes: step,
          });
          say(text, {
            station: found.id,
            samples: predictSeries(found, bounds.from, bounds.to, step),
          });
        },
      ),
    );
}

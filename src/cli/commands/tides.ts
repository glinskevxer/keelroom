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
import { makeSecondary, describeSecondary, secondaryExtremes } from '../../domain/tide/secondary';
import { allSecondary, requireSecondary, saveSecondary } from '../../storage/secondary-store';
import { requireStation } from '../../domain/chart/district';
import { renderTable } from '../../util/table';
import { formatMetres } from '../../util/units';
import { localDate, localTime } from '../../util/clock';
import type { Io } from '../output';
import { readPeriod } from '../period';
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

  tides
    .command('secondary')
    .description('the secondary ports and their corrections')
    .action(
      withDistrict(program, io, ({ context, say }) => {
        const ports = allSecondary(context.db);
        const text = renderTable(
          [
            { heading: 'port' },
            { heading: 'name' },
            { heading: 'standard' },
            { heading: 'hw', align: 'right' },
            { heading: 'lw', align: 'right' },
            { heading: 'hw factor', align: 'right' },
            { heading: 'lw factor', align: 'right' },
          ],
          ports.map((port) => [
            port.id,
            port.name,
            port.standard,
            `${port.highWaterOffset} min`,
            `${port.lowWaterOffset} min`,
            (port.highWaterFactor / 1000).toFixed(2),
            (port.lowWaterFactor / 1000).toFixed(2),
          ]),
          { title: 'secondary ports', empty: 'no secondary ports' },
        );
        say(text, ports);
      }),
    );

  tides
    .command('add-secondary <id> <name> <standard> <hwOffset> <lwOffset>')
    .description('record a secondary port as corrections to a standard one')
    .option('--hw-factor <thousandths>', 'height factor at high water', '1000')
    .option('--lw-factor <thousandths>', 'height factor at low water', '1000')
    .option('--datum <centimetres>', 'shift for a different datum', '0')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          id: string,
          name: string,
          standard: string,
          hwOffset: string,
          lwOffset: string,
          local: { hwFactor: string; lwFactor: string; datum: string },
        ) => {
          requireStation(context.district, standard);
          const port = makeSecondary({
            id,
            name,
            standard,
            highWaterOffset: readInteger(hwOffset, 'high water offset'),
            lowWaterOffset: readInteger(lwOffset, 'low water offset'),
            highWaterFactor: readInteger(local.hwFactor, 'high water factor'),
            lowWaterFactor: readInteger(local.lwFactor, 'low water factor'),
            datumShift: readInteger(local.datum, 'datum shift'),
          });
          saveSecondary(context.db, port);
          say(describeSecondary(port), port);
        },
      ),
    );

  tides
    .command('secondary-table <port>')
    .description('high and low water at a secondary port')
    .option('--from <time>', 'start of the range')
    .option('--days <days>', 'how many days to print', '2')
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, portId: string, local: { from?: string; days: string }) => {
          const port = requireSecondary(context.db, portId);
          const standard = requireStation(context.district, port.standard);
          const period = readPeriod(context, local, { days: 2 });
          const offset = context.district.offset;
          const turns = secondaryExtremes(port, standard, period.from, period.to);
          const text = renderTable(
            [
              { heading: 'date' },
              { heading: 'time' },
              { heading: 'tide' },
              { heading: 'height', align: 'right' },
            ],
            turns.map((turn) => [
              localDate(turn.minute, offset),
              localTime(turn.minute, offset),
              turn.kind === 'high' ? 'HW' : 'LW',
              formatMetres(turn.height),
            ]),
            { title: `${port.id} ${port.name}`, empty: 'no turns of the tide in that range' },
          );
          say(text, { port: port.id, turns });
        },
      ),
    );
}

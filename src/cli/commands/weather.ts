/**
 * keelroom weather: the log the plans are made against.
 */

import type { Command } from 'commander';
import { MINUTES_PER_DAY, formatLocal } from '../../util/clock';
import { renderTable } from '../../util/table';
import { beaufort, makeObservation, readingAt } from '../../domain/weather/observation';
import { saveObservation, weatherBetween } from '../../storage/weather-store';
import type { Io } from '../output';
import { withDistrict } from '../run';
import { readInteger, readMetres, readTime } from '../shared';

export function registerWeather(program: Command, io: Io): void {
  const weather = program.command('weather').description('the weather log');

  weather
    .command('log <wind> <visibility>')
    .description('record an observation')
    .option('--at <time>', 'when it was taken, if not now')
    .option('--direction <degrees>', 'where the wind is from', '0')
    .option('--swell <metres>', 'significant wave height', '0.00')
    .option('--density <thousandths>', 'water density', '1025')
    .option('--forecast', 'this is a forecast rather than an observation')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          wind: string,
          visibility: string,
          local: {
            at?: string;
            direction: string;
            swell: string;
            density: string;
            forecast?: boolean;
          },
        ) => {
          const offset = context.district.offset;
          const observation = makeObservation({
            at: local.at === undefined ? context.now() : readTime(local.at, offset),
            source: local.forecast === true ? 'forecast' : 'observed',
            wind: readInteger(wind, 'wind'),
            direction: readInteger(local.direction, 'direction'),
            visibility: readInteger(visibility, 'visibility'),
            swell: readMetres(local.swell, 'swell'),
            density: readInteger(local.density, 'density'),
          });
          saveObservation(context.db, observation);
          say(
            `${observation.source} at ${formatLocal(observation.at, offset)}: ` +
              `${observation.wind} kn, force ${beaufort(observation.wind)}`,
            observation,
          );
        },
      ),
    );

  weather
    .command('show')
    .description('the log over a period')
    .option('--from <time>', 'start of the period')
    .option('--days <days>', 'how many days', '1')
    .action(
      withDistrict(program, io, ({ context, say }, local: { from?: string; days: string }) => {
        const offset = context.district.offset;
        const from =
          local.from === undefined ? context.now() - MINUTES_PER_DAY : readTime(local.from, offset);
        const to = from + readInteger(local.days, 'days') * MINUTES_PER_DAY;
        const log = weatherBetween(context.db, from, to);
        const text = renderTable(
          [
            { heading: 'when' },
            { heading: 'source' },
            { heading: 'wind', align: 'right' },
            { heading: 'force', align: 'right' },
            { heading: 'from', align: 'right' },
            { heading: 'visibility', align: 'right' },
            { heading: 'swell', align: 'right' },
          ],
          log.map((entry) => [
            formatLocal(entry.at, offset),
            entry.source,
            `${entry.wind} kn`,
            String(beaufort(entry.wind)),
            String(entry.direction).padStart(3, '0'),
            `${entry.visibility} m`,
            `${entry.swell} cm`,
          ]),
          { title: 'weather', empty: 'nothing logged' },
        );
        say(text, log);
      }),
    );

  weather
    .command('at <time>')
    .description('the reading a plan for that time would use')
    .action(
      withDistrict(program, io, ({ context, say }, time: string) => {
        const offset = context.district.offset;
        const at = readTime(time, offset);
        const found = readingAt(
          weatherBetween(context.db, at - 2 * MINUTES_PER_DAY, at + MINUTES_PER_DAY),
          at,
        );
        const text =
          found === undefined
            ? 'nothing in the log, a plan would assume fair weather'
            : `${found.reading.source} ${found.reading.wind} kn, visibility ${found.reading.visibility} m` +
              (found.stale ? ' (and it is an old reading)' : '');
        say(text, found ?? null);
      }),
    );
}

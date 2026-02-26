/**
 * keelroom district: the channel itself, and the files that change it.
 */

import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { formatLocal } from '../../util/clock';
import { formatMetres } from '../../util/units';
import { renderPairs, renderTable } from '../../util/table';
import {
  describeDistrict,
  overheadsOn,
  reachOrder,
  stationForReach,
} from '../../domain/chart/district';
import { isStale, plannedDepth, surveyAgeDays } from '../../domain/chart/reach';
import { renderStationSummary } from '../../report/tide';
import { importHarmonics, importSurveys } from '../../service/imports';
import { buildExport, exportNames } from '../../service/exports';
import { backupTo } from '../../storage/backup';
import { writeFileSync } from 'node:fs';
import { MINUTES_PER_DAY } from '../../util/clock';
import { makeInterval } from '../../util/interval';
import { NotFoundError } from '../../util/errors';
import { readInteger, readTime } from '../shared';
import type { Io } from '../output';
import { withDistrict } from '../run';

export function registerDistrict(program: Command, io: Io): void {
  const district = program.command('district').description('the channel and its charts');

  district
    .command('show')
    .description('the district as the planner sees it')
    .action(
      withDistrict(program, io, ({ context, say }) => {
        const text = [
          renderPairs([
            ['district', context.district.code],
            ['name', context.district.name],
            ['offset', `${context.district.offset} minutes from utc`],
            ['position', `${context.position.latitude}, ${context.position.longitude}`],
            ['reaches', String(context.district.reaches.length)],
            ['berths', String(context.district.berths.length)],
            ['overheads', String(context.district.overheads.length)],
          ]),
          '',
          ...context.district.stations.map((station) => renderStationSummary(station)),
        ].join('\n');
        say(text, {
          district: describeDistrict(context.district),
          reaches: context.district.reaches.map((reach) => reach.id),
        });
      }),
    );

  district
    .command('reaches')
    .description('the reaches seaward first, with the depth the planner uses')
    .action(
      withDistrict(program, io, ({ context, say }) => {
        const rows = context.district.reaches.map((reach) => [
          String(reachOrder(context.district, reach.id)),
          reach.id,
          reach.name,
          formatMetres(reach.chartedDepth),
          formatMetres(plannedDepth(reach, context.now())),
          String(Math.round(surveyAgeDays(reach, context.now()))),
          isStale(reach, context.now()) ? 'stale' : '',
          stationForReach(context.district, reach).id,
          overheadsOn(context.district, reach.id)
            .map((overhead) => overhead.id)
            .join(' '),
        ]);
        const text = renderTable(
          [
            { heading: '#', align: 'right' },
            { heading: 'reach' },
            { heading: 'name' },
            { heading: 'charted', align: 'right' },
            { heading: 'planned', align: 'right' },
            { heading: 'survey age', align: 'right' },
            { heading: '' },
            { heading: 'station' },
            { heading: 'overhead' },
          ],
          rows,
          { title: 'reaches', empty: 'no reaches' },
        );
        say(text, context.district.reaches);
      }),
    );

  district
    .command('berths')
    .description('the berths and what they take')
    .action(
      withDistrict(program, io, ({ context, say }) => {
        const rows = context.district.berths.map((berth) => [
          berth.id,
          berth.name,
          berth.kind,
          berth.reach,
          formatMetres(berth.depth),
          formatMetres(berth.maxLength),
          berth.terminal,
        ]);
        const text = renderTable(
          [
            { heading: 'berth' },
            { heading: 'name' },
            { heading: 'kind' },
            { heading: 'reach' },
            { heading: 'depth', align: 'right' },
            { heading: 'max loa', align: 'right' },
            { heading: 'terminal' },
          ],
          rows,
          { title: 'berths', empty: 'no berths' },
        );
        say(text, context.district.berths);
      }),
    );

  district
    .command('survey <path>')
    .description('apply a survey csv to the reaches it names')
    .action(
      withDistrict(program, io, ({ context, say }, path: string) => {
        const summary = importSurveys(context.db, readFileSync(path, 'utf8'), path);
        say(`${summary.written} reaches resurveyed from ${path}`, summary);
      }),
    );

  district
    .command('harmonics <path>')
    .description('replace the harmonic constants of the stations a csv names')
    .action(
      withDistrict(program, io, ({ context, say }, path: string) => {
        const summary = importHarmonics(context.db, readFileSync(path, 'utf8'), path);
        say(`${summary.written} constants loaded from ${path}`, summary);
      }),
    );

  district
    .command('backup <path>')
    .description('copy the district file, safely, while it is open')
    .action(
      withDistrict(program, io, async ({ context, say }, path: string) => {
        const result = await backupTo(context.db, path);
        const text = renderPairs([
          ['written to', result.path],
          ['bytes', String(result.bytes)],
          ['tables', String(result.tables)],
          ['schema version', String(result.version)],
          ['taken at', formatLocal(context.now(), context.district.offset)],
        ]);
        say(text, result);
      }),
    );

  district
    .command('export <name>')
    .description(`write a csv extract, one of ${exportNames().join(', ')}`)
    .option('--from <time>', 'start of the period')
    .option('--days <days>', 'how many days', '30')
    .option('--to-file <path>', 'write to a file rather than to the terminal')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          name: string,
          local: { from?: string; days: string; toFile?: string },
        ) => {
          const chosen = exportNames().find((each) => each === name);
          if (chosen === undefined) {
            throw new NotFoundError('export', name);
          }
          const offset = context.district.offset;
          const days = readInteger(local.days, 'days');
          const from =
            local.from === undefined
              ? context.now() - days * MINUTES_PER_DAY
              : readTime(local.from, offset);
          const period = makeInterval(from, from + days * MINUTES_PER_DAY);
          const result = buildExport(context, chosen, period);
          if (local.toFile !== undefined) {
            writeFileSync(local.toFile, result.csv);
            say(`wrote ${result.rows} rows to ${local.toFile}`, {
              name: result.name,
              rows: result.rows,
            });
            return;
          }
          say(result.csv.trimEnd(), { name: result.name, rows: result.rows, csv: result.csv });
        },
      ),
    );
}

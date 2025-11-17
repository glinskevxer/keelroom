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
import { backupTo } from '../../storage/backup';
import { closeContext } from '../../service/context';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor } from '../shared';

export function registerDistrict(program: Command, io: Io): void {
  const district = program.command('district').description('the channel and its charts');

  district
    .command('show')
    .description('the district as the planner sees it')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
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
        emit(io, readFormat(options.format), text, {
          district: describeDistrict(context.district),
          reaches: context.district.reaches.map((reach) => reach.id),
        });
      } finally {
        closeContext(context);
      }
    });

  district
    .command('reaches')
    .description('the reaches seaward first, with the depth the planner uses')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
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
        emit(io, readFormat(options.format), text, context.district.reaches);
      } finally {
        closeContext(context);
      }
    });

  district
    .command('berths')
    .description('the berths and what they take')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
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
        emit(io, readFormat(options.format), text, context.district.berths);
      } finally {
        closeContext(context);
      }
    });

  district
    .command('survey <path>')
    .description('apply a survey csv to the reaches it names')
    .action((path: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const summary = importSurveys(context.db, readFileSync(path, 'utf8'), path);
        emit(
          io,
          readFormat(options.format),
          `${summary.written} reaches resurveyed from ${path}`,
          summary,
        );
      } finally {
        closeContext(context);
      }
    });

  district
    .command('harmonics <path>')
    .description('replace the harmonic constants of the stations a csv names')
    .action((path: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const summary = importHarmonics(context.db, readFileSync(path, 'utf8'), path);
        emit(
          io,
          readFormat(options.format),
          `${summary.written} constants loaded from ${path}`,
          summary,
        );
      } finally {
        closeContext(context);
      }
    });

  district
    .command('backup <path>')
    .description('copy the district file, safely, while it is open')
    .action(async (path: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const result = await backupTo(context.db, path);
        const text = renderPairs([
          ['written to', result.path],
          ['bytes', String(result.bytes)],
          ['tables', String(result.tables)],
          ['schema version', String(result.version)],
          ['taken at', formatLocal(context.now(), context.district.offset)],
        ]);
        emit(io, readFormat(options.format), text, result);
      } finally {
        closeContext(context);
      }
    });
}

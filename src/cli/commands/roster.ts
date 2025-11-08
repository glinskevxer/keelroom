/**
 * keelroom board and keelroom pilots: the roster side.
 */

import type { Command } from 'commander';
import { NotFoundError } from '../../util/errors';
import { formatMetres } from '../../util/units';
import { renderPairs, renderTable, bullet } from '../../util/table';
import { makeInterval } from '../../util/interval';
import { renderBoard, boardWarnings, whoIsNext } from '../../report/board';
import { pilotageUnits } from '../../domain/vessel/vessel';
import { makeBoard } from '../../domain/roster/board';
import { qualifies } from '../../domain/roster/qualification';
import {
  activePilots,
  allDuty,
  allPilots,
  dutyFor,
  findPilot,
  leaveFor,
  loadBoard,
  recordLeave,
  saveBoard,
} from '../../storage/roster-store';
import { findVessel } from '../../storage/fleet-store';
import { closeContext } from '../../service/context';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor, readMetres, readTime } from '../shared';

export function registerRoster(program: Command, io: Io): void {
  program
    .command('board')
    .description('the turn board as it stands')
    .option('--warnings', 'print only what wants attention')
    .action((local: { warnings?: boolean }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const board = loadBoard(context.db);
        const warnings = boardWarnings(board);
        if (local.warnings === true) {
          emit(
            io,
            readFormat(options.format),
            warnings.length === 0 ? 'the board is running evenly' : bullet(warnings),
            warnings,
          );
          return;
        }
        const text = [
          renderBoard(board, allPilots(context.db), allDuty(context.db, context.now() - 10080), {
            offset: context.district.offset,
            now: context.now(),
            rules: context.config.rest,
          }),
          '',
          `next up: ${whoIsNext(board)}`,
          ...(warnings.length === 0 ? [] : ['', bullet(warnings)]),
        ].join('\n');
        emit(io, readFormat(options.format), text, { board, warnings });
      } finally {
        closeContext(context);
      }
    });

  program
    .command('board-rebuild')
    .description('draw the board up again in seniority order')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const board = makeBoard(activePilots(context.db));
        saveBoard(context.db, board);
        emit(io, readFormat(options.format), `the board is back in seniority order`, board);
      } finally {
        closeContext(context);
      }
    });

  const pilots = program.command('pilots').description('the pilots and what they hold');

  pilots
    .command('list')
    .description('every pilot on the roster')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const roster = allPilots(context.db);
        const text = renderTable(
          [
            { heading: 'pilot' },
            { heading: 'name' },
            { heading: 'grade' },
            { heading: 'seniority', align: 'right' },
            { heading: 'draught', align: 'right' },
            { heading: 'units', align: 'right' },
            { heading: 'endorsements' },
          ],
          roster.map((pilot) => [
            pilot.id,
            pilot.name,
            pilot.grade,
            String(pilot.seniority),
            formatMetres(pilot.limits.draught),
            String(pilot.limits.units),
            pilot.endorsements.join(' '),
          ]),
          { title: 'pilots', empty: 'nobody on the roster' },
        );
        emit(io, readFormat(options.format), text, roster);
      } finally {
        closeContext(context);
      }
    });

  pilots
    .command('show <id>')
    .description('one pilot, with the duty behind them')
    .action((id: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const pilot = findPilot(context.db, id);
        if (pilot === undefined) {
          throw new NotFoundError('pilot', id);
        }
        const duty = dutyFor(context.db, id);
        const text = renderPairs([
          ['pilot', pilot.id],
          ['name', pilot.name],
          ['grade', pilot.grade],
          ['seniority', String(pilot.seniority)],
          ['draught limit', `${formatMetres(pilot.limits.draught)} m`],
          ['unit limit', String(pilot.limits.units)],
          ['endorsements', pilot.endorsements.join(', ') || 'none'],
          ['jobs on record', String(duty.length)],
          ['active', pilot.active ? 'yes' : 'no'],
        ]);
        emit(io, readFormat(options.format), text, { pilot, jobs: duty.length });
      } finally {
        closeContext(context);
      }
    });

  pilots
    .command('leave <id> <from> <to>')
    .description('record leave for a pilot')
    .option('--reason <text>', 'why')
    .action((id: string, from: string, to: string, local: { reason?: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        if (findPilot(context.db, id) === undefined) {
          throw new NotFoundError('pilot', id);
        }
        const offset = context.district.offset;
        const period = makeInterval(readTime(from, offset), readTime(to, offset));
        recordLeave(context.db, id, period, local.reason);
        emit(io, readFormat(options.format), `${id} is on leave`, {
          pilot: id,
          leave: leaveFor(context.db, id),
        });
      } finally {
        closeContext(context);
      }
    });

  pilots
    .command('who <vessel>')
    .description('who could take this ship at this draught')
    .requiredOption('--draught <metres>', 'the draught she is presented at')
    .option('--night', 'the job runs in the dark')
    .option('--berth <berth>', 'the berth she is going to')
    .action((vessel: string, local: { draught: string; night?: boolean; berth?: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const ship = findVessel(context.db, vessel);
        if (ship === undefined) {
          throw new NotFoundError('vessel', vessel);
        }
        const demand = {
          vessel: ship,
          draught: readMetres(local.draught, 'draught'),
          night: local.night === true,
          ...(local.berth === undefined ? {} : { berth: local.berth }),
        };
        const rows = allPilots(context.db).map((pilot) => {
          const result = qualifies(pilot, demand);
          return [
            pilot.id,
            pilot.name,
            result.qualified ? 'yes' : 'no',
            result.findings
              .filter((finding) => finding.severity === 'block')
              .map((finding) => finding.rule)
              .join(' '),
          ];
        });
        const text = renderTable(
          [
            { heading: 'pilot' },
            { heading: 'name' },
            { heading: 'may take her' },
            { heading: 'why not' },
          ],
          rows,
          { title: `${ship.name}, ${pilotageUnits(ship)} units`, empty: 'nobody on the roster' },
        );
        emit(io, readFormat(options.format), text, rows);
      } finally {
        closeContext(context);
      }
    });
}

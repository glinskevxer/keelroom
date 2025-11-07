/**
 * keelroom dispatch: give the ship to a pilot and follow her through.
 */

import type { Command } from 'commander';
import { InputError } from '../../util/errors';
import { formatDuration, formatLocal } from '../../util/clock';
import { renderPairs } from '../../util/table';
import { detentionBlocks, pilotOnBoardMinutes, waitingMinutes } from '../../domain/movement/times';
import { assignPilot, boardVessel, completeMovement, getUnderway } from '../../service/dispatch';
import { findTimes, requireMovement, saveTimes } from '../../storage/movement-store';
import { closeContext } from '../../service/context';
import type { DelayCause } from '../../domain/movement/times';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor, readTime } from '../shared';

const CAUSES: readonly DelayCause[] = ['vessel', 'berth', 'tug', 'weather', 'district', 'traffic'];

export function registerDispatch(program: Command, io: Io): void {
  const dispatch = program.command('dispatch').description('pilots on and off the ships');

  dispatch
    .command('assign <reference>')
    .description('give a confirmed movement to a pilot')
    .option('--pilot <id>', 'override the board and name a pilot')
    .option('--because <reason>', 'why the board was overridden')
    .action((reference: string, local: { pilot?: string; because?: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const result = assignPilot(context, {
          reference,
          ...(local.pilot === undefined ? {} : { pilot: local.pilot }),
          ...(local.because === undefined ? {} : { override: local.because }),
        });
        const offset = context.district.offset;
        const text = [
          `${reference} to ${result.pilot.id} ${result.pilot.name}`,
          `on duty ${formatLocal(result.period.from, offset)} to ${formatLocal(result.period.to, offset)}`,
          ...result.passes.map((pass) => `passed over ${pass.pilot} (${pass.reason})`),
        ].join('\n');
        emit(io, readFormat(options.format), text, {
          reference,
          pilot: result.pilot.id,
          period: result.period,
          passes: result.passes,
        });
      } finally {
        closeContext(context);
      }
    });

  dispatch
    .command('boarded <reference>')
    .description('the pilot is on board')
    .option('--at <time>', 'when, if not now')
    .action((reference: string, local: { at?: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const at =
          local.at === undefined ? context.now() : readTime(local.at, context.district.offset);
        const movement = boardVessel(context, reference, at);
        emit(io, readFormat(options.format), `${reference} boarded`, movement);
      } finally {
        closeContext(context);
      }
    });

  dispatch
    .command('underway <reference>')
    .description('she has let go')
    .option('--at <time>', 'when, if not now')
    .action((reference: string, local: { at?: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const at =
          local.at === undefined ? context.now() : readTime(local.at, context.district.offset);
        const movement = getUnderway(context, reference, at);
        emit(io, readFormat(options.format), `${reference} underway`, movement);
      } finally {
        closeContext(context);
      }
    });

  dispatch
    .command('complete <reference>')
    .description('she is all fast and the pilot is off')
    .option('--at <time>', 'when, if not now')
    .action((reference: string, local: { at?: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const at =
          local.at === undefined ? context.now() : readTime(local.at, context.district.offset);
        const movement = completeMovement(context, reference, at);
        const times = findTimes(context.db, reference);
        const text =
          times === undefined
            ? `${reference} complete`
            : renderPairs([
                ['movement', reference],
                ['pilot', movement.pilot ?? 'none'],
                ['waiting', formatDuration(waitingMinutes(times))],
                ['on board', formatDuration(pilotOnBoardMinutes(times))],
                ['detention blocks', String(detentionBlocks(times, context.config.detention))],
              ]);
        emit(io, readFormat(options.format), text, { movement, times });
      } finally {
        closeContext(context);
      }
    });

  dispatch
    .command('delay <reference> <cause> <from> <to>')
    .description('record a delay against a movement')
    .option('--note <text>', 'what happened')
    .action(
      (reference: string, cause: string, from: string, to: string, local: { note?: string }) => {
        const options = program.opts<GlobalOptions>();
        const context = openFor(options);
        try {
          const offset = context.district.offset;
          const movement = requireMovement(context.db, reference);
          const times = findTimes(context.db, reference) ?? {
            orderedFor: movement.plannedFor ?? movement.requestedFor,
          };
          const chosen = CAUSES.find((each) => each === cause);
          if (chosen === undefined) {
            throw new InputError(`a delay cause is one of ${CAUSES.join(', ')}, got ${cause}`);
          }
          const delay = {
            cause: chosen,
            from: readTime(from, offset),
            to: readTime(to, offset),
            ...(local.note === undefined ? {} : { note: local.note }),
          };
          const updated = { ...times, delays: [...(times.delays ?? []), delay] };
          saveTimes(context.db, reference, updated);
          emit(io, readFormat(options.format), `${reference} delayed by ${cause}`, updated);
        } finally {
          closeContext(context);
        }
      },
    );
}

/**
 * keelroom advice: the questions asked before anything is ordered.
 */

import type { Command } from 'commander';
import { MINUTES_PER_DAY, formatDuration, localDate, localTime } from '../../util/clock';
import { makeInterval } from '../../util/interval';
import { formatMetres } from '../../util/units';
import { renderTable } from '../../util/table';
import { adviseAt, bestDay, deepestForWindow, draughtLadder } from '../../service/advice';
import { studyDredging, worstReach } from '../../service/dredging';
import { closeContext } from '../../service/context';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor, readInteger, readMetres, readTime } from '../shared';

export function registerAdvice(program: Command, io: Io): void {
  const advice = program.command('advice').description('what a ship could do, before she orders');

  advice
    .command('draught <vessel> <berth>')
    .description('what each draught buys her over a period')
    .option('--from <time>', 'start of the period')
    .option('--days <days>', 'how many days', '2')
    .option('--low <metres>', 'the lightest draught to try', '8.00')
    .option('--high <metres>', 'the deepest', '13.00')
    .option('--step <metres>', 'how far apart the rungs are', '0.20')
    .option('--outbound', 'she is sailing rather than arriving')
    .action(
      (
        vessel: string,
        berth: string,
        local: {
          from?: string;
          days: string;
          low: string;
          high: string;
          step: string;
          outbound?: boolean;
        },
      ) => {
        const options = program.opts<GlobalOptions>();
        const context = openFor(options);
        try {
          const offset = context.district.offset;
          const from = local.from === undefined ? context.now() : readTime(local.from, offset);
          const period = makeInterval(
            from,
            from + readInteger(local.days, 'days') * MINUTES_PER_DAY,
          );
          const request = {
            vessel,
            berth,
            direction: local.outbound === true ? ('outbound' as const) : ('inbound' as const),
            period,
          };
          const ladder = draughtLadder(
            context,
            request,
            readMetres(local.low, 'low'),
            readMetres(local.high, 'high'),
            readMetres(local.step, 'step'),
          );
          const text = renderTable(
            [
              { heading: 'draught', align: 'right' },
              { heading: 'window', align: 'right' },
              { heading: 'first', align: 'right' },
            ],
            ladder.steps.map((step) => [
              formatMetres(step.draught),
              formatDuration(step.windowMinutes),
              step.windows[0] === undefined ? 'none' : localTime(step.windows[0].from, offset),
            ]),
            { title: `${vessel} to ${berth}`, empty: 'nothing to advise' },
          );
          emit(io, readFormat(options.format), text, ladder);
        } finally {
          closeContext(context);
        }
      },
    );

  advice
    .command('deepest <vessel> <berth>')
    .description('the deepest she can come and still have a window worth having')
    .option('--from <time>', 'start of the period')
    .option('--days <days>', 'how many days', '2')
    .option('--want <minutes>', 'how long a window she wants', '60')
    .option('--outbound', 'she is sailing rather than arriving')
    .action(
      (
        vessel: string,
        berth: string,
        local: { from?: string; days: string; want: string; outbound?: boolean },
      ) => {
        const options = program.opts<GlobalOptions>();
        const context = openFor(options);
        try {
          const offset = context.district.offset;
          const from = local.from === undefined ? context.now() : readTime(local.from, offset);
          const period = makeInterval(
            from,
            from + readInteger(local.days, 'days') * MINUTES_PER_DAY,
          );
          const request = {
            vessel,
            berth,
            direction: local.outbound === true ? ('outbound' as const) : ('inbound' as const),
            period,
          };
          const want = readInteger(local.want, 'want');
          const deepest = deepestForWindow(context, request, want, { lowest: 300, highest: 2200 });
          const text =
            deepest === undefined
              ? 'she has no window at any draught in the range'
              : `deepest ${formatMetres(deepest)} m for a window of ${formatDuration(
                  adviseAt(context, request, deepest).windowMinutes,
                )}`;
          emit(io, readFormat(options.format), text, { vessel, berth, deepest: deepest ?? null });
        } finally {
          closeContext(context);
        }
      },
    );

  advice
    .command('days <vessel> <berth> <draught>')
    .description('the best days of the next several for a ship at a draught')
    .option('--from <time>', 'start looking here')
    .option('--days <days>', 'how many days to look over', '7')
    .action(
      (vessel: string, berth: string, draught: string, local: { from?: string; days: string }) => {
        const options = program.opts<GlobalOptions>();
        const context = openFor(options);
        try {
          const offset = context.district.offset;
          const from = local.from === undefined ? context.now() : readTime(local.from, offset);
          const found = bestDay(
            context,
            { vessel, berth, direction: 'inbound' },
            readMetres(draught, 'draught'),
            from,
            readInteger(local.days, 'days'),
          );
          const text = renderTable(
            [{ heading: 'day' }, { heading: 'window', align: 'right' }],
            found.map((each) => [localDate(each.day, offset), formatDuration(each.minutes)]),
            { title: `${vessel} at ${draught} m`, empty: 'nothing to advise' },
          );
          emit(io, readFormat(options.format), text, found);
        } finally {
          closeContext(context);
        }
      },
    );

  advice
    .command('dredging')
    .description('which reach would buy the most window if it were deepened')
    .option('--from <time>', 'start of the period')
    .option('--days <days>', 'how many days of movements to study', '7')
    .option('--by <metres>', 'how much deeper to try', '0.30')
    .action((local: { from?: string; days: string; by: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const offset = context.district.offset;
        const from = local.from === undefined ? context.now() : readTime(local.from, offset);
        const period = makeInterval(from, from + readInteger(local.days, 'days') * MINUTES_PER_DAY);
        const study = studyDredging(context, period, readMetres(local.by, 'by'));
        const text = [
          renderTable(
            [
              { heading: 'reach' },
              { heading: 'window gained', align: 'right' },
              { heading: 'movements blocked', align: 'right' },
            ],
            study.reaches.map((reach) => [
              reach.reach,
              formatDuration(reach.minutesGained),
              String(reach.movementsBlocked),
            ]),
            {
              title: `deepening by ${formatMetres(study.deepenBy)} m over ${study.movements} movements`,
              empty: 'no reaches',
            },
          ),
          '',
          worstReach(study) === undefined
            ? 'nothing to dredge'
            : `dredge ${worstReach(study)?.reach} first`,
        ].join('\n');
        emit(io, readFormat(options.format), text, study);
      } finally {
        closeContext(context);
      }
    });
}

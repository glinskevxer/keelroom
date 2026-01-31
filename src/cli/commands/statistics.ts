/**
 * keelroom stats: the return the district sends the board.
 */

import type { Command } from 'commander';
import { MINUTES_PER_DAY } from '../../util/clock';
import { makeInterval } from '../../util/interval';
import { renderReturn, returnHeadline } from '../../report/statistics';
import { comparePeriods, districtReturn } from '../../service/statistics';
import { closeContext } from '../../service/context';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor, readInteger, readTime } from '../shared';

export function registerStatistics(program: Command, io: Io): void {
  const stats = program.command('stats').description('what the district did');

  stats
    .command('return')
    .description('the return for a period')
    .option('--from <time>', 'start of the period')
    .option('--days <days>', 'how many days', '30')
    .option('--headline', 'one line rather than the whole return')
    .action((local: { from?: string; days: string; headline?: boolean }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const offset = context.district.offset;
        const days = readInteger(local.days, 'days');
        const from =
          local.from === undefined
            ? context.now() - days * MINUTES_PER_DAY
            : readTime(local.from, offset);
        const period = makeInterval(from, from + days * MINUTES_PER_DAY);
        const result = districtReturn(context, period);
        const text =
          local.headline === true ? returnHeadline(result) : renderReturn(result, { offset });
        emit(io, readFormat(options.format), text, result);
      } finally {
        closeContext(context);
      }
    });

  stats
    .command('compare')
    .description('a period against the one a year earlier')
    .option('--from <time>', 'start of the period')
    .option('--days <days>', 'how many days', '30')
    .action((local: { from?: string; days: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const offset = context.district.offset;
        const days = readInteger(local.days, 'days');
        const from =
          local.from === undefined
            ? context.now() - days * MINUTES_PER_DAY
            : readTime(local.from, offset);
        const period = makeInterval(from, from + days * MINUTES_PER_DAY);
        const earlier = makeInterval(
          from - 365 * MINUTES_PER_DAY,
          from - (365 - days) * MINUTES_PER_DAY,
        );
        const comparison = comparePeriods(context, period, earlier);
        const text = [
          `this period: ${returnHeadline(comparison.now)}`,
          `a year ago:  ${returnHeadline(comparison.then)}`,
          `movements ${comparison.movementChange >= 0 ? 'up' : 'down'} by ${Math.abs(comparison.movementChange)}`,
        ].join('\n');
        emit(io, readFormat(options.format), text, comparison);
      } finally {
        closeContext(context);
      }
    });
}

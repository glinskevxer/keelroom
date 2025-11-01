/**
 * keelroom plan: when can she go, and confirm it.
 */

import type { Command } from 'commander';
import { makeInterval } from '../../util/interval';
import { formatLocal } from '../../util/clock';
import { renderPlan, planHeadline } from '../../report/plan';
import { movementsInWindow } from '../../storage/movement-store';
import { confirmMovement, planMovement, FAIR_WEATHER } from '../../service/planning';
import type { Conditions } from '../../service/planning';
import { closeContext } from '../../service/context';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor, readInteger, readMetres, readTime } from '../shared';

interface WeatherOptions {
  readonly wind?: string;
  readonly visibility?: string;
  readonly swell?: string;
  readonly density?: string;
}

function conditionsFrom(local: WeatherOptions): Conditions {
  return {
    transit: {
      density:
        local.density === undefined
          ? FAIR_WEATHER.transit.density
          : readInteger(local.density, 'density'),
      waveHeight:
        local.swell === undefined
          ? FAIR_WEATHER.transit.waveHeight
          : readMetres(local.swell, 'swell'),
      speed: FAIR_WEATHER.transit.speed,
    },
    movement: {
      wind: local.wind === undefined ? FAIR_WEATHER.movement.wind : readInteger(local.wind, 'wind'),
      visibility:
        local.visibility === undefined
          ? FAIR_WEATHER.movement.visibility
          : readInteger(local.visibility, 'visibility'),
    },
  };
}

export function registerPlan(program: Command, io: Io): void {
  const plan = program.command('plan').description('transit windows');

  plan
    .command('show <reference>')
    .description('the windows for one movement and why they are that shape')
    .option('--hours <hours>', 'how far either side of the time asked for to look', '12')
    .option('--from <time>', 'look from this time instead')
    .option('--to <time>', 'and up to this one')
    .option('--wind <knots>', 'wind for the plan')
    .option('--visibility <metres>', 'visibility for the plan')
    .option('--swell <metres>', 'significant wave height')
    .option('--density <thousandths>', 'water density, salt water being 1025')
    .action(
      (
        reference: string,
        local: WeatherOptions & { hours: string; from?: string; to?: string },
      ) => {
        const options = program.opts<GlobalOptions>();
        const context = openFor(options);
        try {
          const offset = context.district.offset;
          const bounds =
            local.from === undefined || local.to === undefined
              ? undefined
              : makeInterval(readTime(local.from, offset), readTime(local.to, offset));
          const result = planMovement(context, {
            reference,
            searchHours: readInteger(local.hours, 'hours'),
            conditions: conditionsFrom(local),
            ...(bounds === undefined ? {} : { bounds }),
          });
          emit(io, readFormat(options.format), renderPlan(result.result, { offset }), {
            reference,
            windows: result.result.windows,
            findings: result.result.findings,
            restrictions: result.result.restrictions,
          });
        } finally {
          closeContext(context);
        }
      },
    );

  plan
    .command('confirm <reference>')
    .description('confirm a movement against a window')
    .option('--at <time>', 'start at this time rather than the best window')
    .option('--hours <hours>', 'how far either side to look', '12')
    .action((reference: string, local: { at?: string; hours: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const offset = context.district.offset;
        const confirmation = confirmMovement(context, {
          reference,
          searchHours: readInteger(local.hours, 'hours'),
          ...(local.at === undefined ? {} : { startAt: readTime(local.at, offset) }),
        });
        const text = `${reference} confirmed for ${formatLocal(confirmation.startAt, offset)}`;
        emit(io, readFormat(options.format), text, {
          reference,
          startAt: confirmation.startAt,
          movement: confirmation.movement,
        });
      } finally {
        closeContext(context);
      }
    });

  plan
    .command('sweep')
    .description('a headline for every movement that has no planned time yet')
    .option('--days <days>', 'how far ahead to look', '2')
    .action((local: { days: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const offset = context.district.offset;
        const days = readInteger(local.days, 'days');
        const movements = movementsInWindow(
          context.db,
          context.now(),
          context.now() + days * 1440,
        ).filter((movement) => movement.status === 'ordered');
        const lines = movements.map((movement) => {
          const result = planMovement(context, { reference: movement.reference });
          return `${movement.reference} ${movement.vessel} ${planHeadline(result.result, { offset })}`;
        });
        emit(
          io,
          readFormat(options.format),
          lines.length === 0 ? 'nothing waiting to be planned' : lines.join('\n'),
          movements.map((movement) => movement.reference),
        );
      } finally {
        closeContext(context);
      }
    });
}

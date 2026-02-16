/**
 * keelroom orders: taking them, listing them and closing them.
 */

import type { Command } from 'commander';
import { NotFoundError } from '../../util/errors';
import { MINUTES_PER_DAY, formatLocal, localDate } from '../../util/clock';
import { formatMetres } from '../../util/units';
import { describeFinding } from '../../util/finding';
import { renderPairs } from '../../util/table';
import type { MovementKind } from '../../domain/movement/movement';
import { noticeHours } from '../../domain/movement/movement';
import { nextStates } from '../../domain/movement/lifecycle';
import { renderCounts, countByState, renderOrders } from '../../report/orders';
import {
  findMovement,
  findTimes,
  movementsForAgent,
  movementsInWindow,
} from '../../storage/movement-store';
import { allVessels } from '../../storage/fleet-store';
import { amendOrder, cancelOrder, placeOrder, refuseOrder } from '../../service/ordering';
import type { Context } from '../../service/context';
import type { Io } from '../output';
import { withDistrict } from '../run';
import { readMetres, readTime } from '../shared';

const KINDS: MovementKind[] = ['arrival', 'departure', 'shift', 'anchorage', 'swing'];

function vesselNames(context: Context): Record<string, string> {
  return Object.fromEntries(allVessels(context.db).map((ship) => [ship.imo, ship.name]));
}

export function registerOrders(program: Command, io: Io): void {
  const orders = program.command('orders').description('the order book');

  orders
    .command('place <vessel> <agent>')
    .description('take an order from an agent')
    .requiredOption('--kind <kind>', `one of ${KINDS.join(', ')}`)
    .requiredOption('--from <place>', 'where she starts')
    .requiredOption('--to <place>', 'where she is going')
    .requiredOption('--draught <metres>', 'the draught the agent declares')
    .requiredOption('--at <time>', 'the time the agent wants')
    .option('--note <text>', 'anything to record with the order')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          vessel: string,
          agent: string,
          local: {
            kind: string;
            from: string;
            to: string;
            draught: string;
            at: string;
            note?: string;
          },
        ) => {
          const kind = KINDS.find((each) => each === local.kind);
          if (kind === undefined) {
            throw new NotFoundError('movement kind', local.kind);
          }
          const result = placeOrder(context, {
            kind,
            vessel,
            agent,
            from: local.from,
            to: local.to,
            draught: readMetres(local.draught, 'draught'),
            requestedFor: readTime(local.at, context.district.offset),
            ...(local.note === undefined ? {} : { notes: [local.note] }),
          });
          const text = [
            `taken as ${result.movement.reference}`,
            ...result.findings.map(describeFinding),
          ].join('\n');
          say(text, result);
        },
      ),
    );

  orders
    .command('list')
    .description('what is on the book')
    .option('--from <time>', 'start of the range')
    .option('--days <days>', 'how many days to show', '2')
    .option('--agent <agent>', 'only this agent')
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, local: { from?: string; days: string; agent?: string }) => {
          const from =
            local.from === undefined
              ? context.now()
              : readTime(local.from, context.district.offset);
          const to = from + Number(local.days) * MINUTES_PER_DAY;
          const movements =
            local.agent === undefined
              ? movementsInWindow(context.db, from, to)
              : movementsForAgent(context.db, local.agent).filter(
                  (movement) =>
                    (movement.plannedFor ?? movement.requestedFor) >= from &&
                    (movement.plannedFor ?? movement.requestedFor) <= to,
                );
          const text = [
            renderOrders(movements, {
              offset: context.district.offset,
              title: `orders from ${localDate(from, context.district.offset)}`,
              withDate: true,
              names: vesselNames(context),
            }),
            '',
            renderCounts(countByState(movements)),
          ].join('\n');
          say(text, movements);
        },
      ),
    );

  orders
    .command('show <reference>')
    .description('one movement in full')
    .action(
      withDistrict(program, io, ({ context, say }, reference: string) => {
        const movement = findMovement(context.db, reference);
        if (movement === undefined) {
          throw new NotFoundError('movement', reference);
        }
        const times = findTimes(context.db, reference);
        const offset = context.district.offset;
        const pairs: [string, string][] = [
          ['reference', movement.reference],
          ['status', movement.status],
          ['next states', nextStates(movement.status).join(', ') || 'none, it is closed'],
          ['vessel', movement.vessel],
          ['agent', movement.agent],
          ['kind', movement.kind],
          ['route', `${movement.from} to ${movement.to}`],
          ['draught', `${formatMetres(movement.draught)} m`],
          ['ordered', formatLocal(movement.orderedAt, offset)],
          ['wanted', formatLocal(movement.requestedFor, offset)],
          ['notice', `${noticeHours(movement)} h`],
          [
            'planned',
            movement.plannedFor === undefined
              ? 'not yet'
              : formatLocal(movement.plannedFor, offset),
          ],
          ['pilot', movement.pilot ?? 'not assigned'],
          ['tugs', String(movement.tugs)],
        ];
        if (times?.boarded !== undefined) {
          pairs.push(['boarded', formatLocal(times.boarded, offset)]);
        }
        if (times?.allFast !== undefined) {
          pairs.push(['all fast', formatLocal(times.allFast, offset)]);
        }
        const text = [renderPairs(pairs), ...movement.notes.map((note) => `- ${note}`)].join('\n');
        say(text, { movement, times });
      }),
    );

  orders
    .command('amend <reference>')
    .description('change the time or the draught on an order')
    .option('--at <time>', 'a new time')
    .option('--draught <metres>', 'a new draught')
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, reference: string, local: { at?: string; draught?: string }) => {
          const movement = amendOrder(context, reference, {
            ...(local.at === undefined
              ? {}
              : { requestedFor: readTime(local.at, context.district.offset) }),
            ...(local.draught === undefined
              ? {}
              : { draught: readMetres(local.draught, 'draught') }),
          });
          say(`amended ${movement.reference}`, movement);
        },
      ),
    );

  orders
    .command('cancel <reference> <reason...>')
    .description('cancel an order')
    .action(
      withDistrict(program, io, ({ context, say }, reference: string, reason: string[]) => {
        const movement = cancelOrder(context, reference, reason.join(' '));
        say(`cancelled ${movement.reference}`, movement);
      }),
    );

  orders
    .command('refuse <reference> <reason...>')
    .description('refuse an order the district cannot take')
    .action(
      withDistrict(program, io, ({ context, say }, reference: string, reason: string[]) => {
        const movement = refuseOrder(context, reference, reason.join(' '));
        say(`refused ${movement.reference}`, movement);
      }),
    );
}

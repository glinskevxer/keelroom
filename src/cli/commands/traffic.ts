/**
 * keelroom traffic: who is where, and who meets whom.
 */

import type { Command } from 'commander';
import { formatLocal, localTime } from '../../util/clock';
import { renderTable } from '../../util/table';
import { checkAgainstTraffic, firstClearStart, trafficFor } from '../../service/traffic';
import { requireMovement } from '../../storage/movement-store';
import type { Io } from '../output';
import { readPeriod } from '../period';
import { withDistrict } from '../run';
import { readInteger, readTime } from '../shared';

export function registerTraffic(program: Command, io: Io): void {
  const traffic = program.command('traffic').description('the channel, reach by reach');

  traffic
    .command('day')
    .description('who is in which reach and where they meet')
    .option('--from <time>', 'start of the day')
    .option('--days <days>', 'how many days', '1')
    .action(
      withDistrict(program, io, ({ context, say }, local: { from?: string; days: string }) => {
        const offset = context.district.offset;
        const period = readPeriod(context, local, { days: 1 });
        const day = trafficFor(context, period);
        const occupancy = renderTable(
          [
            { heading: 'reach' },
            { heading: 'movement' },
            { heading: 'way' },
            { heading: 'from' },
            { heading: 'to' },
          ],
          [...day.occupancies]
            .sort((a, b) => a.reach.localeCompare(b.reach) || a.period.from - b.period.from)
            .map((each) => [
              each.reach,
              each.movement,
              each.direction,
              localTime(each.period.from, offset),
              localTime(each.period.to, offset),
            ]),
          { title: 'occupancy', empty: 'nothing planned' },
        );
        const meetings = renderTable(
          [
            { heading: 'kind' },
            { heading: 'reach' },
            { heading: 'first' },
            { heading: 'second' },
            { heading: 'from' },
            { heading: 'to' },
          ],
          day.conflicts.map((conflict) => [
            conflict.kind,
            conflict.reach,
            conflict.first,
            conflict.second,
            localTime(conflict.period.from, offset),
            localTime(conflict.period.to, offset),
          ]),
          { title: 'where they meet', empty: 'nobody meets anybody' },
        );
        say(`${occupancy}\n\n${meetings}`, day);
      }),
    );

  traffic
    .command('check <reference>')
    .description('what a movement would run into at a start time')
    .option('--at <time>', 'the start to test, defaulting to the planned time')
    .action(
      withDistrict(program, io, ({ context, say }, reference: string, local: { at?: string }) => {
        const offset = context.district.offset;
        const movement = requireMovement(context.db, reference);
        const startAt =
          local.at === undefined
            ? (movement.plannedFor ?? movement.requestedFor)
            : readTime(local.at, offset);
        const found = checkAgainstTraffic(context, reference, startAt);
        const text =
          found.length === 0
            ? `${reference} at ${formatLocal(startAt, offset)} runs into nothing`
            : found
                .map(
                  (conflict) =>
                    `${conflict.kind} with ${conflict.second === reference ? conflict.first : conflict.second} in ${conflict.reach}`,
                )
                .join('\n');
        say(text, { reference, startAt, conflicts: found });
      }),
    );

  traffic
    .command('clear <reference>')
    .description('the first start after a time that runs into nothing')
    .option('--from <time>', 'where to start looking')
    .option('--step <minutes>', 'how far apart to try', '15')
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, reference: string, local: { from?: string; step: string }) => {
          const offset = context.district.offset;
          const movement = requireMovement(context.db, reference);
          const from =
            local.from === undefined
              ? (movement.plannedFor ?? movement.requestedFor)
              : readTime(local.from, offset);
          const found = firstClearStart(context, reference, from, {
            step: readInteger(local.step, 'step'),
          });
          const text =
            found === undefined
              ? 'nothing inside the next few hours is clear'
              : `${reference} is clear from ${formatLocal(found, offset)}`;
          say(text, { reference, startAt: found ?? null });
        },
      ),
    );
}

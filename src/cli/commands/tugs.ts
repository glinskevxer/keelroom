/**
 * keelroom tugs: the fleet, and what is booked against it.
 */

import type { Command } from 'commander';
import { NotFoundError } from '../../util/errors';
import { localTime } from '../../util/clock';
import { renderPairs, renderTable } from '../../util/table';
import { makeTug } from '../../domain/tug/tug';
import { byOwner, fleetPull } from '../../domain/tug/tug';
import { allTugs, bookingsInPeriod, saveTug } from '../../storage/tug-store';
import { bookForMovement, heldBy, offerTugs, releaseForMovement } from '../../service/towage';
import type { Io } from '../output';
import { readPeriod } from '../period';
import { withDistrict } from '../run';
import { readInteger } from '../shared';

export function registerTugs(program: Command, io: Io): void {
  const tugs = program.command('tugs').description('the towage fleet');

  tugs
    .command('list')
    .description('the fleet and what it pulls')
    .action(
      withDistrict(program, io, ({ context, say }) => {
        const fleet = allTugs(context.db);
        const text = [
          renderTable(
            [
              { heading: 'tug' },
              { heading: 'name' },
              { heading: 'owner' },
              { heading: 'pull', align: 'right' },
              { heading: 'escort' },
              { heading: '' },
            ],
            fleet.map((tug) => [
              tug.id,
              tug.name,
              tug.owner,
              `${tug.pull} t`,
              tug.escort ? 'yes' : '',
              tug.active ? '' : 'laid up',
            ]),
            { title: 'tugs', empty: 'no tugs on the list' },
          ),
          '',
          `${fleetPull(fleet)} tonnes across ${Object.keys(byOwner(fleet)).length} owners`,
        ].join('\n');
        say(text, fleet);
      }),
    );

  tugs
    .command('add <id> <name> <owner> <pull>')
    .description('put a tug on the list')
    .option('--escort', 'she is fitted for escort work')
    .option('--laid-up', 'she is not available')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          id: string,
          name: string,
          owner: string,
          pull: string,
          local: { escort?: boolean; laidUp?: boolean },
        ) => {
          const tug = makeTug({
            id,
            name,
            owner,
            pull: readInteger(pull, 'pull'),
            escort: local.escort === true,
            active: local.laidUp !== true,
          });
          saveTug(context.db, tug);
          say(`${tug.id} ${tug.name} on the list`, tug);
        },
      ),
    );

  tugs
    .command('offer <reference>')
    .description('what could be raised for a movement, without booking it')
    .action(
      withDistrict(program, io, ({ context, say }, reference: string) => {
        const offer = offerTugs(context, reference);
        const text = renderPairs([
          ['movement', reference],
          ['hulls wanted', String(offer.demand.count)],
          ['pull wanted', `${offer.demand.pull} t`],
          ['escort wanted', offer.demand.escort === true ? 'yes' : 'no'],
          ['offered', offer.tugs.map((tug) => tug.id).join(' ') || 'none'],
          ['pull offered', `${offer.pull} t`],
          ['met', offer.met ? 'yes' : `no, ${offer.reason ?? 'unknown'}`],
        ]);
        say(text, offer);
      }),
    );

  tugs
    .command('book <reference>')
    .description('take the tugs for a movement')
    .action(
      withDistrict(program, io, ({ context, say }, reference: string) => {
        const result = bookForMovement(context, reference);
        say(`${reference} has ${result.tugs.map((tug) => tug.id).join(' ')}`, result);
      }),
    );

  tugs
    .command('release <reference>')
    .description('give the tugs back')
    .action(
      withDistrict(program, io, ({ context, say }, reference: string) => {
        const released = releaseForMovement(context, reference);
        say(`${released} tugs released`, {
          reference,
          released,
          held: heldBy(context, reference),
        });
      }),
    );

  tugs
    .command('booked')
    .description('what is booked over a period')
    .option('--from <time>', 'start of the period')
    .option('--days <days>', 'how many days', '1')
    .action(
      withDistrict(program, io, ({ context, say }, local: { from?: string; days: string }) => {
        const offset = context.district.offset;
        const period = readPeriod(context, local, { days: 1 });
        const bookings = bookingsInPeriod(context.db, period);
        const text = renderTable(
          [{ heading: 'tug' }, { heading: 'movement' }, { heading: 'from' }, { heading: 'to' }],
          bookings.map((booking) => [
            booking.tug,
            booking.movement,
            localTime(booking.period.from, offset),
            localTime(booking.period.to, offset),
          ]),
          { title: 'tug bookings', empty: 'nothing booked' },
        );
        say(text, bookings);
      }),
    );

  tugs
    .command('show <id>')
    .description('one tug')
    .action(
      withDistrict(program, io, ({ context, say }, id: string) => {
        const tug = allTugs(context.db).find((each) => each.id === id);
        if (tug === undefined) {
          throw new NotFoundError('tug', id);
        }
        say(
          renderPairs([
            ['tug', tug.id],
            ['name', tug.name],
            ['owner', tug.owner],
            ['pull', `${tug.pull} t`],
            ['escort fitted', tug.escort ? 'yes' : 'no'],
            ['available', tug.active ? 'yes' : 'no'],
          ]),
          tug,
        );
      }),
    );
}

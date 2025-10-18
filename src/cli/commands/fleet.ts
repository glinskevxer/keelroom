/**
 * keelroom vessels and keelroom agents: the two reference lists the desk keeps.
 */

import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { NotFoundError } from '../../util/errors';
import { formatMetres, formatMoney } from '../../util/units';
import { renderPairs, renderTable } from '../../util/table';
import {
  carriesDangerousCargo,
  describeVessel,
  displacement,
  pilotageUnits,
  sizeClass,
} from '../../domain/vessel/vessel';
import { describeAccount } from '../../domain/billing/account';
import {
  allAccounts,
  allVessels,
  findAccount,
  findVessel,
  vesselsNamed,
} from '../../storage/fleet-store';
import { importAccounts, importVessels } from '../../service/imports';
import { closeContext } from '../../service/context';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor } from '../shared';

export function registerFleet(program: Command, io: Io): void {
  const vessels = program.command('vessels').description('the ships the district knows');

  vessels
    .command('list')
    .description('every ship on the books')
    .option('--name <prefix>', 'only ships whose name starts with this')
    .action((local: { name?: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const ships =
          local.name === undefined ? allVessels(context.db) : vesselsNamed(context.db, local.name);
        const text = renderTable(
          [
            { heading: 'imo' },
            { heading: 'name' },
            { heading: 'type' },
            { heading: 'loa', align: 'right' },
            { heading: 'beam', align: 'right' },
            { heading: 'draught', align: 'right' },
            { heading: 'units', align: 'right' },
          ],
          ships.map((ship) => [
            ship.imo,
            ship.name,
            ship.type,
            formatMetres(ship.length),
            formatMetres(ship.beam),
            formatMetres(ship.summerDraught),
            String(pilotageUnits(ship)),
          ]),
          { title: 'vessels', empty: 'no ships on the books' },
        );
        emit(io, readFormat(options.format), text, ships);
      } finally {
        closeContext(context);
      }
    });

  vessels
    .command('show <imo>')
    .description('one ship in full')
    .action((imo: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const ship = findVessel(context.db, imo);
        if (ship === undefined) {
          throw new NotFoundError('vessel', imo);
        }
        const text = renderPairs([
          ['imo', ship.imo],
          ['name', ship.name],
          ['type', ship.type],
          ['length', `${formatMetres(ship.length)} m`],
          ['beam', `${formatMetres(ship.beam)} m`],
          ['summer draught', `${formatMetres(ship.summerDraught)} m`],
          ['air draught', `${formatMetres(ship.airDraught)} m`],
          ['gross tonnage', String(ship.grossTonnage)],
          ['deadweight', String(ship.deadweight)],
          ['block coefficient', (ship.blockCoefficient / 1000).toFixed(3)],
          ['displacement', `${displacement(ship)} t`],
          ['pilotage units', String(pilotageUnits(ship))],
          ['size class', sizeClass(ship)],
          ['bow thruster', ship.bowThruster ? 'yes' : 'no'],
          ['dangerous cargo', carriesDangerousCargo(ship) ? 'yes' : 'no'],
        ]);
        emit(io, readFormat(options.format), text, {
          ...ship,
          units: pilotageUnits(ship),
          summary: describeVessel(ship),
        });
      } finally {
        closeContext(context);
      }
    });

  vessels
    .command('import <path>')
    .description('load ship particulars from a csv file')
    .action((path: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const summary = importVessels(context.db, readFileSync(path, 'utf8'), path);
        emit(
          io,
          readFormat(options.format),
          `wrote ${summary.written} ships from ${path}`,
          summary,
        );
      } finally {
        closeContext(context);
      }
    });

  const agents = program.command('agents').description('the agents who order movements');

  agents
    .command('list')
    .description('every account')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const accounts = allAccounts(context.db);
        const text = renderTable(
          [
            { heading: 'agent' },
            { heading: 'name' },
            { heading: 'terms', align: 'right' },
            { heading: 'discount', align: 'right' },
            { heading: 'limit', align: 'right' },
            { heading: 'stopped' },
          ],
          accounts.map((account) => [
            account.agent,
            account.name,
            `${account.termsDays} d`,
            `${(account.discount / 100).toFixed(1)}%`,
            formatMoney(account.creditLimit, { grouped: true }),
            account.stopped ? 'yes' : '',
          ]),
          { title: 'agents', empty: 'no accounts' },
        );
        emit(io, readFormat(options.format), text, accounts);
      } finally {
        closeContext(context);
      }
    });

  agents
    .command('show <agent>')
    .description('one account')
    .action((agent: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const account = findAccount(context.db, agent);
        if (account === undefined) {
          throw new NotFoundError('account', agent);
        }
        emit(io, readFormat(options.format), describeAccount(account), account);
      } finally {
        closeContext(context);
      }
    });

  agents
    .command('import <path>')
    .description('load accounts from a csv file')
    .action((path: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const summary = importAccounts(context.db, readFileSync(path, 'utf8'), path);
        emit(
          io,
          readFormat(options.format),
          `wrote ${summary.written} accounts from ${path}`,
          summary,
        );
      } finally {
        closeContext(context);
      }
    });
}

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
  contactRoles,
  describeContact,
  makeContact,
  noticeList,
} from '../../domain/billing/contact';
import {
  allAccounts,
  allContacts,
  allVessels,
  contactsForAgent,
  findAccount,
  findVessel,
  saveContact,
  vesselsNamed,
} from '../../storage/fleet-store';
import { importAccounts, importVessels } from '../../service/imports';
import type { Io } from '../output';
import { withDistrict } from '../run';

export function registerFleet(program: Command, io: Io): void {
  const vessels = program.command('vessels').description('the ships the district knows');

  vessels
    .command('list')
    .description('every ship on the books')
    .option('--name <prefix>', 'only ships whose name starts with this')
    .action(
      withDistrict(program, io, ({ context, say }, local: { name?: string }) => {
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
        say(text, ships);
      }),
    );

  vessels
    .command('show <imo>')
    .description('one ship in full')
    .action(
      withDistrict(program, io, ({ context, say }, imo: string) => {
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
        say(text, { ...ship, units: pilotageUnits(ship), summary: describeVessel(ship) });
      }),
    );

  vessels
    .command('import <path>')
    .description('load ship particulars from a csv file')
    .action(
      withDistrict(program, io, ({ context, say }, path: string) => {
        const summary = importVessels(context.db, readFileSync(path, 'utf8'), path);
        say(`wrote ${summary.written} ships from ${path}`, summary);
      }),
    );

  const agents = program.command('agents').description('the agents who order movements');

  agents
    .command('list')
    .description('every account')
    .action(
      withDistrict(program, io, ({ context, say }) => {
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
        say(text, accounts);
      }),
    );

  agents
    .command('show <agent>')
    .description('one account')
    .action(
      withDistrict(program, io, ({ context, say }, agent: string) => {
        const account = findAccount(context.db, agent);
        if (account === undefined) {
          throw new NotFoundError('account', agent);
        }
        say(describeAccount(account), account);
      }),
    );

  agents
    .command('import <path>')
    .description('load accounts from a csv file')
    .action(
      withDistrict(program, io, ({ context, say }, path: string) => {
        const summary = importAccounts(context.db, readFileSync(path, 'utf8'), path);
        say(`wrote ${summary.written} accounts from ${path}`, summary);
      }),
    );

  agents
    .command('contact <agent> <name> <role>')
    .description(`record somebody to ring, role one of ${contactRoles().join(', ')}`)
    .option('--email <address>', 'their address')
    .option('--telephone <number>', 'their number')
    .option('--no-notices', 'they do not want the notices')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          agent: string,
          name: string,
          role: string,
          local: { email?: string; telephone?: string; notices?: boolean },
        ) => {
          if (findAccount(context.db, agent) === undefined) {
            throw new NotFoundError('account', agent);
          }
          const contact = makeContact({
            agent,
            name,
            role,
            ...(local.email === undefined ? {} : { email: local.email }),
            ...(local.telephone === undefined ? {} : { telephone: local.telephone }),
            takesNotices: local.notices !== false && role === 'operations',
          });
          saveContact(context.db, contact);
          say(describeContact(contact), contact);
        },
      ),
    );

  agents
    .command('contacts [agent]')
    .description('the people behind an agent code, or behind all of them')
    .action(
      withDistrict(program, io, ({ context, say }, agent?: string) => {
        const contacts =
          agent === undefined ? allContacts(context.db) : contactsForAgent(context.db, agent);
        const text = renderTable(
          [
            { heading: 'agent' },
            { heading: 'name' },
            { heading: 'role' },
            { heading: 'email' },
            { heading: 'telephone' },
            { heading: 'notices' },
          ],
          contacts.map((contact) => [
            contact.agent,
            contact.name,
            contact.role,
            contact.email ?? '',
            contact.telephone ?? '',
            contact.takesNotices ? 'yes' : '',
          ]),
          { title: 'contacts', empty: 'nobody on the list' },
        );
        say(text, contacts);
      }),
    );

  agents
    .command('notice-list')
    .description('the addresses a notice goes out to')
    .action(
      withDistrict(program, io, ({ context, say }) => {
        const list = noticeList(allContacts(context.db));
        say(list.length === 0 ? 'nobody takes the notices' : list.join('\n'), list);
      }),
    );
}

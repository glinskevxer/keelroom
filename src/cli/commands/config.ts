/**
 * keelroom config: what the district is running on.
 *
 * The settings file is small and it decides how every rule behaves, so there is
 * a command to print what is actually in force rather than what somebody thinks
 * they set, and one to write a template with the standing values in it.
 */

import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import { renderPairs, renderTable } from '../../util/table';
import { formatMetres, formatMoney } from '../../util/units';
import { defaultConfig } from '../../service/config';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { loadConfig } from '../shared';

export function registerConfig(program: Command, io: Io): void {
  const config = program.command('config').description('the settings the district runs on');

  config
    .command('show')
    .description('what is actually in force')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const settings = loadConfig(options);
      const text = [
        renderPairs([
          ['district', settings.district],
          ['database', settings.databasePath],
          ['transit speed', `${(settings.transitSpeed / 10).toFixed(1)} kn`],
          ['twilight', `${settings.twilightMinutes} minutes`],
          ['tax', `${(settings.taxRate / 100).toFixed(2)} percent`],
        ]),
        '',
        renderPairs([
          ['clearance percentage', `${(settings.clearance.percentOfDraught / 10).toFixed(1)}%`],
          ['clearance floor', `${formatMetres(settings.clearance.minimumNet)} m`],
          ['hard bottom extra', `${formatMetres(settings.clearance.hardBottomExtra)} m`],
          ['dangerous cargo extra', `${formatMetres(settings.clearance.dangerousCargoExtra)} m`],
          ['planned heel', `${(settings.clearance.plannedHeel / 10).toFixed(1)} degrees`],
        ]),
        '',
        renderPairs([
          ['minimum rest', `${settings.rest.minimumRest} minutes`],
          ['daily ceiling', `${settings.rest.dailyCeiling} minutes`],
          ['weekly ceiling', `${settings.rest.weeklyCeiling} minutes`],
          ['daylight over', `${settings.restrictions.daylightUnits} units`],
          ['tugs available', String(settings.restrictions.tugsAvailable)],
          ['one way over', `${settings.restrictions.oneWayUnits} units`],
        ]),
        '',
        renderTable(
          [{ heading: 'surcharge' }, { heading: 'rate', align: 'right' }],
          [
            ['night', `${(settings.surcharges.night / 100).toFixed(1)}%`],
            ['weekend', `${(settings.surcharges.weekend / 100).toFixed(1)}%`],
            ['holiday', `${(settings.surcharges.holiday / 100).toFixed(1)}%`],
            ['deep draught', `${(settings.surcharges.deep / 100).toFixed(1)}%`],
            ['dangerous cargo', `${(settings.surcharges.dangerous / 100).toFixed(1)}%`],
            ['dead ship', `${(settings.surcharges.deadShip / 100).toFixed(1)}%`],
            ['short notice', `${(settings.surcharges.shortNotice / 100).toFixed(1)}%`],
          ],
          { title: 'surcharges' },
        ),
        '',
        `detention: ${settings.detention.grace} minutes grace, then ${settings.detention.block} minute blocks`,
        `holidays: ${settings.calendar.holidays.length === 0 ? 'none published' : settings.calendar.holidays.join(', ')}`,
      ].join('\n');
      emit(io, readFormat(options.format), text, settings);
    });

  config
    .command('template <path>')
    .description('write a settings file with the standing values in it')
    // not --district: that one is global and would be read for the whole run
    .option('--code <code>', 'the district code to put in it', 'KLR')
    .action((path: string, local: { code: string }) => {
      const options = program.opts<GlobalOptions>();
      const settings = defaultConfig(local.code);
      const template = {
        district: settings.district,
        databasePath: settings.databasePath,
        transitSpeed: settings.transitSpeed,
        twilightMinutes: settings.twilightMinutes,
        taxRate: settings.taxRate,
        clearance: settings.clearance,
        rest: settings.rest,
        restrictions: settings.restrictions,
        surcharges: settings.surcharges,
        penalties: settings.penalties,
        detention: settings.detention,
        calendar: settings.calendar,
      };
      writeFileSync(path, `${JSON.stringify(template, null, 2)}\n`);
      emit(io, readFormat(options.format), `wrote a template to ${path}`, { path });
    });

  config
    .command('check')
    .description('read the settings file and say whether it is valid')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const settings = loadConfig(options);
      const money = formatMoney(0);
      emit(
        io,
        readFormat(options.format),
        `the settings for ${settings.district} are valid, money reads as ${money}`,
        { district: settings.district, valid: true },
      );
    });
}

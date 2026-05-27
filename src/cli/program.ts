/**
 * The argv layer.
 *
 * Commander builds the tree and the subcommand modules do the work. Nothing in
 * here does anything but read options and call a service, so the exit codes and
 * the error text come out the same whatever the command was.
 */

import { Command } from 'commander';
import { VERSION } from '../version';
import { EXIT_CLEAN, EXIT_USAGE, describeError, exitCodeOf } from '../util/errors';
import type { Io } from './output';
import { registerAdvice } from './commands/advice';
import { registerAudit } from './commands/audit';
import { registerBilling } from './commands/billing';
import { registerBulletin } from './commands/bulletin';
import { registerConfig } from './commands/config';
import { registerDispatch } from './commands/dispatch';
import { registerDistrict } from './commands/district';
import { registerDoctor } from './commands/doctor';
import { registerFleet } from './commands/fleet';
import { registerInit } from './commands/init';
import { registerNotices } from './commands/notices';
import { registerOrders } from './commands/orders';
import { registerPlan } from './commands/plan';
import { registerRoster } from './commands/roster';
import { registerServe } from './commands/serve';
import { registerStatistics } from './commands/statistics';
import { registerTariff } from './commands/tariff';
import { registerTides } from './commands/tides';
import { registerTraffic } from './commands/traffic';
import { registerTugs } from './commands/tugs';
import { registerWeather } from './commands/weather';

export interface RunOptions {
  readonly io: Io;
  /** Where the exit code goes rather than to process.exit. */
  readonly exit?: (code: number) => void;
}

export function buildProgram(io: Io): Command {
  const program = new Command();
  program
    .name('keelroom')
    .description('pilotage dispatch, transit planning and settlement')
    .version(VERSION, '-v, --version', 'print the version and exit')
    .option('-c, --config <path>', 'settings file to read')
    .option('-d, --district <code>', 'district code to work in')
    .option('--database <path>', 'district file to open')
    .option('--now <instant>', 'treat this as the current time')
    .option('--operator <name>', 'who is at the terminal, for the audit trail')
    .option('-f, --format <format>', 'text or json', 'text')
    .showHelpAfterError()
    .addHelpText(
      'after',
      [
        '',
        'The ordinary day, in the order it happens:',
        '  keelroom orders place <imo> <agent> --kind arrival --from SEA --to GRAIN-3 \\',
        '      --draught 11.20 --at 2025-04-03T06:00',
        '  keelroom plan show M-2025-0001        what the tide allows and why',
        '  keelroom plan confirm M-2025-0001     take one of the windows',
        '  keelroom dispatch assign M-2025-0001  the board picks the pilot',
        '  keelroom tugs book M-2025-0001        raise the towage',
        '  keelroom dispatch boarded|underway|complete M-2025-0001',
        '  keelroom billing raise SEAWAY         one invoice for the period',
        '',
        'And the pages that get read every morning:',
        '  keelroom bulletin                     tide, weather, notices, movements',
        '  keelroom board                        whose turn it is',
        '  keelroom doctor                       anything wrong or about to be',
      ].join('\n'),
    )
    .exitOverride();
  program.configureOutput({
    writeOut: (text) => io.write(text.trimEnd()),
    writeErr: (text) => io.fail(text.trimEnd()),
  });
  registerAdvice(program, io);
  registerAudit(program, io);
  registerBilling(program, io);
  registerBulletin(program, io);
  registerConfig(program, io);
  registerDispatch(program, io);
  registerDistrict(program, io);
  registerDoctor(program, io);
  registerFleet(program, io);
  registerInit(program, io);
  registerNotices(program, io);
  registerOrders(program, io);
  registerPlan(program, io);
  registerRoster(program, io);
  registerServe(program, io);
  registerStatistics(program, io);
  registerTariff(program, io);
  registerTides(program, io);
  registerTraffic(program, io);
  registerTugs(program, io);
  registerWeather(program, io);
  return program;
}

export async function run(argv: readonly string[], options: RunOptions): Promise<number> {
  const program = buildProgram(options.io);
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return EXIT_CLEAN;
  } catch (error) {
    const commanderCode = (error as { code?: string }).code;
    if (commanderCode === 'commander.version' || commanderCode === 'commander.helpDisplayed') {
      return EXIT_CLEAN;
    }
    if (commanderCode !== undefined && commanderCode.startsWith('commander.')) {
      return EXIT_USAGE;
    }
    options.io.fail(describeError(error));
    return exitCodeOf(error);
  }
}

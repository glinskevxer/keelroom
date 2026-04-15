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
    .exitOverride();
  program.configureOutput({
    writeOut: (text) => io.write(text.trimEnd()),
    writeErr: (text) => io.fail(text.trimEnd()),
  });
  registerAdvice(program, io);
  registerAudit(program, io);
  registerBilling(program, io);
  registerBulletin(program, io);
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

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
import { registerDispatch } from './commands/dispatch';
import { registerDoctor } from './commands/doctor';
import { registerFleet } from './commands/fleet';
import { registerOrders } from './commands/orders';
import { registerPlan } from './commands/plan';
import { registerRoster } from './commands/roster';
import { registerTides } from './commands/tides';

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
    .option('-f, --format <format>', 'text or json', 'text')
    .showHelpAfterError()
    .exitOverride();
  program.configureOutput({
    writeOut: (text) => io.write(text.trimEnd()),
    writeErr: (text) => io.fail(text.trimEnd()),
  });
  registerDispatch(program, io);
  registerDoctor(program, io);
  registerFleet(program, io);
  registerOrders(program, io);
  registerPlan(program, io);
  registerRoster(program, io);
  registerTides(program, io);
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

/**
 * The wrapper every command action was writing out by hand.
 *
 * Open the district, do the work, close it whatever happens, and hand the
 * handler the format the operator asked for. Twenty commands had their own copy
 * of that and two of them had already drifted: one closed the district only on
 * the happy path, and one read the format from the wrong options object.
 */

import type { Command } from 'commander';
import type { Context } from '../service/context';
import { closeContext } from '../service/context';
import type { Format, Io } from './output';
import { emit, readFormat } from './output';
import type { GlobalOptions } from './shared';
import { openFor } from './shared';

export interface CommandRun {
  readonly context: Context;
  readonly io: Io;
  readonly format: Format;
  /** Emit the text or the data, whichever the operator asked for. */
  say(text: string, data: unknown): void;
}

export type Action<Args extends unknown[]> = (
  run: CommandRun,
  ...args: Args
) => void | Promise<void>;

/**
 * Build an action that opens the district for the length of the command. The
 * arguments commander passes through arrive after the run, so a command with
 * two positional arguments takes them in the order it declared them.
 */
export function withDistrict<Args extends unknown[]>(
  program: Command,
  io: Io,
  action: Action<Args>,
): (...args: Args) => Promise<void> {
  return async (...args: Args): Promise<void> => {
    const options = program.opts<GlobalOptions>();
    const format = readFormat(options.format);
    const context = openFor(options);
    try {
      await action(
        {
          context,
          io,
          format,
          say(text: string, data: unknown): void {
            emit(io, format, text, data);
          },
        },
        ...args,
      );
    } finally {
      closeContext(context);
    }
  };
}

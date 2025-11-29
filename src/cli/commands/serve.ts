/**
 * keelroom serve: the read side, for the agents.
 */

import type { Command } from 'commander';
import { serve } from '../../api/server';
import { closeContext } from '../../service/context';
import type { Io } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor, readInteger } from '../shared';

export function registerServe(program: Command, io: Io): void {
  program
    .command('serve')
    .description('serve the read side over http')
    .option('--port <port>', 'port to listen on', '8080')
    .option('--host <host>', 'address to bind', '127.0.0.1')
    .option('--quiet', 'do not write an access log')
    .action(async (local: { port: string; host: string; quiet?: boolean }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      const running = await serve(context, {
        port: readInteger(local.port, 'port'),
        host: local.host,
        ...(local.quiet === true ? {} : { log: (line: string): void => io.write(line) }),
      });
      io.write(`listening on http://${local.host}:${running.port}`);
      const stop = (): void => {
        void running.close().then(() => {
          closeContext(context);
        });
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
}

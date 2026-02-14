/**
 * keelroom doctor: is this district file sound.
 */

import type { Command } from 'commander';
import { EXIT_FINDINGS } from '../../util/errors';
import { checkDatabase, summarise } from '../../storage/backup';
import { renderPairs } from '../../util/table';
import type { Io } from '../output';
import { withDistrict } from '../run';

export function registerDoctor(program: Command, io: Io): void {
  program
    .command('doctor')
    .description('check the district file and report anything wrong with it')
    .action(
      withDistrict(program, io, ({ context, say }) => {
        const problems = checkDatabase(context.db);
        const summary = summarise(context.db);
        const text = [
          renderPairs([
            ['schema version', String(summary.version)],
            ['movements', String(summary.movements)],
            ['vessels', String(summary.vessels)],
            ['pilots', String(summary.pilots)],
            ['invoices', String(summary.invoices)],
          ]),
          '',
          problems.length === 0
            ? 'nothing wrong'
            : problems.map((problem) => `[${problem.check}] ${problem.detail}`).join('\n'),
        ].join('\n');
        say(text, { summary, problems });
        if (problems.length > 0) {
          process.exitCode = EXIT_FINDINGS;
        }
      }),
    );
}

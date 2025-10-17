/**
 * keelroom doctor: is this district file sound.
 */

import type { Command } from 'commander';
import { EXIT_FINDINGS } from '../../util/errors';
import { checkDatabase, summarise } from '../../storage/backup';
import { renderPairs } from '../../util/table';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { loadConfig } from '../shared';
import { openDatabase } from '../../storage/database';

export function registerDoctor(program: Command, io: Io): void {
  program
    .command('doctor')
    .description('check the district file and report anything wrong with it')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const config = loadConfig(options);
      const db = openDatabase(config.databasePath, { readonly: true });
      try {
        const problems = checkDatabase(db);
        const summary = summarise(db);
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
        emit(io, readFormat(options.format), text, { summary, problems });
        if (problems.length > 0) {
          process.exitCode = EXIT_FINDINGS;
        }
      } finally {
        db.close();
      }
    });
}

/**
 * keelroom doctor: is this district file sound.
 */

import type { Command } from 'commander';
import { EXIT_FINDINGS } from '../../util/errors';
import { checkDatabase, summarise } from '../../storage/backup';
import { checkDistrict, warningsOnly } from '../../service/health';
import { renderPairs } from '../../util/table';
import type { Io } from '../output';
import { withDistrict } from '../run';

export function registerDoctor(program: Command, io: Io): void {
  program
    .command('doctor')
    .description('check the district file and report anything wrong with it')
    .option('--deep', 'replan the confirmed movements as well, which is slower')
    .option('--days <days>', 'how far ahead to look', '7')
    .action(
      withDistrict(program, io, ({ context, say }, local: { deep?: boolean; days: string }) => {
        const problems = checkDatabase(context.db);
        const health = checkDistrict(context, {
          days: Number(local.days),
          replan: local.deep === true,
        });
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
            ? 'the file itself is sound'
            : problems.map((problem) => `[${problem.check}] ${problem.detail}`).join('\n'),
          '',
          health.length === 0
            ? 'nothing wants attention'
            : health
                .map((finding) => `[${finding.check}] ${finding.subject}: ${finding.detail}`)
                .join('\n'),
        ].join('\n');
        say(text, { summary, problems, health });
        if (problems.length > 0 || warningsOnly(health).length > 0) {
          process.exitCode = EXIT_FINDINGS;
        }
      }),
    );
}

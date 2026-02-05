/**
 * keelroom audit: who did what.
 */

import type { Command } from 'commander';
import { formatLocal } from '../../util/clock';
import { renderTable } from '../../util/table';
import { countByAction } from '../../domain/audit/entry';
import { recent, trailOf, trailOfPerson } from '../../service/audit';
import { closeContext } from '../../service/context';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor, readInteger } from '../shared';

export function registerAudit(program: Command, io: Io): void {
  const audit = program.command('audit').description('the trail of decisions');

  audit
    .command('show <subject>')
    .description('everything recorded against one movement, invoice or reach')
    .action((subject: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const entries = trailOf(context, subject);
        const text = renderTable(
          [
            { heading: 'when' },
            { heading: 'action' },
            { heading: 'by' },
            { heading: 'note', width: 44 },
          ],
          entries.map((entry) => [
            formatLocal(entry.at, context.district.offset),
            entry.action,
            entry.by,
            entry.note,
          ]),
          { title: subject, empty: 'nothing recorded' },
        );
        emit(io, readFormat(options.format), text, entries);
      } finally {
        closeContext(context);
      }
    });

  audit
    .command('recent')
    .description('the last few entries, oldest first')
    .option('--limit <count>', 'how many', '20')
    .action((local: { limit: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const entries = recent(context, readInteger(local.limit, 'limit'));
        const text = renderTable(
          [{ heading: 'when' }, { heading: 'action' }, { heading: 'subject' }, { heading: 'by' }],
          entries.map((entry) => [
            formatLocal(entry.at, context.district.offset),
            entry.action,
            entry.subject,
            entry.by,
          ]),
          { title: 'recent', empty: 'nothing recorded' },
        );
        emit(io, readFormat(options.format), text, entries);
      } finally {
        closeContext(context);
      }
    });

  audit
    .command('by <person>')
    .description('what one person has done')
    .action((person: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const entries = trailOfPerson(context, person);
        const counts = countByAction(entries);
        const text = renderTable(
          [{ heading: 'action' }, { heading: 'times', align: 'right' }],
          Object.entries(counts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([action, times]) => [action, String(times)]),
          { title: person, empty: 'nothing recorded' },
        );
        emit(io, readFormat(options.format), text, { entries, counts });
      } finally {
        closeContext(context);
      }
    });
}

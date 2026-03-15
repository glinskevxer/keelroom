/**
 * keelroom tariff: the books, and what a rise would do.
 */

import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { NotFoundError } from '../../util/errors';
import { MINUTES_PER_DAY, localDate } from '../../util/clock';
import { makeInterval } from '../../util/interval';
import { formatMoney } from '../../util/units';
import { renderPairs, renderTable } from '../../util/table';
import { bookAt, makeBook } from '../../domain/tariff/book';
import type { UnitBand } from '../../domain/tariff/book';
import { allBooks, findBookById, saveBook } from '../../storage/billing-store';
import { overallRate, raiseBook, studyRates } from '../../service/rates';
import { note } from '../../service/audit';
import type { Io } from '../output';
import { withDistrict } from '../run';
import { readInteger, readTime } from '../shared';

interface BookFile {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly currency?: string;
  readonly bands: UnitBand[];
  readonly minimumCharge: number;
  readonly detentionBlock: number;
  readonly boatFee?: number;
  readonly adminFee?: number;
  readonly kindMultiplier?: Record<string, number>;
}

export function registerTariff(program: Command, io: Io): void {
  const tariff = program.command('tariff').description('the published books');

  tariff
    .command('list')
    .description('every book in the order it took effect')
    .action(
      withDistrict(program, io, ({ context, say }) => {
        const books = allBooks(context.db);
        const text = renderTable(
          [
            { heading: 'book' },
            { heading: 'from' },
            { heading: 'bands', align: 'right' },
            { heading: 'minimum', align: 'right' },
            { heading: 'boat', align: 'right' },
            { heading: 'in force' },
          ],
          books.map((book) => [
            book.id,
            localDate(book.effectiveFrom, context.district.offset),
            String(book.bands.length),
            formatMoney(book.minimumCharge, { grouped: true }),
            formatMoney(book.boatFee, { grouped: true }),
            book.effectiveFrom <= context.now() ? 'yes' : '',
          ]),
          { title: 'tariff books', empty: 'no books published' },
        );
        say(text, books);
      }),
    );

  tariff
    .command('show [book]')
    .description('one book, or the one in force')
    .action(
      withDistrict(program, io, ({ context, say }, book?: string) => {
        const found =
          book === undefined
            ? bookAt(allBooks(context.db), context.now())
            : findBookById(context.db, book);
        if (found === undefined) {
          throw new NotFoundError('tariff book', book ?? 'in force');
        }
        const head = renderPairs([
          ['book', found.id],
          ['from', localDate(found.effectiveFrom, context.district.offset)],
          ['currency', found.currency],
          ['minimum', formatMoney(found.minimumCharge, { grouped: true })],
          ['detention block', formatMoney(found.detentionBlock, { grouped: true })],
          ['boat', formatMoney(found.boatFee, { grouped: true })],
          ['administration', formatMoney(found.adminFee, { grouped: true })],
        ]);
        const bands = renderTable(
          [
            { heading: 'up to units', align: 'right' },
            { heading: 'band charge', align: 'right' },
            { heading: 'per unit', align: 'right' },
          ],
          found.bands.map((band) => [
            String(band.upTo),
            formatMoney(band.charge, { grouped: true }),
            formatMoney(band.perUnit, { grouped: true }),
          ]),
          { title: 'bands', empty: 'no bands' },
        );
        say(`${head}\n\n${bands}`, found);
      }),
    );

  tariff
    .command('publish <path>')
    .description('publish a book from a json file')
    .action(
      withDistrict(program, io, ({ context, say }, path: string) => {
        const file = JSON.parse(readFileSync(path, 'utf8')) as BookFile;
        const book = makeBook({
          id: file.id,
          effectiveFrom: readTime(file.effectiveFrom, context.district.offset),
          ...(file.currency === undefined ? {} : { currency: file.currency }),
          bands: file.bands,
          minimumCharge: file.minimumCharge,
          detentionBlock: file.detentionBlock,
          ...(file.boatFee === undefined ? {} : { boatFee: file.boatFee }),
          ...(file.adminFee === undefined ? {} : { adminFee: file.adminFee }),
          ...(file.kindMultiplier === undefined ? {} : { kindMultiplier: file.kindMultiplier }),
        });
        saveBook(context.db, book);
        note(context, 'tariff-published', book.id, {
          note: `from ${path}`,
          detail: { effectiveFrom: book.effectiveFrom },
        });
        say(`${book.id} published`, book);
      }),
    );

  tariff
    .command('simulate <basisPoints>')
    .description('what a rise would have done to a period')
    .option('--from <time>', 'start of the period')
    .option('--days <days>', 'how many days', '30')
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, basisPoints: string, local: { from?: string; days: string }) => {
          const offset = context.district.offset;
          const days = readInteger(local.days, 'days');
          const from =
            local.from === undefined
              ? context.now() - days * MINUTES_PER_DAY
              : readTime(local.from, offset);
          const period = makeInterval(from, from + days * MINUTES_PER_DAY);
          const current = bookAt(allBooks(context.db), context.now());
          // the proposed book is never saved, but it still has to be a book,
          // so it borrows the current id with the next letter of the series
          const nextLetter = String.fromCharCode(
            Math.min(90, current.id.charCodeAt(current.id.length - 1) + 1),
          );
          const proposed = raiseBook(
            current,
            `${current.id.slice(0, -1)}${nextLetter}`,
            readInteger(basisPoints, 'basis points'),
            current.effectiveFrom,
          );
          const study = studyRates(context, period, proposed);
          const text = [
            renderPairs([
              ['movements', String(study.movements)],
              ['charged', formatMoney(study.before, { grouped: true })],
              ['would be', formatMoney(study.after, { grouped: true })],
              ['difference', formatMoney(study.difference, { grouped: true })],
              ['overall rise', `${(overallRate(study) / 100).toFixed(2)} percent`],
            ]),
            '',
            renderTable(
              [
                { heading: 'agent' },
                { heading: 'movements', align: 'right' },
                { heading: 'difference', align: 'right' },
                { heading: 'rise', align: 'right' },
              ],
              study.agents.map((agent) => [
                agent.agent,
                String(agent.movements),
                formatMoney(agent.difference, { grouped: true }),
                `${(agent.rate / 100).toFixed(2)}%`,
              ]),
              { title: 'by agent', empty: 'nothing to reprice' },
            ),
          ].join('\n');
          say(text, study);
        },
      ),
    );
}

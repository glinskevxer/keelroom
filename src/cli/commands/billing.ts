/**
 * keelroom billing: what a movement costs, what has been invoiced, and what has
 * been paid.
 */

import type { Command } from 'commander';
import { NotFoundError } from '../../util/errors';
import { MINUTES_PER_DAY } from '../../util/clock';
import { formatMoney } from '../../util/units';
import { renderTable } from '../../util/table';
import { renderInvoice, renderOverdue, renderStatement } from '../../report/money';
import { findInvoice, invoicesForAgent } from '../../storage/billing-store';
import { priceMovement, quoteMovement, raiseInvoice } from '../../service/settlement';
import { creditInvoice, issueInvoice, statementFor, takePayment } from '../../service/collections';
import { closeContext } from '../../service/context';
import type { CreditReason } from '../../domain/billing/credit';
import type { Io } from '../output';
import { emit, readFormat } from '../output';
import type { GlobalOptions } from '../shared';
import { openFor, readInteger, readTime } from '../shared';

const REASONS: readonly CreditReason[] = [
  'movement-not-run',
  'rate-in-error',
  'detention-in-error',
  'goodwill',
  'duplicate',
];

export function registerBilling(program: Command, io: Io): void {
  const billing = program.command('billing').description('charges, invoices and payments');

  billing
    .command('quote <reference>')
    .description('what a movement would cost, without writing anything')
    .action((reference: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const assessment = quoteMovement(context, reference);
        const text = renderTable(
          [{ heading: 'code' }, { heading: 'description' }, { heading: 'amount', align: 'right' }],
          assessment.lines.map((line) => [
            line.code,
            line.description,
            formatMoney(line.amount, { grouped: true }),
          ]),
          { title: `${reference} on ${assessment.book}`, empty: 'nothing to charge' },
        );
        emit(
          io,
          readFormat(options.format),
          `${text}\n\ntotal ${formatMoney(assessment.total, { grouped: true })}`,
          assessment,
        );
      } finally {
        closeContext(context);
      }
    });

  billing
    .command('price <reference>')
    .description('price a movement and remember the book it was priced on')
    .action((reference: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const result = priceMovement(context, reference);
        emit(
          io,
          readFormat(options.format),
          `${reference} priced at ${formatMoney(result.assessment.total, { grouped: true })} on ${result.assessment.book}`,
          result.assessment,
        );
      } finally {
        closeContext(context);
      }
    });

  billing
    .command('raise <agent>')
    .description('raise one invoice for everything an agent has run')
    .option('--days <days>', 'how far back to bill from the end of the period', '30')
    .option('--from <time>', 'start of the period')
    .option('--to <time>', 'end of the period, which defaults to now')
    .action((agent: string, local: { days: string; from?: string; to?: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const offset = context.district.offset;
        const days = readInteger(local.days, 'days');
        const to = local.to === undefined ? context.now() : readTime(local.to, offset);
        const from =
          local.from === undefined ? to - days * MINUTES_PER_DAY : readTime(local.from, offset);
        const result = raiseInvoice(context, { agent, from, to });
        const text = `${result.invoice.number} raised for ${result.movements.length} movements, ${formatMoney(result.total, { grouped: true })}`;
        emit(io, readFormat(options.format), text, result);
      } finally {
        closeContext(context);
      }
    });

  billing
    .command('issue <number>')
    .description('issue a draft invoice')
    .action((number: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const invoice = issueInvoice(context, number);
        emit(io, readFormat(options.format), `${invoice.number} issued`, invoice);
      } finally {
        closeContext(context);
      }
    });

  billing
    .command('show <number>')
    .description('one invoice in full')
    .action((number: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const invoice = findInvoice(context.db, number);
        if (invoice === undefined) {
          throw new NotFoundError('invoice', number);
        }
        emit(
          io,
          readFormat(options.format),
          renderInvoice(invoice, { offset: context.district.offset }),
          invoice,
        );
      } finally {
        closeContext(context);
      }
    });

  billing
    .command('pay <agent> <reference> <amount>')
    .description('take a payment and set it against the oldest invoices')
    .option('--at <time>', 'when it was received')
    .action((agent: string, reference: string, amount: string, local: { at?: string }) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const result = takePayment(context, {
          agent,
          reference,
          amount: readInteger(amount, 'amount'),
          ...(local.at === undefined
            ? {}
            : { receivedAt: readTime(local.at, context.district.offset) }),
        });
        const text = [
          `${reference} allocated to ${result.allocations.length} invoices`,
          ...result.allocations.map(
            (allocation) =>
              `  ${allocation.invoice} ${formatMoney(allocation.amount, { grouped: true })}`,
          ),
          result.unallocated === 0
            ? ''
            : `${formatMoney(result.unallocated, { grouped: true })} left unallocated`,
        ]
          .filter((line) => line !== '')
          .join('\n');
        emit(io, readFormat(options.format), text, result);
      } finally {
        closeContext(context);
      }
    });

  billing
    .command('credit <number> <reason> <amount> <note...>')
    .description(`raise a credit note, reason one of ${REASONS.join(', ')}`)
    .action((number: string, reason: string, amount: string, note: string[]) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const chosen = REASONS.find((each) => each === reason);
        if (chosen === undefined) {
          throw new NotFoundError('credit reason', reason);
        }
        const credit = creditInvoice(context, {
          invoice: number,
          reason: chosen,
          amount: readInteger(amount, 'amount'),
          note: note.join(' '),
        });
        emit(
          io,
          readFormat(options.format),
          `${credit.number} raised against ${credit.invoice} for ${formatMoney(credit.amount, { grouped: true })}`,
          credit,
        );
      } finally {
        closeContext(context);
      }
    });

  billing
    .command('statement <agent>')
    .description('what one agent owes and how old it is')
    .action((agent: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const statement = statementFor(context, agent);
        emit(
          io,
          readFormat(options.format),
          renderStatement(statement, { offset: context.district.offset }),
          statement,
        );
      } finally {
        closeContext(context);
      }
    });

  billing
    .command('overdue <agent>')
    .description('the invoices past their due date')
    .action((agent: string) => {
      const options = program.opts<GlobalOptions>();
      const context = openFor(options);
      try {
        const invoices = invoicesForAgent(context.db, agent);
        emit(
          io,
          readFormat(options.format),
          renderOverdue(invoices, context.now()),
          invoices.map((invoice) => invoice.number),
        );
      } finally {
        closeContext(context);
      }
    });
}

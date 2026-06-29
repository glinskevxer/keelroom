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
import {
  drawFromDeposits,
  priceMovement,
  quoteMovement,
  raiseInvoice,
} from '../../service/settlement';
import { makeDeposit, heldFor, refundable } from '../../domain/billing/deposit';
import { depositsFor, drawsFor, saveDeposit } from '../../storage/deposit-store';
import { creditInvoice, issueInvoice, statementFor, takePayment } from '../../service/collections';
import type { CreditReason } from '../../domain/billing/credit';
import type { Io } from '../output';
import { withDistrict } from '../run';
import { readInteger, readTime } from '../shared';

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
    .action(
      withDistrict(program, io, ({ context, say }, reference: string) => {
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
        say(`${text}\n\ntotal ${formatMoney(assessment.total, { grouped: true })}`, assessment);
      }),
    );

  billing
    .command('price <reference>')
    .description('price a movement and remember the book it was priced on')
    .action(
      withDistrict(program, io, ({ context, say }, reference: string) => {
        const result = priceMovement(context, reference);
        say(
          `${reference} priced at ${formatMoney(result.assessment.total, { grouped: true })} on ${result.assessment.book}`,
          result.assessment,
        );
      }),
    );

  billing
    .command('raise <agent>')
    .description('raise one invoice for everything an agent has run')
    .option('--days <days>', 'how far back to bill from the end of the period', '30')
    .option('--from <time>', 'start of the period')
    .option('--to <time>', 'end of the period, which defaults to now')
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, agent: string, local: { days: string; from?: string; to?: string }) => {
          const offset = context.district.offset;
          const days = readInteger(local.days, 'days');
          const to = local.to === undefined ? context.now() : readTime(local.to, offset);
          const from =
            local.from === undefined ? to - days * MINUTES_PER_DAY : readTime(local.from, offset);
          const result = raiseInvoice(context, { agent, from, to });
          const text = `${result.invoice.number} raised for ${result.movements.length} movements, ${formatMoney(result.total, { grouped: true })}`;
          say(text, result);
        },
      ),
    );

  billing
    .command('issue <number>')
    .description('issue a draft invoice')
    .action(
      withDistrict(program, io, ({ context, say }, number: string) => {
        const invoice = issueInvoice(context, number);
        say(`${invoice.number} issued`, invoice);
      }),
    );

  billing
    .command('show <number>')
    .description('one invoice in full')
    .action(
      withDistrict(program, io, ({ context, say }, number: string) => {
        const invoice = findInvoice(context.db, number);
        if (invoice === undefined) {
          throw new NotFoundError('invoice', number);
        }
        say(renderInvoice(invoice, { offset: context.district.offset }), invoice);
      }),
    );

  billing
    .command('pay <agent> <reference> <amount>')
    .description('take a payment and set it against the oldest invoices')
    .option('--at <time>', 'when it was received')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          agent: string,
          reference: string,
          amount: string,
          local: { at?: string },
        ) => {
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
          say(text, result);
        },
      ),
    );

  billing
    .command('credit <number> <reason> <amount> <note...>')
    .description(`raise a credit note, reason one of ${REASONS.join(', ')}`)
    .action(
      withDistrict(
        program,
        io,
        ({ context, say }, number: string, reason: string, amount: string, note: string[]) => {
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
          say(
            `${credit.number} raised against ${credit.invoice} for ${formatMoney(credit.amount, { grouped: true })}`,
            credit,
          );
        },
      ),
    );

  billing
    .command('statement <agent>')
    .description('what one agent owes and how old it is')
    .action(
      withDistrict(program, io, ({ context, say }, agent: string) => {
        const statement = statementFor(context, agent);
        say(renderStatement(statement, { offset: context.district.offset }), statement);
      }),
    );

  billing
    .command('overdue <agent>')
    .description('the invoices past their due date')
    .action(
      withDistrict(program, io, ({ context, say }, agent: string) => {
        const invoices = invoicesForAgent(context.db, agent);
        say(
          renderOverdue(invoices, context.now()),
          invoices.map((invoice) => invoice.number),
        );
      }),
    );

  billing
    .command('deposit <agent> <reference> <amount>')
    .description('lodge money before a movement runs')
    .option('--movement <reference>', 'the movement it is lodged against')
    .option('--note <text>', 'anything to record with it')
    .action(
      withDistrict(
        program,
        io,
        (
          { context, say },
          agent: string,
          reference: string,
          amount: string,
          local: { movement?: string; note?: string },
        ) => {
          const deposit = makeDeposit({
            reference,
            agent,
            amount: readInteger(amount, 'amount'),
            lodgedAt: context.now(),
            ...(local.movement === undefined ? {} : { movement: local.movement }),
            ...(local.note === undefined ? {} : { note: local.note }),
          });
          saveDeposit(context.db, deposit);
          say(
            `${deposit.reference} lodged, ${formatMoney(deposit.amount, { grouped: true })} held for ${agent}`,
            deposit,
          );
        },
      ),
    );

  billing
    .command('deposits <agent>')
    .description('what an agent has lodged and what is left of it')
    .action(
      withDistrict(program, io, ({ context, say }, agent: string) => {
        const deposits = depositsFor(context.db, agent);
        const draws = drawsFor(context.db, agent);
        const text = renderTable(
          [
            { heading: 'deposit' },
            { heading: 'lodged', align: 'right' },
            { heading: 'left', align: 'right' },
            { heading: 'movement' },
          ],
          deposits.map((deposit) => [
            deposit.reference,
            formatMoney(deposit.amount, { grouped: true }),
            formatMoney(refundable(agent, [deposit], draws)[0]?.amount ?? 0, { grouped: true }),
            deposit.movement ?? '',
          ]),
          {
            title: `${agent} holds ${formatMoney(heldFor(agent, deposits, draws), { grouped: true })}`,
            empty: 'nothing lodged',
          },
        );
        say(text, { deposits, draws });
      }),
    );

  billing
    .command('draw <reference>')
    .description('run a movement charge down against what the agent has lodged')
    .action(
      withDistrict(program, io, ({ context, say }, reference: string) => {
        const result = drawFromDeposits(context, reference);
        say(
          `${formatMoney(result.drawn, { grouped: true })} drawn, ` +
            `${formatMoney(result.short, { grouped: true })} left to invoice`,
          result,
        );
      }),
    );
}

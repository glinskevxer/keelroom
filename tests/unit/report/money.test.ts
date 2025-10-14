import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeLine } from '../../../src/domain/tariff/charge';
import { makeInvoice, moveTo } from '../../../src/domain/billing/invoice';
import type { Invoice } from '../../../src/domain/billing/invoice';
import { ageing } from '../../../src/domain/billing/ledger';
import {
  overdueLines,
  renderAgeing,
  renderInvoice,
  renderOverdue,
  renderStatement,
} from '../../../src/report/money';
import { makeAccount, standing } from '../../../src/domain/billing/account';

const OPTIONS = { offset: -240 };
const RAISED = parseInstant('2025-06-30T09:00Z');
const DAY = 1440;

function invoice(number = 'INV-2025-00042', amount = 100000): Invoice {
  return moveTo(
    makeInvoice({
      number,
      agent: 'SEAWAY',
      raisedAt: RAISED,
      dueAt: RAISED + 30 * DAY,
      taxRate: 1500,
      items: [
        {
          movement: 'M-2025-0004',
          lines: [
            makeLine('PILOTAGE', 'pilotage, 855 units', amount),
            makeLine('BOAT', 'pilot boat', 25000),
          ],
        },
      ],
    }),
    'issued',
  );
}

describe('an invoice', () => {
  const text = renderInvoice(invoice(), OPTIONS);

  it('names the invoice and the agent', () => {
    expect(text).toContain('INV-2025-00042');
    expect(text).toContain('SEAWAY');
  });

  it('has a row for every line', () => {
    expect(text).toContain('pilotage, 855 units');
    expect(text).toContain('pilot boat');
  });

  it('shows the net, the tax and the total', () => {
    expect(text).toContain('net    1,250.00');
    expect(text).toContain('tax    187.50');
    expect(text).toContain('total  1,437.50 USD');
  });

  it('groups the thousands', () => {
    expect(renderInvoice(invoice('INV-2025-00043', 1234567), OPTIONS)).toContain('12,345.67');
  });
});

describe('the ageing table', () => {
  it('has a column for every bucket', () => {
    const buckets = ageing('SEAWAY', [invoice()], RAISED + 100 * DAY);
    const text = renderAgeing(buckets);
    expect(text).toContain('over 90');
    expect(text.split('\n')).toHaveLength(4);
  });
});

describe('a statement', () => {
  it('shows the balance, the open invoices and the ageing', () => {
    const invoices = [invoice(), invoice('INV-2025-00043', 50000)];
    const statement = {
      agent: 'SEAWAY',
      balance: 100000,
      ageing: ageing('SEAWAY', invoices, RAISED + 40 * DAY),
      standing: standing(makeAccount({ agent: 'SEAWAY', name: 'Seaway' }), 100000),
      open: [{ invoice: 'INV-2025-00042', raisedAt: RAISED, owed: 100000 }],
    };
    const text = renderStatement(statement, OPTIONS);
    expect(text).toContain('balance    1,000.00');
    expect(text).toContain('open invoices');
    expect(text).toContain('ageing');
    expect(text).toContain('may order  yes');
  });

  it('says so when nothing is outstanding', () => {
    const statement = {
      agent: 'NORTH',
      balance: 0,
      ageing: ageing('NORTH', [], RAISED),
      standing: standing(makeAccount({ agent: 'NORTH', name: 'Northern' }), 0),
      open: [],
    };
    expect(renderStatement(statement, OPTIONS)).toContain('nothing outstanding');
  });
});

describe('the overdue list', () => {
  it('lists the oldest first', () => {
    const invoices = [
      invoice('INV-2025-00042'),
      makeInvoice({
        number: 'INV-2025-00043',
        agent: 'NORTH',
        raisedAt: RAISED - 60 * DAY,
        dueAt: RAISED - 30 * DAY,
        items: [{ movement: 'M-2025-0009', lines: [makeLine('PILOTAGE', 'pilotage', 50000)] }],
        status: 'issued',
      }),
    ];
    const lines = overdueLines(invoices, RAISED + 40 * DAY);
    expect(lines.map((line) => line.invoice)).toEqual(['INV-2025-00043', 'INV-2025-00042']);
    expect(lines[0]?.days).toBeGreaterThan(lines[1]!.days);
  });

  it('leaves out anything not yet due', () => {
    expect(overdueLines([invoice()], RAISED)).toEqual([]);
    expect(renderOverdue([invoice()], RAISED)).toContain('nothing overdue');
  });

  it('renders a row for each', () => {
    const text = renderOverdue([invoice()], RAISED + 40 * DAY);
    expect(text).toContain('INV-2025-00042');
    expect(text.split('\n')).toHaveLength(4);
  });
});

import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeMovement } from '../../../src/domain/movement/movement';
import type { Movement } from '../../../src/domain/movement/movement';
import {
  countByState,
  orderLines,
  outstanding,
  renderCounts,
  renderOrders,
  running,
  unplanned,
} from '../../../src/report/orders';

const OFFSET = -240;
const ORDERED = parseInstant('2025-05-01T09:00Z');
const WANTED = parseInstant('2025-05-03T10:00Z');

function movement(overrides: Partial<Parameters<typeof makeMovement>[0]> = {}): Movement {
  return makeMovement({
    reference: 'M-2025-0004',
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught: 1150,
    orderedAt: ORDERED,
    requestedFor: WANTED,
    ...overrides,
  });
}

const BOOK = [
  movement({ reference: 'M-2025-0006', requestedFor: WANTED + 240 }),
  movement({ reference: 'M-2025-0004', plannedFor: WANTED + 30, status: 'confirmed' }),
  movement({
    reference: 'M-2025-0005',
    requestedFor: WANTED + 120,
    status: 'assigned',
    plannedFor: WANTED + 120,
    pilot: 'P07',
  }),
];

describe('the order lines', () => {
  it('sort by the time the ship is expected', () => {
    expect(orderLines(BOOK).map((line) => line.reference)).toEqual([
      'M-2025-0004',
      'M-2025-0005',
      'M-2025-0006',
    ]);
  });

  it('mark whether the time is planned or only asked for', () => {
    const lines = orderLines(BOOK);
    expect(lines[0]?.planned).toBe(true);
    expect(lines.at(-1)?.planned).toBe(false);
  });

  it('carry the pilot where there is one', () => {
    expect(orderLines(BOOK).find((line) => line.reference === 'M-2025-0005')?.pilot).toBe('P07');
    expect(orderLines(BOOK)[0]?.pilot).toBe('');
  });
});

describe('rendering', () => {
  it('shows a row for every movement', () => {
    const text = renderOrders(BOOK, { offset: OFFSET, title: 'orders' });
    const lines = text.split('\n');
    expect(lines[0]).toBe('orders');
    expect(lines).toHaveLength(6);
  });

  it('marks a requested time with a question mark', () => {
    const text = renderOrders(BOOK, { offset: OFFSET });
    expect(text).toContain('10:00?');
  });

  it('shows the ship name when it is given one', () => {
    const text = renderOrders(BOOK, { offset: OFFSET, names: { '9074729': 'ATLANTIC CROWN' } });
    expect(text).toContain('ATLANTIC CROWN');
    expect(text).not.toContain('9074729');
  });

  it('shows the date when asked', () => {
    const text = renderOrders(BOOK, { offset: OFFSET, withDate: true });
    expect(text).toContain('2025-05-03T06:');
  });

  it('says so when the book is empty', () => {
    expect(renderOrders([], { offset: OFFSET })).toBe('nothing on the book');
  });
});

describe('the shorter views', () => {
  const wide = [
    ...BOOK,
    movement({ reference: 'M-2025-0007', status: 'underway', plannedFor: WANTED }),
    movement({ reference: 'M-2025-0008', status: 'completed', plannedFor: WANTED }),
  ];

  it('list what is still to happen', () => {
    expect(outstanding(wide).map((each) => each.reference)).toEqual([
      'M-2025-0006',
      'M-2025-0004',
      'M-2025-0005',
    ]);
  });

  it('list what is on the move', () => {
    expect(running(wide).map((each) => each.reference)).toEqual(['M-2025-0007']);
  });

  it('list what has no planned time yet', () => {
    expect(unplanned(wide).map((each) => each.reference)).toEqual(['M-2025-0006']);
  });

  it('count by state and render the count', () => {
    const counts = countByState(wide);
    expect(counts).toEqual({ ordered: 1, confirmed: 1, assigned: 1, running: 1, closed: 1 });
    expect(renderCounts(counts)).toBe('1 ordered, 1 confirmed, 1 assigned, 1 running, 1 closed');
  });
});

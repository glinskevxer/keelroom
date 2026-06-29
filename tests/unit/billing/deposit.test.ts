import { afterEach, describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import {
  drawDown,
  drawnFrom,
  exhausted,
  heldFor,
  makeDeposit,
  refundable,
  remainingOn,
} from '../../../src/domain/billing/deposit';
import type { Deposit, DepositDraw } from '../../../src/domain/billing/deposit';
import { makeAccount } from '../../../src/domain/billing/account';
import { migrate } from '../../../src/storage/migrate';
import { saveAccount } from '../../../src/storage/fleet-store';
import {
  depositsFor,
  drawsAgainst,
  drawsFor,
  recordDraws,
  requireDeposit,
  saveDeposit,
} from '../../../src/storage/deposit-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

const T = parseInstant('2025-05-01T09:00Z');

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

function deposit(overrides: Partial<Parameters<typeof makeDeposit>[0]> = {}): Deposit {
  return makeDeposit({
    reference: 'DEP-001',
    agent: 'NORTH',
    amount: 500000,
    lodgedAt: T,
    ...overrides,
  });
}

describe('a deposit', () => {
  it('keeps what it was given', () => {
    expect(deposit().amount).toBe(500000);
    expect(deposit({ movement: 'M-2025-0001' }).movement).toBe('M-2025-0001');
  });

  it('refuses one that is not a deposit', () => {
    expect(() => deposit({ reference: ' ' })).toThrow(/needs a reference/);
    expect(() => deposit({ amount: 0 })).toThrow(/positive amount/);
    expect(() => deposit({ amount: 1.5 })).toThrow(/whole cents/);
  });
});

describe('drawing against them', () => {
  const deposits = [
    deposit(),
    deposit({ reference: 'DEP-002', amount: 200000, lodgedAt: T + 100 }),
  ];

  it('takes the oldest first', () => {
    const result = drawDown({
      agent: 'NORTH',
      movement: 'M-1',
      amount: 600000,
      at: T + 200,
      deposits,
      draws: [],
    });
    expect(result.draws.map((draw) => draw.deposit)).toEqual(['DEP-001', 'DEP-002']);
    expect(result.draws[0]?.amount).toBe(500000);
    expect(result.short).toBe(0);
  });

  it('says what the deposits could not cover', () => {
    const result = drawDown({
      agent: 'NORTH',
      movement: 'M-1',
      amount: 900000,
      at: T,
      deposits,
      draws: [],
    });
    expect(result.short).toBe(200000);
  });

  it('leaves another agent deposits alone', () => {
    const result = drawDown({
      agent: 'SEAWAY',
      movement: 'M-1',
      amount: 100000,
      at: T,
      deposits,
      draws: [],
    });
    expect(result.draws).toEqual([]);
    expect(result.short).toBe(100000);
  });

  it('counts what has already been drawn', () => {
    const already: DepositDraw[] = [{ deposit: 'DEP-001', movement: 'M-0', amount: 450000, at: T }];
    const result = drawDown({
      agent: 'NORTH',
      movement: 'M-1',
      amount: 100000,
      at: T,
      deposits,
      draws: already,
    });
    expect(result.draws[0]?.amount).toBe(50000);
    expect(drawnFrom(already, 'DEP-001')).toBe(450000);
  });

  it('reads what is left and what is exhausted', () => {
    const draws: DepositDraw[] = [{ deposit: 'DEP-001', movement: 'M-0', amount: 500000, at: T }];
    expect(remainingOn(deposits[0]!, draws)).toBe(0);
    expect(heldFor('NORTH', deposits, draws)).toBe(200000);
    expect(exhausted(deposits, draws).map((each) => each.reference)).toEqual(['DEP-001']);
    expect(refundable('NORTH', deposits, draws)).toEqual([{ deposit: 'DEP-002', amount: 200000 }]);
  });

  it('refuses a negative charge', () => {
    expect(() =>
      drawDown({ agent: 'NORTH', movement: 'M-1', amount: -1, at: T, deposits, draws: [] }),
    ).toThrow(InputError);
  });
});

describe('through the store', () => {
  function ready(): TempDatabase {
    temp = temporaryDatabase();
    migrate(temp.db);
    saveAccount(temp.db, makeAccount({ agent: 'NORTH', name: 'Northern Agents' }));
    return temp;
  }

  it('come back as they went in', () => {
    const one = ready();
    saveDeposit(one.db, deposit());
    expect(depositsFor(one.db, 'NORTH')).toEqual([deposit()]);
    expect(requireDeposit(one.db, 'DEP-001').amount).toBe(500000);
  });

  it('record the draws against them', () => {
    const one = ready();
    saveDeposit(one.db, deposit());
    recordDraws(one.db, [{ deposit: 'DEP-001', movement: 'M-1', amount: 100000, at: T }]);
    expect(drawsFor(one.db, 'NORTH')).toHaveLength(1);
    expect(drawsAgainst(one.db, 'M-1')[0]?.amount).toBe(100000);
  });

  it('refuse a deposit for an agent nobody has', () => {
    const one = ready();
    expect(() => saveDeposit(one.db, deposit({ agent: 'NOBODY' }))).toThrow(/FOREIGN KEY/);
  });

  it('refuse the same reference twice', () => {
    const one = ready();
    saveDeposit(one.db, deposit());
    expect(() => saveDeposit(one.db, deposit())).toThrow(/UNIQUE/);
  });
});

import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';

import {
  describeAccount,
  dueDate,
  makeAccount,
  standing,
  withDiscount,
  withLimit,
  withStop,
  wouldExceedLimit,
} from '../../../src/domain/billing/account';
import type { Account } from '../../../src/domain/billing/account';

const RAISED = parseInstant('2025-06-30T09:00Z');

function account(overrides: Partial<Parameters<typeof makeAccount>[0]> = {}): Account {
  return makeAccount({
    agent: 'SEAWAY',
    name: 'Seaway Shipping Agencies',
    termsDays: 30,
    discount: 750,
    creditLimit: 5000000,
    ...overrides,
  });
}

describe('building an account', () => {
  it('keeps what it was given and defaults the rest', () => {
    const bare = makeAccount({ agent: 'NORTH', name: 'Northern Agents' });
    expect(bare.termsDays).toBe(30);
    expect(bare.discount).toBe(0);
    expect(bare.creditLimit).toBe(0);
    expect(bare.stopped).toBe(false);
    expect(bare.requiresDeposit).toBe(false);
  });

  it('refuses an account that is not one', () => {
    expect(() => account({ agent: 'seaway' })).toThrow(/upper case/);
    expect(() => account({ name: ' ' })).toThrow(/has no name/);
    expect(() => account({ termsDays: 400 })).toThrow(/terms nobody agreed to/);
    expect(() => account({ discount: 9000 })).toThrow(/discount that is not one/);
    expect(() => account({ creditLimit: -1 })).toThrow(/negative credit limit/);
    expect(() => account({ creditLimit: 1.5 })).toThrow(/whole cents/);
  });
});

describe('terms', () => {
  it('puts the due date the agreed days out', () => {
    expect(dueDate(account(), RAISED)).toBe(RAISED + 30 * 1440);
    expect(dueDate(account({ termsDays: 0 }), RAISED)).toBe(RAISED);
  });
});

describe('where the account stands', () => {
  it('reads a clear account as clear', () => {
    const result = standing(account(), 1000000);
    expect(result.reason).toBe('clear');
    expect(result.canOrder).toBe(true);
    expect(result.headroom).toBe(4000000);
  });

  it('reads an account over its limit', () => {
    const result = standing(account(), 6000000);
    expect(result.reason).toBe('over-limit');
    expect(result.canOrder).toBe(false);
    expect(result.headroom).toBeLessThan(0);
  });

  it('puts a manual stop ahead of the limit', () => {
    const result = standing(withStop(account(), true), 0);
    expect(result.reason).toBe('stopped');
    expect(result.canOrder).toBe(false);
  });

  it('leaves an account with no limit alone whatever it owes', () => {
    const result = standing(account({ creditLimit: 0 }), 99000000);
    expect(result.reason).toBe('clear');
    expect(result.canOrder).toBe(true);
  });

  it('says whether one more movement would take it over', () => {
    expect(wouldExceedLimit(account(), 4900000, 200000)).toBe(true);
    expect(wouldExceedLimit(account(), 4000000, 200000)).toBe(false);
    expect(wouldExceedLimit(account({ creditLimit: 0 }), 99000000, 200000)).toBe(false);
  });
});

describe('changing an account', () => {
  it('puts it on stop and takes it off again', () => {
    const stopped = withStop(account(), true);
    expect(stopped.stopped).toBe(true);
    expect(withStop(stopped, false).stopped).toBe(false);
  });

  it('changes the discount and the limit through the same checks', () => {
    expect(withDiscount(account(), 1000).discount).toBe(1000);
    expect(withLimit(account(), 100).creditLimit).toBe(100);
    expect(() => withDiscount(account(), 9000)).toThrow(/discount that is not one/);
    expect(() => withLimit(account(), -5)).toThrow(/negative credit limit/);
  });

  it('describes itself in one line', () => {
    expect(describeAccount(account())).toBe(
      'SEAWAY Seaway Shipping Agencies, 30 day terms, 7.5 percent',
    );
    expect(describeAccount(withStop(account(), true))).toContain('on stop');
  });
});

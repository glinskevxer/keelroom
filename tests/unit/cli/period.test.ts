import { afterEach, describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY } from '../../../src/util/clock';
import { readPeriod, readStart } from '../../../src/cli/period';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

describe('reading a period', () => {
  it('runs forward from now by default', () => {
    harness = testContext();
    expect(readPeriod(harness.context, {}, { days: 2 })).toEqual({
      from: NOW,
      to: NOW + 2 * MINUTES_PER_DAY,
    });
  });

  it('runs backwards when the command counts backwards', () => {
    harness = testContext();
    expect(readPeriod(harness.context, {}, { days: 30, backwards: true })).toEqual({
      from: NOW - 30 * MINUTES_PER_DAY,
      to: NOW,
    });
  });

  it('takes a start in district local time', () => {
    harness = testContext();
    const period = readPeriod(harness.context, { from: '2025-04-05' }, { days: 1 });
    expect(period.to - period.from).toBe(MINUTES_PER_DAY);
    expect(readStart(harness.context, { from: '2025-04-05' })).toBe(period.from);
  });

  it('takes both ends when both are given', () => {
    harness = testContext();
    const period = readPeriod(
      harness.context,
      { from: '2025-04-05T00:00', to: '2025-04-07T00:00' },
      { days: 30 },
    );
    expect(period.to - period.from).toBe(2 * MINUTES_PER_DAY);
  });

  it('counts back from an end given on its own', () => {
    harness = testContext();
    const period = readPeriod(harness.context, { to: '2025-04-05T00:00', days: '3' }, {});
    expect(period.to - period.from).toBe(3 * MINUTES_PER_DAY);
  });

  it('works in hours when the command does', () => {
    harness = testContext();
    const period = readPeriod(harness.context, { hours: '6' }, { hours: 24 });
    expect(period.to - period.from).toBe(360);
  });

  it('refuses a day count that is not a number', () => {
    harness = testContext();
    expect(() => readPeriod(harness!.context, { days: 'many' })).toThrow(/whole number/);
  });
});

describe('a start the operator typed', () => {
  it('runs forward even for a command that counts backwards', () => {
    harness = testContext();
    const period = readPeriod(
      harness.context,
      { from: '2025-04-01T00:00', days: '7' },
      { days: 30, backwards: true },
    );
    expect(period.to).toBeGreaterThan(period.from);
    expect(period.to - period.from).toBe(7 * MINUTES_PER_DAY);
  });
});

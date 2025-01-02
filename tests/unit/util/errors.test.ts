import { describe, expect, it } from 'vitest';
import {
  asError,
  describeError,
  EXIT_FINDINGS,
  EXIT_INTERNAL,
  EXIT_USAGE,
  exitCodeOf,
  fail,
  InputError,
  InternalError,
  NotFoundError,
  RuleError,
  TransitionError,
  UsageError,
} from '../../../src/util/errors';

describe('exit codes', () => {
  it('gives usage errors the usage code', () => {
    expect(exitCodeOf(new UsageError('no such command'))).toBe(EXIT_USAGE);
    expect(exitCodeOf(new InputError('bad csv'))).toBe(EXIT_USAGE);
  });

  it('gives rule failures the findings code', () => {
    expect(exitCodeOf(new RuleError('draught over the limit'))).toBe(EXIT_FINDINGS);
    expect(exitCodeOf(new NotFoundError('movement', 'M-2025-0004'))).toBe(EXIT_FINDINGS);
  });

  it('treats anything unrecognised as internal', () => {
    expect(exitCodeOf(new Error('boom'))).toBe(EXIT_INTERNAL);
    expect(exitCodeOf('boom')).toBe(EXIT_INTERNAL);
    expect(exitCodeOf(new InternalError('boom'))).toBe(EXIT_INTERNAL);
  });
});

describe('describing an error', () => {
  it('appends detail in a stable order', () => {
    const error = new RuleError('under keel clearance is short', {
      reach: 'LOWER-BAR',
      shortBy: 35,
    });
    expect(error.describe()).toBe('under keel clearance is short (reach=LOWER-BAR shortBy=35)');
  });

  it('leaves a bare message alone', () => {
    expect(new UsageError('give a movement reference').describe()).toBe(
      'give a movement reference',
    );
  });

  it('names the type it was constructed as', () => {
    expect(new RuleError('x').name).toBe('RuleError');
    expect(new NotFoundError('pilot', 'P-11').name).toBe('NotFoundError');
  });

  it('builds a not found message from the kind and reference', () => {
    const error = new NotFoundError('pilot', 'P-11');
    expect(error.message).toBe('no pilot with reference P-11');
    expect(error.describe()).toBe('no pilot with reference P-11 (kind=pilot reference=P-11)');
  });

  it('builds a transition message from both states', () => {
    const error = new TransitionError('completed', 'boarded', 'the job is closed');
    expect(error.message).toBe('cannot move from completed to boarded: the job is closed');
    expect(error.from).toBe('completed');
    expect(error.to).toBe('boarded');
  });

  it('describes anything thrown', () => {
    expect(describeError(new RuleError('rule', { a: 1 }))).toBe('rule (a=1)');
    expect(describeError(new Error('plain'))).toBe('plain');
    expect(describeError({ toString: () => 'odd' })).toBe('odd');
  });

  it('narrows an unknown to an error', () => {
    const original = new Error('kept');
    expect(asError(original)).toBe(original);
    expect(asError('made').message).toBe('made');
  });

  it('fails loudly with an internal error', () => {
    expect(() => fail('cannot happen', { where: 'sweep' })).toThrow(InternalError);
    expect(() => fail('cannot happen')).toThrow(/cannot happen/);
  });
});

import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import {
  describeMovement,
  isInbound,
  isOpen,
  makeMovement,
  makeReference,
  nextReference,
  noticeHours,
  referenceSequence,
  referenceYear,
  withNote,
} from '../../../src/domain/movement/movement';
import type { Movement } from '../../../src/domain/movement/movement';

const ORDERED = parseInstant('2025-05-01T09:00Z');
const WANTED = parseInstant('2025-05-03T06:00Z');

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

describe('references', () => {
  it('pads the sequence to four digits', () => {
    expect(makeReference(2025, 4)).toBe('M-2025-0004');
    expect(makeReference(2025, 1234)).toBe('M-2025-1234');
  });

  it('reads the year and the sequence back out', () => {
    expect(referenceYear('M-2025-0004')).toBe(2025);
    expect(referenceSequence('M-2025-0004')).toBe(4);
  });

  it('refuses a reference that is not one', () => {
    expect(() => referenceYear('M-25-4')).toThrow(/not a M reference/);
    expect(() => referenceSequence('nonsense')).toThrow(InputError);
    expect(() => makeReference(1999, 1)).toThrow(/not a year/);
    expect(() => makeReference(2025, 0)).toThrow(/outside the sequence/);
    expect(() => makeReference(2025, 10000)).toThrow(InputError);
  });

  it('issues the next one in a year', () => {
    expect(nextReference(2025, [])).toBe('M-2025-0001');
    expect(nextReference(2025, ['M-2025-0001', 'M-2025-0007'])).toBe('M-2025-0008');
  });

  it('ignores other years and rubbish when issuing', () => {
    expect(nextReference(2026, ['M-2025-0900', 'nonsense'])).toBe('M-2026-0001');
  });
});

describe('building a movement', () => {
  it('keeps what it was given and starts as ordered', () => {
    const one = movement();
    expect(one.status).toBe('ordered');
    expect(one.tugs).toBe(0);
    expect(one.pilot).toBeUndefined();
    expect(one.notes).toEqual([]);
  });

  it('refuses a movement that is not one', () => {
    expect(() => movement({ reference: 'M-25-4' })).toThrow(/not a M reference/);
    expect(() => movement({ agent: 'seaway' })).toThrow(/upper case/);
    expect(() => movement({ draught: 0 })).toThrow(/no declared draught/);
    expect(() => movement({ from: 'GRAIN-3', to: 'GRAIN-3' })).toThrow(/same place/);
    expect(() => movement({ requestedFor: ORDERED - 60 })).toThrow(/wanted before it was ordered/);
    expect(() => movement({ tugs: -1 })).toThrow(/impossible number of tugs/);
  });

  it('lets a swing start and end in the same place', () => {
    expect(movement({ kind: 'swing', from: 'GRAIN-3', to: 'GRAIN-3' }).kind).toBe('swing');
  });
});

describe('reading a movement', () => {
  it('counts the notice the agent gave', () => {
    expect(noticeHours(movement())).toBe(45);
    expect(noticeHours(movement({ requestedFor: ORDERED + 90 }))).toBe(1);
  });

  it('knows which states are still open', () => {
    expect(isOpen(movement())).toBe(true);
    expect(isOpen(movement({ status: 'boarded' }))).toBe(true);
    expect(isOpen(movement({ status: 'completed' }))).toBe(false);
    expect(isOpen(movement({ status: 'cancelled' }))).toBe(false);
    expect(isOpen(movement({ status: 'refused' }))).toBe(false);
  });

  it('knows an arrival from anything else', () => {
    expect(isInbound(movement())).toBe(true);
    expect(isInbound(movement({ kind: 'shift', from: 'GRAIN-3', to: 'OIL-1' }))).toBe(false);
  });

  it('adds a note and refuses an empty one', () => {
    const noted = withNote(movement(), '  held for tide  ');
    expect(noted.notes).toEqual(['held for tide']);
    expect(withNote(noted, 'sailed').notes).toHaveLength(2);
    expect(() => withNote(noted, '   ')).toThrow(/not a note/);
  });

  it('describes itself in one line', () => {
    expect(describeMovement(movement(), -240)).toBe(
      'M-2025-0004 arrival 9074729 SEA to GRAIN-3 on 2025-05-03 (ordered)',
    );
  });

  it('describes against the planned time once there is one', () => {
    const planned = movement({ plannedFor: parseInstant('2025-05-04T02:00Z') });
    expect(describeMovement(planned, -240)).toContain('2025-05-03');
  });
});

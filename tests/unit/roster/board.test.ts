import { describe, expect, it } from 'vitest';
import { InputError, NotFoundError } from '../../../src/util/errors';
import { makePilot } from '../../../src/domain/roster/pilot';
import type { Pilot } from '../../../src/domain/roster/pilot';
import {
  addPilot,
  entryFor,
  jobSpread,
  makeBoard,
  order,
  passOver,
  positionOf,
  removePilot,
  renumber,
  repeatedlyPassed,
  takeTurn,
  topOfBoard,
} from '../../../src/domain/roster/board';

function pilot(id: string, seniority: number): Pilot {
  return makePilot({ id, name: `Pilot ${id}`, grade: 'unlimited', seniority });
}

const PILOTS = [pilot('P07', 3), pilot('P02', 1), pilot('P11', 2)];

describe('drawing up a board', () => {
  it('starts in seniority order', () => {
    expect(order(makeBoard(PILOTS))).toEqual(['P02', 'P11', 'P07']);
  });

  it('starts everybody at no jobs and no passes', () => {
    for (const entry of makeBoard(PILOTS).entries) {
      expect(entry.jobs).toBe(0);
      expect(entry.passes).toBe(0);
      expect(entry.lastJobEnded).toBeUndefined();
    }
  });

  it('refuses a board with nobody on it', () => {
    expect(() => makeBoard([])).toThrow(/at least one pilot/);
  });

  it('reads a position and the top', () => {
    const board = makeBoard(PILOTS);
    expect(positionOf(board, 'P11')).toBe(2);
    expect(topOfBoard(board)).toBe('P02');
    expect(positionOf(board, 'P99')).toBe(0);
  });

  it('refuses to read a pilot who is not on it', () => {
    expect(() => entryFor(makeBoard(PILOTS), 'P99')).toThrow(NotFoundError);
  });
});

describe('taking a turn', () => {
  const board = makeBoard(PILOTS);

  it('sends the pilot to the bottom', () => {
    const after = takeTurn(board, 'P02', 1000);
    expect(order(after)).toEqual(['P11', 'P07', 'P02']);
  });

  it('records the job and when it ended', () => {
    const entry = entryFor(takeTurn(board, 'P02', 1000), 'P02');
    expect(entry.jobs).toBe(1);
    expect(entry.lastJobEnded).toBe(1000);
  });

  it('leaves the original board alone', () => {
    takeTurn(board, 'P02', 1000);
    expect(order(board)).toEqual(['P02', 'P11', 'P07']);
  });

  it('cycles the whole board back round', () => {
    let current = board;
    for (const pilotId of ['P02', 'P11', 'P07']) {
      current = takeTurn(current, pilotId, 1000);
    }
    expect(order(current)).toEqual(['P02', 'P11', 'P07']);
    expect(current.entries.every((entry) => entry.jobs === 1)).toBe(true);
  });

  it('refuses a pilot who is not on the board', () => {
    expect(() => takeTurn(board, 'P99', 1000)).toThrow(NotFoundError);
  });
});

describe('being passed over', () => {
  const board = makeBoard(PILOTS);

  it('keeps the place and counts the pass', () => {
    const after = passOver(board, 'P02');
    expect(order(after)).toEqual(['P02', 'P11', 'P07']);
    expect(entryFor(after, 'P02').passes).toBe(1);
  });

  it('clears the count when the pilot finally gets a ship', () => {
    const passed = passOver(passOver(board, 'P02'), 'P02');
    expect(entryFor(passed, 'P02').passes).toBe(2);
    expect(entryFor(takeTurn(passed, 'P02', 1000), 'P02').passes).toBe(0);
  });

  it('flags a pilot passed over too often', () => {
    let current = board;
    for (let index = 0; index < 4; index += 1) {
      current = passOver(current, 'P11');
    }
    expect(repeatedlyPassed(current).map((entry) => entry.pilot)).toEqual(['P11']);
    expect(repeatedlyPassed(current, 5)).toEqual([]);
  });
});

describe('keeping the board tidy', () => {
  it('renumbers from one without changing the order', () => {
    const board = takeTurn(takeTurn(makeBoard(PILOTS), 'P02', 1), 'P11', 2);
    const tidy = renumber(board);
    expect(order(tidy)).toEqual(order(board));
    expect(tidy.entries.map((entry) => entry.turn).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('adds a new pilot at the bottom', () => {
    const board = addPilot(makeBoard(PILOTS), pilot('P14', 4));
    expect(order(board).at(-1)).toBe('P14');
    expect(() => addPilot(board, pilot('P14', 4))).toThrow(/already on the board/);
  });

  it('takes a pilot off', () => {
    const board = removePilot(makeBoard(PILOTS), 'P11');
    expect(order(board)).toEqual(['P02', 'P07']);
    expect(() => removePilot(board, 'P11')).toThrow(NotFoundError);
  });

  it('reads the spread of work', () => {
    const board = takeTurn(takeTurn(makeBoard(PILOTS), 'P02', 1), 'P02', 2);
    expect(jobSpread(board)).toBe(2);
    expect(jobSpread(makeBoard(PILOTS))).toBe(0);
    expect(jobSpread({ entries: [] })).toBe(0);
  });

  it('refuses to read the top of an empty board', () => {
    expect(() => topOfBoard({ entries: [] })).toThrow(InputError);
  });
});

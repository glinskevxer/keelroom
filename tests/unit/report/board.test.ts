import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makePilot } from '../../../src/domain/roster/pilot';
import type { Pilot } from '../../../src/domain/roster/pilot';
import { makeBoard, passOver, takeTurn } from '../../../src/domain/roster/board';
import { makeDutyEntry, STANDARD_REST } from '../../../src/domain/roster/duty';
import { boardLines, boardWarnings, renderBoard, whoIsNext } from '../../../src/report/board';

const NOW = parseInstant('2025-05-01T12:00Z');
const OPTIONS = { offset: -240, now: NOW, rules: STANDARD_REST };

function pilot(id: string, seniority: number): Pilot {
  return makePilot({ id, name: `Pilot ${id}`, grade: 'unlimited', seniority });
}

const PILOTS = [pilot('P02', 1), pilot('P07', 2), pilot('P11', 3)];
const DUTY = [
  makeDutyEntry('P02', 'M-2025-0001', NOW - 600, NOW - 400),
  makeDutyEntry('P07', 'M-2025-0002', NOW - 300, NOW - 100),
];

describe('the lines', () => {
  it('follow the board order', () => {
    const board = takeTurn(makeBoard(PILOTS), 'P02', NOW - 400);
    expect(boardLines(board, PILOTS, DUTY, OPTIONS).map((line) => line.pilot)).toEqual([
      'P07',
      'P11',
      'P02',
    ]);
  });

  it('carry the jobs, the passes and the duty', () => {
    const board = passOver(takeTurn(makeBoard(PILOTS), 'P02', NOW - 400), 'P07');
    const lines = boardLines(board, PILOTS, DUTY, OPTIONS);
    const first = lines.find((line) => line.pilot === 'P02')!;
    expect(first.jobs).toBe(1);
    expect(first.dutyMinutes).toBe(200);
    expect(lines.find((line) => line.pilot === 'P07')?.passes).toBe(1);
  });

  it('say when each pilot is free again', () => {
    const lines = boardLines(makeBoard(PILOTS), PILOTS, DUTY, OPTIONS);
    expect(lines.find((line) => line.pilot === 'P11')?.availableFrom).toBe(NOW);
    expect(lines.find((line) => line.pilot === 'P07')?.availableFrom).toBeGreaterThan(NOW);
  });

  it('name a pilot the roster does not have rather than dropping the row', () => {
    const lines = boardLines(makeBoard(PILOTS), [PILOTS[0]!], DUTY, OPTIONS);
    expect(lines.find((line) => line.pilot === 'P07')?.name).toBe('not on the roster');
  });
});

describe('rendering', () => {
  it('has a row for every pilot', () => {
    const text = renderBoard(makeBoard(PILOTS), PILOTS, DUTY, OPTIONS);
    expect(text.split('\n')).toHaveLength(6);
  });

  it('marks a pilot who is free as now', () => {
    const text = renderBoard(makeBoard(PILOTS), PILOTS, DUTY, OPTIONS);
    expect(text).toContain('now');
  });

  it('says so when the board is empty', () => {
    expect(renderBoard({ entries: [] }, PILOTS, DUTY, OPTIONS)).toBe(
      'the board\nnobody on the board',
    );
  });
});

describe('warnings', () => {
  it('flag a pilot passed over too often', () => {
    let board = makeBoard(PILOTS);
    for (let index = 0; index < 4; index += 1) {
      board = passOver(board, 'P11');
    }
    expect(boardWarnings(board)[0]).toContain('P11 has been passed over 4 times');
  });

  it('flag work that has fallen unevenly', () => {
    let board = makeBoard(PILOTS);
    for (let index = 0; index < 6; index += 1) {
      board = takeTurn(board, 'P02', NOW);
    }
    expect(boardWarnings(board).some((line) => line.includes('jobs apart'))).toBe(true);
  });

  it('say nothing about a board that is running evenly', () => {
    expect(boardWarnings(makeBoard(PILOTS))).toEqual([]);
  });

  it('name who is next', () => {
    expect(whoIsNext(makeBoard(PILOTS))).toBe('P02');
    expect(whoIsNext({ entries: [] })).toBe('nobody');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/util/errors';
import { makeInterval } from '../../../src/util/interval';
import { makePilot, withEndorsement } from '../../../src/domain/roster/pilot';
import type { Pilot } from '../../../src/domain/roster/pilot';
import { makeDutyEntry } from '../../../src/domain/roster/duty';
import { makeBoard, order, passOver, takeTurn } from '../../../src/domain/roster/board';
import { migrate } from '../../../src/storage/migrate';
import {
  activePilots,
  allDuty,
  allPilots,
  boardIsEmpty,
  dutyFor,
  findPilot,
  leaveByPilot,
  leaveFor,
  loadBoard,
  recordDuty,
  recordLeave,
  requirePilot,
  saveBoard,
  savePilot,
} from '../../../src/storage/roster-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

function pilot(
  id: string,
  seniority: number,
  overrides: Partial<Parameters<typeof makePilot>[0]> = {},
): Pilot {
  return makePilot({
    id,
    name: `Pilot ${id}`,
    grade: 'unlimited',
    seniority,
    endorsements: ['NIGHT'],
    ...overrides,
  });
}

function ready(): TempDatabase {
  temp = temporaryDatabase();
  migrate(temp.db);
  return temp;
}

describe('pilots', () => {
  it('come back with their endorsements', () => {
    const one = ready();
    savePilot(one.db, withEndorsement(pilot('P07', 3), 'GRAIN-3'));
    const loaded = findPilot(one.db, 'P07')!;
    expect(loaded.endorsements).toEqual(['GRAIN-3', 'NIGHT']);
    expect(loaded.grade).toBe('unlimited');
  });

  it('replace the endorsements on a second save', () => {
    const one = ready();
    savePilot(one.db, withEndorsement(pilot('P07', 3), 'GRAIN-3'));
    savePilot(one.db, pilot('P07', 3));
    expect(findPilot(one.db, 'P07')?.endorsements).toEqual(['NIGHT']);
  });

  it('keep the licence limits', () => {
    const one = ready();
    savePilot(one.db, pilot('P11', 4, { grade: 'limited' }));
    expect(findPilot(one.db, 'P11')?.limits).toEqual({ draught: 1100, units: 500 });
  });

  it('list in seniority order and filter to the active', () => {
    const one = ready();
    savePilot(one.db, pilot('P07', 3));
    savePilot(one.db, pilot('P02', 1));
    savePilot(one.db, pilot('P11', 2, { active: false }));
    expect(allPilots(one.db).map((each) => each.id)).toEqual(['P02', 'P11', 'P07']);
    expect(activePilots(one.db).map((each) => each.id)).toEqual(['P02', 'P07']);
  });

  it('give nothing for a pilot nobody has', () => {
    const one = ready();
    expect(findPilot(one.db, 'P99')).toBeUndefined();
    expect(() => requirePilot(one.db, 'P99')).toThrow(NotFoundError);
  });
});

describe('duty', () => {
  it('comes back per pilot and in time order', () => {
    const one = ready();
    savePilot(one.db, pilot('P07', 3));
    savePilot(one.db, pilot('P02', 1));
    recordDuty(one.db, makeDutyEntry('P07', 'M-2025-0004', 2000, 2200));
    recordDuty(one.db, makeDutyEntry('P07', 'M-2025-0001', 1000, 1200));
    recordDuty(one.db, makeDutyEntry('P02', 'M-2025-0002', 1500, 1700));
    expect(dutyFor(one.db, 'P07').map((entry) => entry.movement)).toEqual([
      'M-2025-0001',
      'M-2025-0004',
    ]);
    expect(allDuty(one.db)).toHaveLength(3);
  });

  it('takes a since so a long log is not read whole', () => {
    const one = ready();
    savePilot(one.db, pilot('P07', 3));
    recordDuty(one.db, makeDutyEntry('P07', 'M-2025-0001', 1000, 1200));
    recordDuty(one.db, makeDutyEntry('P07', 'M-2025-0004', 5000, 5200));
    expect(dutyFor(one.db, 'P07', 2000)).toHaveLength(1);
    expect(allDuty(one.db, 2000)).toHaveLength(1);
  });

  it('updates rather than duplicating the same job', () => {
    const one = ready();
    savePilot(one.db, pilot('P07', 3));
    recordDuty(one.db, makeDutyEntry('P07', 'M-2025-0004', 2000, 2200));
    recordDuty(one.db, makeDutyEntry('P07', 'M-2025-0004', 2000, 2400));
    const held = dutyFor(one.db, 'P07');
    expect(held).toHaveLength(1);
    expect(held[0]?.period.to).toBe(2400);
  });
});

describe('leave', () => {
  it('comes back per pilot and grouped', () => {
    const one = ready();
    savePilot(one.db, pilot('P07', 3));
    savePilot(one.db, pilot('P02', 1));
    recordLeave(one.db, 'P07', makeInterval(1000, 2000), 'annual');
    recordLeave(one.db, 'P07', makeInterval(5000, 6000));
    recordLeave(one.db, 'P02', makeInterval(3000, 4000));
    expect(leaveFor(one.db, 'P07')).toHaveLength(2);
    expect(leaveByPilot(one.db).P02).toEqual([{ from: 3000, to: 4000 }]);
    expect(leaveFor(one.db, 'P99')).toEqual([]);
  });
});

describe('the board', () => {
  it('comes back in the same order it was saved in', () => {
    const one = ready();
    const pilots = [pilot('P02', 1), pilot('P11', 2), pilot('P07', 3)];
    for (const each of pilots) {
      savePilot(one.db, each);
    }
    const board = takeTurn(makeBoard(pilots), 'P02', 9000);
    saveBoard(one.db, board);
    expect(order(loadBoard(one.db))).toEqual(order(board));
  });

  it('keeps the passes and the job counts', () => {
    const one = ready();
    const pilots = [pilot('P02', 1), pilot('P11', 2)];
    for (const each of pilots) {
      savePilot(one.db, each);
    }
    saveBoard(one.db, passOver(takeTurn(makeBoard(pilots), 'P02', 9000), 'P11'));
    const loaded = loadBoard(one.db);
    expect(loaded.entries.find((entry) => entry.pilot === 'P02')?.jobs).toBe(1);
    expect(loaded.entries.find((entry) => entry.pilot === 'P02')?.lastJobEnded).toBe(9000);
    expect(loaded.entries.find((entry) => entry.pilot === 'P11')?.passes).toBe(1);
  });

  it('replaces the whole board on a save', () => {
    const one = ready();
    const pilots = [pilot('P02', 1), pilot('P11', 2)];
    for (const each of pilots) {
      savePilot(one.db, each);
    }
    saveBoard(one.db, makeBoard(pilots));
    saveBoard(one.db, makeBoard([pilots[0]!]));
    expect(loadBoard(one.db).entries).toHaveLength(1);
  });

  it('reads an empty board as empty', () => {
    const one = ready();
    expect(boardIsEmpty(one.db)).toBe(true);
    expect(loadBoard(one.db).entries).toEqual([]);
  });
});

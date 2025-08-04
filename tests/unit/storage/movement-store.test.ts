import { afterEach, describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { NotFoundError } from '../../../src/util/errors';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { makeAccount } from '../../../src/domain/billing/account';
import { makeMovement, withNote } from '../../../src/domain/movement/movement';
import type { Movement } from '../../../src/domain/movement/movement';
import { makeDelay } from '../../../src/domain/movement/times';
import { migrate } from '../../../src/storage/migrate';
import { saveAccount, saveVessel } from '../../../src/storage/fleet-store';
import {
  deleteMovement,
  findMovement,
  findTimes,
  movementsByStatus,
  movementsForAgent,
  movementsForVessel,
  movementsInWindow,
  referencesIssuedIn,
  requireMovement,
  saveMovement,
  saveTimes,
  tariffBookFor,
} from '../../../src/storage/movement-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

const ORDERED = parseInstant('2025-05-01T09:00Z');
const WANTED = parseInstant('2025-05-03T06:00Z');

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

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

function ready(): TempDatabase {
  temp = temporaryDatabase();
  migrate(temp.db);
  saveVessel(
    temp.db,
    makeVessel({
      imo: '9074729',
      name: 'atlantic crown',
      type: 'bulk',
      length: 22500,
      beam: 3220,
      summerDraught: 1180,
      airDraught: 4200,
      grossTonnage: 43000,
    }),
  );
  saveAccount(temp.db, makeAccount({ agent: 'SEAWAY', name: 'Seaway Agencies' }));
  return temp;
}

describe('a movement', () => {
  it('comes back as it went in', () => {
    const one = ready();
    saveMovement(one.db, movement());
    expect(findMovement(one.db, 'M-2025-0004')).toEqual(movement());
  });

  it('carries its notes in order', () => {
    const one = ready();
    const noted = withNote(withNote(movement(), 'held for tide'), 'sailed 07:40');
    saveMovement(one.db, noted);
    expect(findMovement(one.db, 'M-2025-0004')?.notes).toEqual(['held for tide', 'sailed 07:40']);
  });

  it('replaces the notes rather than adding to them', () => {
    const one = ready();
    saveMovement(one.db, withNote(movement(), 'first'));
    saveMovement(one.db, withNote(movement(), 'second'));
    expect(findMovement(one.db, 'M-2025-0004')?.notes).toEqual(['second']);
  });

  it('keeps the optional fields as absent rather than null', () => {
    const one = ready();
    saveMovement(one.db, movement());
    const loaded = findMovement(one.db, 'M-2025-0004')!;
    expect(loaded.plannedFor).toBeUndefined();
    expect(loaded.pilot).toBeUndefined();
  });

  it('updates on a second save', () => {
    const one = ready();
    saveMovement(one.db, movement());
    saveMovement(one.db, movement({ status: 'confirmed', plannedFor: WANTED + 80, pilot: 'P07' }));
    const loaded = requireMovement(one.db, 'M-2025-0004');
    expect(loaded.status).toBe('confirmed');
    expect(loaded.pilot).toBe('P07');
  });

  it('remembers the book it was priced on', () => {
    const one = ready();
    saveMovement(one.db, movement(), 'T-2025-A');
    expect(tariffBookFor(one.db, 'M-2025-0004')).toBe('T-2025-A');
    expect(tariffBookFor(one.db, 'M-2025-9999')).toBeUndefined();
  });

  it('gives nothing for one that is not there', () => {
    const one = ready();
    expect(findMovement(one.db, 'M-2025-0009')).toBeUndefined();
    expect(() => requireMovement(one.db, 'M-2025-0009')).toThrow(NotFoundError);
  });
});

describe('finding movements', () => {
  function seeded(): TempDatabase {
    const one = ready();
    saveMovement(one.db, movement());
    saveMovement(
      one.db,
      movement({
        reference: 'M-2025-0005',
        status: 'confirmed',
        requestedFor: WANTED + 1440,
        plannedFor: WANTED + 1500,
      }),
    );
    saveMovement(
      one.db,
      movement({ reference: 'M-2025-0006', kind: 'departure', from: 'GRAIN-3', to: 'SEA' }),
    );
    return one;
  }

  it('by status, in the order they are wanted', () => {
    const one = seeded();
    expect(movementsByStatus(one.db, 'ordered').map((each) => each.reference)).toEqual([
      'M-2025-0004',
      'M-2025-0006',
    ]);
    expect(movementsByStatus(one.db, 'completed')).toEqual([]);
  });

  it('by the window they fall in, planned time first', () => {
    const one = seeded();
    const found = movementsInWindow(one.db, WANTED - 60, WANTED + 60);
    expect(found.map((each) => each.reference)).toEqual(['M-2025-0004', 'M-2025-0006']);
    expect(movementsInWindow(one.db, WANTED + 1400, WANTED + 1600)).toHaveLength(1);
  });

  it('by ship and by agent', () => {
    const one = seeded();
    expect(movementsForVessel(one.db, '9074729')).toHaveLength(3);
    expect(movementsForAgent(one.db, 'SEAWAY')).toHaveLength(3);
    expect(movementsForAgent(one.db, 'NOBODY')).toEqual([]);
  });

  it('lists the references issued in a year', () => {
    const one = seeded();
    expect(referencesIssuedIn(one.db, 2025)).toEqual(['M-2025-0004', 'M-2025-0005', 'M-2025-0006']);
    expect(referencesIssuedIn(one.db, 2026)).toEqual([]);
  });
});

describe('the card', () => {
  it('comes back with its delays', () => {
    const one = ready();
    saveMovement(one.db, movement());
    saveTimes(one.db, 'M-2025-0004', {
      orderedFor: WANTED,
      boarded: WANTED + 15,
      letGo: WANTED + 30,
      allFast: WANTED + 180,
      delays: [makeDelay('vessel', WANTED + 40, WANTED + 70, 'engine not ready')],
    });
    const times = findTimes(one.db, 'M-2025-0004')!;
    expect(times.boarded).toBe(WANTED + 15);
    expect(times.delays).toHaveLength(1);
    expect(times.delays?.[0]?.note).toBe('engine not ready');
  });

  it('leaves the times that were not written as absent', () => {
    const one = ready();
    saveMovement(one.db, movement());
    saveTimes(one.db, 'M-2025-0004', { orderedFor: WANTED });
    const times = findTimes(one.db, 'M-2025-0004')!;
    expect(times.boarded).toBeUndefined();
    expect(times.delays).toBeUndefined();
  });

  it('replaces the delays on a second save', () => {
    const one = ready();
    saveMovement(one.db, movement());
    saveTimes(one.db, 'M-2025-0004', {
      orderedFor: WANTED,
      delays: [makeDelay('vessel', WANTED, WANTED + 10)],
    });
    saveTimes(one.db, 'M-2025-0004', { orderedFor: WANTED });
    expect(findTimes(one.db, 'M-2025-0004')?.delays).toBeUndefined();
  });

  it('gives nothing for a movement with no card', () => {
    const one = ready();
    saveMovement(one.db, movement());
    expect(findTimes(one.db, 'M-2025-0004')).toBeUndefined();
  });
});

describe('deleting', () => {
  it('takes the notes, the card and the delays with it', () => {
    const one = ready();
    saveMovement(one.db, withNote(movement(), 'held'));
    saveTimes(one.db, 'M-2025-0004', {
      orderedFor: WANTED,
      delays: [makeDelay('vessel', WANTED, WANTED + 10)],
    });
    expect(deleteMovement(one.db, 'M-2025-0004')).toBe(true);
    expect(findMovement(one.db, 'M-2025-0004')).toBeUndefined();
    expect(findTimes(one.db, 'M-2025-0004')).toBeUndefined();
  });

  it('says when there was nothing to delete', () => {
    const one = ready();
    expect(deleteMovement(one.db, 'M-2025-0009')).toBe(false);
  });
});

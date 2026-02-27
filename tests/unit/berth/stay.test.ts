import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeInterval } from '../../../src/util/interval';
import { makeMovement } from '../../../src/domain/movement/movement';
import type { Movement } from '../../../src/domain/movement/movement';
import {
  berthConflicts,
  candidates,
  firstFree,
  isOccupied,
  openStays,
  stayPeriod,
  staysAt,
  staysFrom,
} from '../../../src/domain/berth/stay';
import { BERTHS } from '../../support/district';

const T = parseInstant('2025-05-01T06:00Z');
const DAY = 1440;

function movement(
  reference: string,
  from: string,
  to: string,
  at: number,
  overrides: Partial<Parameters<typeof makeMovement>[0]> = {},
): Movement {
  return makeMovement({
    reference,
    kind: from === 'SEA' ? 'arrival' : to === 'SEA' ? 'departure' : 'shift',
    vessel: '9074729',
    agent: 'SEAWAY',
    from,
    to,
    draught: 1000,
    orderedAt: T - DAY,
    requestedFor: at,
    plannedFor: at,
    ...overrides,
  });
}

describe('building the stays', () => {
  it('opens one on an arrival and closes it on the departure', () => {
    const stays = staysFrom([
      movement('M-2025-0001', 'SEA', 'GRAIN-3', T),
      movement('M-2025-0002', 'GRAIN-3', 'SEA', T + DAY),
    ]);
    expect(stays).toHaveLength(1);
    expect(stays[0]?.from).toBe(T);
    expect(stays[0]?.to).toBe(T + DAY);
    expect(stays[0]?.departure).toBe('M-2025-0002');
  });

  it('leaves a stay open when she has not sailed', () => {
    const stays = staysFrom([movement('M-2025-0001', 'SEA', 'GRAIN-3', T)]);
    expect(stays[0]?.to).toBeUndefined();
    expect(openStays(stays)).toHaveLength(1);
  });

  it('follows a shift from one berth to another', () => {
    const stays = staysFrom([
      movement('M-2025-0001', 'SEA', 'GRAIN-3', T),
      movement('M-2025-0002', 'GRAIN-3', 'ANCH-A', T + DAY),
    ]);
    expect(stays.map((stay) => stay.berth)).toEqual(['GRAIN-3', 'ANCH-A']);
    expect(stays[0]?.to).toBe(T + DAY);
    expect(stays[1]?.to).toBeUndefined();
  });

  it('leaves a cancelled movement out', () => {
    const stays = staysFrom([
      movement('M-2025-0001', 'SEA', 'GRAIN-3', T, { status: 'cancelled' }),
    ]);
    expect(stays).toEqual([]);
  });

  it('reads them in time order however they were given', () => {
    const stays = staysFrom([
      movement('M-2025-0002', 'GRAIN-3', 'SEA', T + DAY),
      movement('M-2025-0001', 'SEA', 'GRAIN-3', T),
    ]);
    expect(stays[0]?.to).toBe(T + DAY);
  });

  it('gives a period that runs to the horizon while she is still there', () => {
    const stays = staysFrom([movement('M-2025-0001', 'SEA', 'GRAIN-3', T)]);
    expect(stayPeriod(stays[0]!, T + 3 * DAY)).toEqual({ from: T, to: T + 3 * DAY });
  });
});

describe('who is alongside', () => {
  const stays = staysFrom([
    movement('M-2025-0001', 'SEA', 'GRAIN-3', T),
    movement('M-2025-0002', 'GRAIN-3', 'SEA', T + DAY),
    movement('M-2025-0003', 'SEA', 'GRAIN-3', T + 2 * DAY, { vessel: '9074705' }),
  ]);

  it('lists the stays at one berth in order', () => {
    expect(staysAt(stays, 'GRAIN-3')).toHaveLength(2);
    expect(staysAt(stays, 'ANCH-A')).toEqual([]);
  });

  it('answers whether the berth is occupied at a moment', () => {
    expect(isOccupied(stays, 'GRAIN-3', T + 100, T + 5 * DAY)).toBe(true);
    expect(isOccupied(stays, 'GRAIN-3', T + DAY + 100, T + DAY + 200)).toBe(false);
  });

  it('finds no conflict when they follow each other', () => {
    expect(berthConflicts(stays, T + 3 * DAY)).toEqual([]);
  });

  it('finds a conflict when two ships are booked onto one berth', () => {
    const clash = staysFrom([
      movement('M-2025-0001', 'SEA', 'GRAIN-3', T),
      movement('M-2025-0004', 'SEA', 'GRAIN-3', T + 60, { vessel: '9074705' }),
    ]);
    const found = berthConflicts(clash, T + DAY);
    expect(found).toHaveLength(1);
    expect(found[0]?.berth).toBe('GRAIN-3');
  });
});

describe('finding a berth', () => {
  const period = makeInterval(T, T + DAY);

  it('offers a berth that is free and fits', () => {
    const found = candidates(
      BERTHS,
      [],
      period,
      { length: 22500, draught: 1000, tideHeight: 200 },
      T + DAY,
    );
    expect(firstFree(found)?.berth.id).toBe('GRAIN-3');
  });

  it('says why a berth will not do', () => {
    const found = candidates(
      BERTHS,
      [],
      period,
      { length: 30000, draught: 1000, tideHeight: 200 },
      T + DAY,
    );
    const grain = found.find((candidate) => candidate.berth.id === 'GRAIN-3');
    expect(grain?.fits).toBe(false);
    expect(grain?.reason).toContain('longer than the berth');
  });

  it('says when there is not enough water alongside', () => {
    const found = candidates(
      BERTHS,
      [],
      period,
      { length: 20000, draught: 1600, tideHeight: 0 },
      T + DAY,
    );
    expect(found.find((candidate) => candidate.berth.id === 'GRAIN-3')?.reason).toContain(
      'not enough water',
    );
  });

  it('says when somebody is already there', () => {
    const stays = staysFrom([movement('M-2025-0001', 'SEA', 'GRAIN-3', T)]);
    const found = candidates(
      BERTHS,
      stays,
      period,
      { length: 20000, draught: 1000, tideHeight: 200 },
      T + DAY,
    );
    const grain = found.find((candidate) => candidate.berth.id === 'GRAIN-3');
    expect(grain?.free).toBe(false);
    expect(grain?.reason).toContain('another ship');
  });

  it('gives nothing back when no berth will do', () => {
    const found = candidates(
      BERTHS,
      [],
      period,
      { length: 40000, draught: 1000, tideHeight: 200 },
      T + DAY,
    );
    expect(firstFree(found)).toBeUndefined();
  });
});

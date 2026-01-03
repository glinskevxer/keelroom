import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { buildPassage } from '../../../src/domain/chart/passage';
import {
  busiestReach,
  conflicts,
  inReachAt,
  occupancyOf,
  STANDARD_TRAFFIC,
  wouldConflict,
} from '../../../src/domain/traffic/occupancy';
import type { Occupancy } from '../../../src/domain/traffic/occupancy';
import { REACHES } from '../../support/district';

const T = parseInstant('2025-04-01T06:00Z');

const INBOUND = buildPassage(REACHES, 'inbound', { speed: 80, startDelay: 20, endDelay: 30 });
const OUTBOUND = buildPassage(REACHES, 'outbound', { speed: 80, startDelay: 20, endDelay: 30 });

function inbound(movement: string, startAt: number, units = 200): Occupancy[] {
  return occupancyOf({ movement, passage: INBOUND, startAt, units });
}

function outbound(movement: string, startAt: number, units = 200): Occupancy[] {
  return occupancyOf({ movement, passage: OUTBOUND, startAt, units });
}

describe('occupancy', () => {
  it('gives one entry per reach on the passage', () => {
    const held = inbound('M-2025-0001', T);
    expect(held.map((each) => each.reach)).toEqual(['APPROACH', 'LOWER-BAR', 'UPPER']);
  });

  it('follows the start time', () => {
    const early = inbound('M-2025-0001', T);
    const late = inbound('M-2025-0001', T + 120);
    expect(late[0]!.period.from - early[0]!.period.from).toBe(120);
  });

  it('adds a margin either side of each reach', () => {
    const tight = occupancyOf({
      movement: 'M-1',
      passage: INBOUND,
      startAt: T,
      units: 200,
      margin: 0,
    });
    const held = inbound('M-1', T);
    expect(tight[0]!.period.from).toBeGreaterThan(held[0]!.period.from);
  });

  it('says who is in a reach at a moment', () => {
    const held = inbound('M-2025-0001', T);
    const middle = held[1]!;
    expect(inReachAt(held, 'LOWER-BAR', middle.period.from + 5)).toHaveLength(1);
    expect(inReachAt(held, 'LOWER-BAR', middle.period.to + 500)).toEqual([]);
  });

  it('names the busiest reach', () => {
    const held = [...inbound('M-1', T), ...inbound('M-2', T + 60)];
    expect(busiestReach(held)).toBe('APPROACH');
    expect(busiestReach([])).toBeUndefined();
  });
});

describe('conflicts', () => {
  it('finds none between two ships an hour apart', () => {
    const held = [...inbound('M-1', T), ...inbound('M-2', T + 600)];
    expect(conflicts(held)).toEqual([]);
  });

  it('finds two ships going the same way as overtaking', () => {
    const held = [...inbound('M-1', T), ...inbound('M-2', T + 10)];
    const found = conflicts(held);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((conflict) => conflict.kind === 'overtaking')).toBe(true);
  });

  it('finds two ships meeting as head on', () => {
    const held = [...inbound('M-1', T), ...outbound('M-2', T)];
    const found = conflicts(held);
    expect(found.some((conflict) => conflict.kind === 'head-on')).toBe(true);
  });

  it('calls anything with a big ship in it a one way conflict', () => {
    const held = [...inbound('M-1', T, 900), ...outbound('M-2', T)];
    expect(conflicts(held)[0]?.kind).toBe('one-way');
  });

  it('puts the worst kind first', () => {
    const held = [...inbound('M-1', T, 900), ...outbound('M-2', T), ...inbound('M-3', T + 5)];
    expect(conflicts(held)[0]?.kind).toBe('one-way');
  });

  it('finds a crowded reach when three ships are in it', () => {
    const held = [...inbound('M-1', T), ...inbound('M-2', T + 5), ...inbound('M-3', T + 10)];
    expect(conflicts(held).some((conflict) => conflict.kind === 'crowded')).toBe(true);
  });

  it('honours a district that runs one way at a smaller size', () => {
    const held = [...inbound('M-1', T, 200), ...outbound('M-2', T)];
    const strict = conflicts(held, { ...STANDARD_TRAFFIC, oneWayUnits: 100 });
    expect(strict[0]?.kind).toBe('one-way');
  });

  it('never reports a movement against itself', () => {
    const held = inbound('M-1', T);
    expect(conflicts([...held, ...held])).toEqual([]);
  });
});

describe('adding a movement', () => {
  it('reports nothing when the new one fits between the others', () => {
    const existing = inbound('M-1', T);
    expect(wouldConflict(existing, inbound('M-2', T + 900))).toEqual([]);
  });

  it('reports what the new one would cause', () => {
    const existing = inbound('M-1', T);
    const found = wouldConflict(existing, outbound('M-2', T));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((conflict) => conflict.second === 'M-2' || conflict.first === 'M-2')).toBe(
      true,
    );
  });
});

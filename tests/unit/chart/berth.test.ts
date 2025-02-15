import { describe, expect, it } from 'vitest';
import {
  canLie,
  deepestLyingDraught,
  describeBerth,
  isAfloatBerth,
  lowestRestingTide,
  makeBerth,
  takesLength,
} from '../../../src/domain/chart/berth';

const QUAY = makeBerth({
  id: 'GRAIN-3',
  name: 'Grain Quay 3',
  kind: 'quay',
  reach: 'UPPER',
  depth: 1250,
  maxLength: 25000,
  restingClearance: 30,
  terminal: 'GRAIN',
});

describe('building a berth', () => {
  it('keeps what it was given', () => {
    expect(QUAY.depth).toBe(1250);
    expect(QUAY.terminal).toBe('GRAIN');
    expect(QUAY.restingClearance).toBe(30);
  });

  it('defaults the resting clearance and the terminal', () => {
    const anchorage = makeBerth({
      id: 'ANCH-A',
      name: 'Anchorage A',
      kind: 'anchorage',
      reach: 'APPROACH',
      depth: 2000,
      maxLength: 30000,
    });
    expect(anchorage.restingClearance).toBe(30);
    expect(anchorage.terminal).toBe('unassigned');
  });

  it('refuses what is not a berth', () => {
    const base = { name: 'x', kind: 'quay' as const, reach: 'U', depth: 100, maxLength: 100 };
    expect(() => makeBerth({ ...base, id: 'quay' })).toThrow(/upper case/);
    expect(() => makeBerth({ ...base, id: 'QQ', name: ' ' })).toThrow(/has no name/);
    expect(() => makeBerth({ ...base, id: 'QQ', depth: 0 })).toThrow(/no charted depth/);
    expect(() => makeBerth({ ...base, id: 'QQ', maxLength: 0 })).toThrow(/no length of ship/);
    expect(() => makeBerth({ ...base, id: 'QQ', restingClearance: -5 })).toThrow(
      /negative resting clearance/,
    );
  });
});

describe('lying alongside', () => {
  it('deepens the berth with the tide', () => {
    expect(deepestLyingDraught(QUAY, 0)).toBe(1220);
    expect(deepestLyingDraught(QUAY, 200)).toBe(1420);
  });

  it('takes a ship that fits and refuses one that does not', () => {
    expect(canLie(QUAY, 1200, 0)).toBe(true);
    expect(canLie(QUAY, 1300, 0)).toBe(false);
    expect(canLie(QUAY, 1300, 100)).toBe(true);
  });

  it('gives the least tide a ship can stay on', () => {
    expect(lowestRestingTide(QUAY, 1300)).toBe(80);
    expect(lowestRestingTide(QUAY, 1000)).toBe(-220);
  });

  it('measures the length it takes', () => {
    expect(takesLength(QUAY, 24000)).toBe(true);
    expect(takesLength(QUAY, 26000)).toBe(false);
  });

  it('tells a quay from an afloat berth', () => {
    expect(isAfloatBerth(QUAY)).toBe(false);
    const anchorage = makeBerth({
      id: 'ANCH-A',
      name: 'Anchorage A',
      kind: 'anchorage',
      reach: 'APPROACH',
      depth: 2000,
      maxLength: 30000,
    });
    expect(isAfloatBerth(anchorage)).toBe(true);
  });

  it('describes itself in one line', () => {
    expect(describeBerth(QUAY)).toBe('GRAIN-3 Grain Quay 3 (quay) on UPPER, 1250 cm');
  });
});

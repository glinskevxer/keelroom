import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import {
  chargeableDelayMinutes,
  delayMinutes,
  delaysByCause,
  detentionBlocks,
  detentionMinutes,
  isComplete,
  makeDelay,
  pilotOnBoardMinutes,
  runningMinutes,
  STANDARD_DETENTION,
  unchargeableDelayMinutes,
  waitingMinutes,
} from '../../../src/domain/movement/times';
import type { MovementTimes } from '../../../src/domain/movement/times';

const T = parseInstant('2025-05-03T06:00Z');

const RUN: MovementTimes = {
  orderedFor: T,
  boarded: T + 10,
  letGo: T + 25,
  allFast: T + 150,
};

describe('the card', () => {
  it('reads the waiting, the time on board and the run', () => {
    expect(waitingMinutes(RUN)).toBe(10);
    expect(pilotOnBoardMinutes(RUN)).toBe(140);
    expect(runningMinutes(RUN)).toBe(125);
    expect(isComplete(RUN)).toBe(true);
  });

  it('reads nothing from a card that has not been filled in', () => {
    const empty: MovementTimes = { orderedFor: T };
    expect(waitingMinutes(empty)).toBe(0);
    expect(pilotOnBoardMinutes(empty)).toBe(0);
    expect(runningMinutes(empty)).toBe(0);
    expect(isComplete(empty)).toBe(false);
  });

  it('never counts the pilot boarding early as waiting', () => {
    expect(waitingMinutes({ orderedFor: T, boarded: T - 20 })).toBe(0);
  });

  it('refuses a card where the pilot landed before he boarded', () => {
    expect(() => pilotOnBoardMinutes({ orderedFor: T, boarded: T + 100, allFast: T })).toThrow(
      /landed before he boarded/,
    );
  });
});

describe('delays', () => {
  const times: MovementTimes = {
    ...RUN,
    delays: [
      makeDelay('vessel', T + 30, T + 70, 'engine not ready'),
      makeDelay('weather', T + 80, T + 110),
      makeDelay('tug', T + 120, T + 135),
    ],
  };

  it('measures one delay', () => {
    expect(delayMinutes(times.delays![0]!)).toBe(40);
    expect(times.delays![0]?.note).toBe('engine not ready');
    expect(times.delays![1]?.note).toBeUndefined();
  });

  it('splits what the ship pays for from what she does not', () => {
    expect(chargeableDelayMinutes(times)).toBe(55);
    expect(unchargeableDelayMinutes(times)).toBe(30);
  });

  it('groups by cause for the monthly return', () => {
    expect(delaysByCause(times)).toEqual({ vessel: 40, weather: 30, tug: 15 });
    expect(delaysByCause(RUN)).toEqual({});
  });

  it('refuses a delay that ends before it starts', () => {
    expect(() => makeDelay('vessel', T + 10, T)).toThrow(InputError);
  });
});

describe('detention', () => {
  it('charges nothing inside the grace period', () => {
    expect(detentionBlocks({ orderedFor: T, boarded: T + 25 })).toBe(0);
    expect(detentionMinutes({ orderedFor: T, boarded: T + 30 })).toBe(0);
  });

  it('charges a whole started block past the grace', () => {
    expect(detentionBlocks({ orderedFor: T, boarded: T + 31 })).toBe(1);
    expect(detentionBlocks({ orderedFor: T, boarded: T + 60 })).toBe(1);
    expect(detentionBlocks({ orderedFor: T, boarded: T + 61 })).toBe(2);
    expect(detentionMinutes({ orderedFor: T, boarded: T + 61 })).toBe(60);
  });

  it('adds the waiting and the chargeable delays together', () => {
    const times: MovementTimes = {
      orderedFor: T,
      boarded: T + 20,
      delays: [makeDelay('berth', T + 40, T + 60)],
    };
    expect(detentionBlocks(times)).toBe(1);
  });

  it('two short holds together come to a charge although neither would alone', () => {
    const times: MovementTimes = {
      orderedFor: T,
      boarded: T,
      delays: [makeDelay('vessel', T, T + 20), makeDelay('berth', T + 30, T + 50)],
    };
    expect(detentionBlocks(times)).toBe(1);
    expect(detentionBlocks({ ...times, delays: [times.delays![0]!] })).toBe(0);
  });

  it('leaves a delay the district caused off the bill', () => {
    const times: MovementTimes = {
      orderedFor: T,
      boarded: T,
      delays: [makeDelay('district', T, T + 200)],
    };
    expect(detentionBlocks(times)).toBe(0);
  });

  it('honours a district that charges in a different block', () => {
    const rules = { ...STANDARD_DETENTION, grace: 0, block: 60 };
    expect(detentionBlocks({ orderedFor: T, boarded: T + 61 }, rules)).toBe(2);
    expect(detentionMinutes({ orderedFor: T, boarded: T + 61 }, rules)).toBe(120);
  });

  it('refuses a block of no length', () => {
    expect(() =>
      detentionBlocks({ orderedFor: T, boarded: T + 100 }, { ...STANDARD_DETENTION, block: 0 }),
    ).toThrow(/block of some length/);
  });
});

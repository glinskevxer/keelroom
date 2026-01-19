import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeInterval } from '../../../src/util/interval';
import { makeMovement } from '../../../src/domain/movement/movement';
import { makeDelay } from '../../../src/domain/movement/times';
import type { MovementTimes } from '../../../src/domain/movement/times';
import {
  activityByAgent,
  averageLateness,
  cancellationRate,
  inPeriod,
  latenessOf,
  punctuality,
  summarise,
  waitingHours,
  workloadByPilot,
} from '../../../src/domain/statistics/summary';
import type { MovementRecord } from '../../../src/domain/statistics/summary';

const T = parseInstant('2025-05-01T06:00Z');
const DAY = 1440;
const PERIOD = makeInterval(T - DAY, T + 7 * DAY);

function record(overrides: {
  reference?: string;
  status?: 'completed' | 'cancelled' | 'refused' | 'ordered';
  planned?: number;
  boarded?: number;
  allFast?: number;
  pilot?: string;
  agent?: string;
  charged?: number;
  delays?: MovementTimes['delays'];
}): MovementRecord {
  const planned = overrides.planned ?? T;
  const movement = makeMovement({
    reference: overrides.reference ?? 'M-2025-0001',
    kind: 'arrival',
    vessel: '9074729',
    agent: overrides.agent ?? 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught: 1100,
    orderedAt: T - 2 * DAY,
    requestedFor: planned,
    plannedFor: planned,
    status: overrides.status ?? 'completed',
    ...(overrides.pilot === undefined ? {} : { pilot: overrides.pilot }),
  });
  const times: MovementTimes | undefined =
    overrides.boarded === undefined
      ? undefined
      : {
          orderedFor: planned,
          boarded: overrides.boarded,
          allFast: overrides.allFast ?? overrides.boarded + 180,
          ...(overrides.delays === undefined ? {} : { delays: overrides.delays }),
        };
  return {
    movement,
    ...(times === undefined ? {} : { times }),
    ...(overrides.charged === undefined ? {} : { charged: overrides.charged }),
  };
}

const RECORDS: MovementRecord[] = [
  record({ reference: 'M-2025-0001', boarded: T + 5, pilot: 'P02', charged: 250000 }),
  record({
    reference: 'M-2025-0002',
    planned: T + DAY,
    boarded: T + DAY + 90,
    pilot: 'P07',
    charged: 180000,
    delays: [makeDelay('vessel', T + DAY, T + DAY + 60), makeDelay('tug', T + DAY, T + DAY + 20)],
  }),
  record({ reference: 'M-2025-0003', status: 'cancelled', planned: T + 2 * DAY, agent: 'NORTH' }),
  record({ reference: 'M-2025-0004', status: 'refused', planned: T + 3 * DAY }),
  record({ reference: 'M-2025-0005', status: 'ordered', planned: T + 40 * DAY }),
];

describe('the period', () => {
  it('takes only what falls inside it', () => {
    expect(inPeriod(RECORDS, PERIOD)).toHaveLength(4);
  });

  it('counts by state', () => {
    const summary = summarise(RECORDS, PERIOD);
    expect(summary.ordered).toBe(4);
    expect(summary.completed).toBe(2);
    expect(summary.cancelled).toBe(1);
    expect(summary.refused).toBe(1);
  });

  it('measures lateness against the planned time', () => {
    expect(latenessOf(RECORDS[0]!)).toBe(5);
    expect(latenessOf(RECORDS[1]!)).toBe(90);
    expect(latenessOf(RECORDS[2]!)).toBe(0);
  });

  it('never reads boarding early as late', () => {
    expect(latenessOf(record({ boarded: T - 30 }))).toBe(0);
  });

  it('counts the ones that ran on time', () => {
    const summary = summarise(RECORDS, PERIOD);
    expect(summary.onTime).toBe(1);
    expect(punctuality(summary)).toBe(50);
    expect(averageLateness(summary)).toBe(48);
  });

  it('honours a district that reads on time differently', () => {
    expect(summarise(RECORDS, PERIOD, 120).onTime).toBe(2);
  });

  it('totals the pilot hours and the money', () => {
    const summary = summarise(RECORDS, PERIOD);
    expect(summary.pilotHours).toBe(6);
    expect(summary.charged).toBe(430000);
  });

  it('groups the delay minutes by cause', () => {
    expect(summarise(RECORDS, PERIOD).delaysByCause).toEqual({ vessel: 60, tug: 20 });
  });

  it('reads an empty period as perfect and empty', () => {
    const summary = summarise([], PERIOD);
    expect(punctuality(summary)).toBe(100);
    expect(averageLateness(summary)).toBe(0);
    expect(cancellationRate(summary)).toBe(0);
  });

  it('reads the cancellation rate', () => {
    expect(cancellationRate(summarise(RECORDS, PERIOD))).toBe(25);
  });
});

describe('who did what', () => {
  it('lists the pilots by how many jobs they took', () => {
    const workload = workloadByPilot(RECORDS);
    expect(workload.map((each) => each.pilot)).toEqual(['P02', 'P07']);
    expect(workload[0]?.minutes).toBe(180);
  });

  it('leaves out a movement with no pilot', () => {
    expect(workloadByPilot([RECORDS[2]!])).toEqual([]);
  });

  it('lists the agents by what they were charged', () => {
    const activity = activityByAgent(RECORDS);
    expect(activity[0]?.agent).toBe('SEAWAY');
    expect(activity[0]?.charged).toBe(430000);
    expect(activity.find((each) => each.agent === 'NORTH')?.movements).toBe(1);
  });

  it('totals the waiting', () => {
    expect(waitingHours(RECORDS)).toBe(2);
    expect(waitingHours([])).toBe(0);
  });
});

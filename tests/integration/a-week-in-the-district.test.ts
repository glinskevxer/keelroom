import { afterEach, describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY } from '../../src/util/clock';
import { makeInterval, totalMinutes } from '../../src/util/interval';
import { makeNotice } from '../../src/domain/notice/notice';
import { makeObservation } from '../../src/domain/weather/observation';
import { makeTug } from '../../src/domain/tug/tug';
import { grossTotal } from '../../src/domain/billing/invoice';
import { saveBook } from '../../src/storage/billing-store';
import { saveNotice } from '../../src/storage/notice-store';
import { saveObservation } from '../../src/storage/weather-store';
import { saveTug } from '../../src/storage/tug-store';
import { checkDatabase } from '../../src/storage/backup';
import { requireMovement } from '../../src/storage/movement-store';
import { placeOrder } from '../../src/service/ordering';
import { confirmMovement, planMovement } from '../../src/service/planning';
import {
  assignPilot,
  boardVessel,
  completeMovement,
  getUnderway,
} from '../../src/service/dispatch';
import { bookForMovement } from '../../src/service/towage';
import { raiseInvoice } from '../../src/service/settlement';
import { issueInvoice, statementFor, takePayment } from '../../src/service/collections';
import { trafficDay } from '../../src/service/traffic';
import { diaryForDays } from '../../src/service/berths';
import { districtReturn } from '../../src/service/statistics';
import { trailOf } from '../../src/service/audit';
import { NOW, testContext } from '../support/context';
import type { TestContext } from '../support/context';
import { TARIFF } from '../support/cli';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function ready(): TestContext {
  harness = testContext();
  saveBook(harness.temp.db, TARIFF);
  for (const tug of [
    makeTug({ id: 'T1', name: 'Bar Master', owner: 'HARBOUR', pull: 60, escort: true }),
    makeTug({ id: 'T2', name: 'Narrows', owner: 'HARBOUR', pull: 50 }),
    makeTug({ id: 'T3', name: 'Upper Reach', owner: 'RIVER', pull: 45 }),
    makeTug({ id: 'T4', name: 'Little Star', owner: 'RIVER', pull: 30 }),
  ]) {
    saveTug(harness.temp.db, tug);
  }
  return harness;
}

interface Job {
  readonly reference: string;
  readonly startAt: number;
}

function runOne(
  vessel: string,
  draught: number,
  wantedAt: number,
  options: { agent?: string; late?: number; kind?: 'arrival' | 'departure' } = {},
): Job {
  const context = harness!.context;
  const kind = options.kind ?? 'arrival';
  const reference = placeOrder(context, {
    kind,
    vessel,
    agent: options.agent ?? 'SEAWAY',
    from: kind === 'arrival' ? 'SEA' : 'GRAIN-3',
    to: kind === 'arrival' ? 'GRAIN-3' : 'SEA',
    draught,
    requestedFor: wantedAt,
  }).movement.reference;
  const confirmation = confirmMovement(context, { reference });
  assignPilot(context, { reference });
  bookForMovement(context, reference);
  const late = options.late ?? 0;
  boardVessel(context, reference, confirmation.startAt + late);
  getUnderway(context, reference, confirmation.startAt + late + 15);
  completeMovement(context, reference, confirmation.startAt + late + 200);
  return { reference, startAt: confirmation.startAt };
}

describe('a week of ordinary work', () => {
  it('runs four ships, bills them and leaves the district sound', () => {
    ready();
    const jobs = [
      runOne('9074729', 1050, NOW + MINUTES_PER_DAY),
      runOne('9074705', 600, NOW + 2 * MINUTES_PER_DAY),
      runOne('9074729', 1100, NOW + 3 * MINUTES_PER_DAY, { late: 90 }),
      runOne('9074705', 550, NOW + 4 * MINUTES_PER_DAY, { agent: 'NORTH' }),
    ];
    expect(new Set(jobs.map((job) => job.reference)).size).toBe(4);

    const period = makeInterval(NOW, NOW + 7 * MINUTES_PER_DAY);
    const result = districtReturn(harness!.context, period);
    expect(result.summary.completed).toBe(4);
    expect(result.summary.lateMinutes).toBeGreaterThan(0);
    expect(result.pilots.length).toBeGreaterThan(1);

    const seaway = raiseInvoice(harness!.context, {
      agent: 'SEAWAY',
      from: NOW,
      to: NOW + 7 * MINUTES_PER_DAY,
      raisedAt: NOW + 7 * MINUTES_PER_DAY,
    });
    expect(seaway.movements).toHaveLength(3);
    const issued = issueInvoice(harness!.context, seaway.invoice.number);
    takePayment(harness!.context, {
      reference: 'TT 90001',
      agent: 'SEAWAY',
      amount: grossTotal(issued),
      receivedAt: NOW + 8 * MINUTES_PER_DAY,
    });
    expect(statementFor(harness!.context, 'SEAWAY', NOW + 8 * MINUTES_PER_DAY).balance).toBe(0);
    expect(checkDatabase(harness!.temp.db)).toEqual([]);
  });

  it('spreads the work across the board rather than giving it all to one pilot', () => {
    ready();
    for (let day = 1; day <= 4; day += 1) {
      runOne('9074705', 600, NOW + day * MINUTES_PER_DAY);
    }
    const period = makeInterval(NOW, NOW + 7 * MINUTES_PER_DAY);
    const result = districtReturn(harness!.context, period);
    const jobs = result.pilots.map((pilot) => pilot.jobs);
    expect(Math.max(...jobs) - Math.min(...jobs)).toBeLessThanOrEqual(1);
  });

  it('keeps the berth diary in step with the movements', () => {
    ready();
    runOne('9074729', 1050, NOW + MINUTES_PER_DAY);
    runOne('9074729', 1050, NOW + 2 * MINUTES_PER_DAY, { kind: 'departure' });
    const diary = diaryForDays(harness!.context, NOW, 7);
    expect(diary.stays).toHaveLength(1);
    expect(diary.stays[0]?.to).toBeDefined();
    expect(diary.conflicts).toEqual([]);
    expect(diary.open).toEqual([]);
  });

  it('records every decision against the movement it was made about', () => {
    ready();
    const job = runOne('9074729', 1050, NOW + MINUTES_PER_DAY);
    const trail = trailOf(harness!.context, job.reference).map((entry) => entry.action);
    expect(trail).toEqual(['order-placed', 'movement-confirmed', 'pilot-assigned']);
  });
});

describe('a week with the weather and the dredger in it', () => {
  it('holds a deep ship off while a draught cap is in force', () => {
    ready();
    const reference = placeOrder(harness!.context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 1150,
      requestedFor: NOW + MINUTES_PER_DAY,
    }).movement.reference;
    expect(planMovement(harness!.context, { reference }).result.passable).toBe(true);
    saveNotice(
      harness!.temp.db,
      makeNotice({
        id: 'N-2025-001',
        kind: 'draught-cap',
        subject: 'LOWER-BAR',
        from: NOW,
        to: NOW + 3 * MINUTES_PER_DAY,
        text: 'dredger working the bar',
        value: 1000,
        issuedAt: NOW,
      }),
    );
    const under = planMovement(harness!.context, { reference });
    expect(under.result.passable).toBe(false);
    expect(() => confirmMovement(harness!.context, { reference })).toThrow(/no window/);
  });

  it('narrows the windows when the log says it is rough', () => {
    ready();
    const reference = placeOrder(harness!.context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 1150,
      requestedFor: NOW + MINUTES_PER_DAY,
    }).movement.reference;
    const fair = planMovement(harness!.context, { reference });
    saveObservation(
      harness!.temp.db,
      makeObservation({
        at: NOW + MINUTES_PER_DAY - 60,
        wind: 22,
        visibility: 7000,
        swell: 240,
        density: 1015,
      }),
    );
    const rough = planMovement(harness!.context, { reference });
    expect(rough.weather).toBe('observed');
    expect(totalMinutes(rough.result.windows)).toBeLessThan(totalMinutes(fair.result.windows));
  });

  it('shows two ships meeting on the same tide', () => {
    ready();
    const inbound = placeOrder(harness!.context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 1050,
      requestedFor: NOW + MINUTES_PER_DAY,
    }).movement.reference;
    const first = confirmMovement(harness!.context, { reference: inbound });
    const outbound = placeOrder(harness!.context, {
      kind: 'departure',
      vessel: '9074705',
      agent: 'NORTH',
      from: 'GRAIN-3',
      to: 'SEA',
      draught: 600,
      requestedFor: first.startAt,
    }).movement.reference;
    confirmMovement(harness!.context, { reference: outbound, startAt: first.startAt });
    const day = trafficDay(harness!.context, NOW, 3);
    expect(day.conflicts.length).toBeGreaterThan(0);
    expect(day.conflicts[0]?.kind).toBe('one-way');
    expect(requireMovement(harness!.temp.db, outbound).status).toBe('confirmed');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { order as boardOrder, entryFor, loadBoardOrder } from '../../support/board';
import { placeOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import {
  assignPilot,
  boardVessel,
  completeMovement,
  getUnderway,
  jobPeriod,
} from '../../../src/service/dispatch';
import { findTimes, requireMovement } from '../../../src/storage/movement-store';
import { dutyFor, loadBoard } from '../../../src/storage/roster-store';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function confirmed(draught = 1000): string {
  const context = harness!.context;
  const reference = placeOrder(context, {
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught,
    requestedFor: NOW + 2880,
  }).movement.reference;
  confirmMovement(context, { reference });
  return reference;
}

describe('assigning', () => {
  it('gives the ship to the top of the board', () => {
    harness = testContext();
    const result = assignPilot(harness.context, { reference: confirmed() });
    expect(result.pilot.id).toBe('P02');
    expect(result.movement.status).toBe('assigned');
    expect(result.movement.pilot).toBe('P02');
  });

  it('sends that pilot to the bottom of the board', () => {
    harness = testContext();
    assignPilot(harness.context, { reference: confirmed() });
    expect(loadBoardOrder(harness.temp.db)).toEqual(['P07', 'P11', 'P02']);
  });

  it('writes the job into the duty log', () => {
    harness = testContext();
    const result = assignPilot(harness.context, { reference: confirmed() });
    const duty = dutyFor(harness.temp.db, 'P02');
    expect(duty).toHaveLength(1);
    expect(duty[0]?.period.from).toBe(result.period.from);
  });

  it('covers the whole passage and a little either side', () => {
    harness = testContext();
    const reference = confirmed();
    const movement = requireMovement(harness.temp.db, reference);
    const period = jobPeriod(harness.context, movement);
    expect(period.to - period.from).toBeGreaterThan(120);
  });

  it('refuses a movement that is not confirmed', () => {
    harness = testContext();
    const reference = placeOrder(harness.context, {
      kind: 'arrival',
      vessel: '9074729',
      agent: 'SEAWAY',
      from: 'SEA',
      to: 'GRAIN-3',
      draught: 1000,
      requestedFor: NOW + 2880,
    }).movement.reference;
    expect(() => assignPilot(harness!.context, { reference })).toThrow(/not confirmed/);
  });

  it('takes a pilot the despatcher named and records the override', () => {
    harness = testContext();
    const result = assignPilot(harness.context, {
      reference: confirmed(),
      pilot: 'P07',
      override: 'P02 wanted for the tanker',
    });
    expect(result.pilot.id).toBe('P07');
    expect(result.movement.notes.at(-1)).toContain('board overridden');
  });

  it('passes over a pilot on leave and says so', () => {
    harness = testContext();
    const reference = confirmed();
    const movement = requireMovement(harness.temp.db, reference);
    const period = jobPeriod(harness.context, movement);
    harness.temp.db
      .prepare('insert into pilot_leave (pilot, seq, from_at, to_at) values (?, 1, ?, ?)')
      .run('P02', period.from - 100, period.to + 100);
    const result = assignPilot(harness.context, { reference });
    expect(result.pilot.id).toBe('P07');
    expect(result.passes[0]?.reason).toBe('leave');
    expect(entryFor(loadBoard(harness.temp.db), 'P02').passes).toBe(1);
  });

  it('refuses when nobody can take her and still records the passes', () => {
    harness = testContext();
    const reference = confirmed();
    const movement = requireMovement(harness.temp.db, reference);
    const period = jobPeriod(harness.context, movement);
    for (const pilot of ['P02', 'P07', 'P11']) {
      harness.temp.db
        .prepare('insert into pilot_leave (pilot, seq, from_at, to_at) values (?, 1, ?, ?)')
        .run(pilot, period.from - 100, period.to + 100);
    }
    expect(() => assignPilot(harness!.context, { reference })).toThrow(/no pilot can take/);
    expect(entryFor(loadBoard(harness.temp.db), 'P02').passes).toBe(1);
  });

  it('leaves the board alone when the despatcher overrides it', () => {
    harness = testContext();
    assignPilot(harness.context, { reference: confirmed(), pilot: 'P11', override: 'training' });
    expect(boardOrder(loadBoard(harness.temp.db))).toEqual(['P02', 'P07', 'P11']);
  });
});

describe('following the job', () => {
  function assigned(): string {
    const reference = confirmed();
    assignPilot(harness!.context, { reference });
    return reference;
  }

  it('records boarding on the card', () => {
    harness = testContext();
    const reference = assigned();
    const movement = boardVessel(harness.context, reference, NOW + 2900);
    expect(movement.status).toBe('boarded');
    expect(findTimes(harness.temp.db, reference)?.boarded).toBe(NOW + 2900);
  });

  it('records letting go and completing', () => {
    harness = testContext();
    const reference = assigned();
    boardVessel(harness.context, reference, NOW + 2900);
    getUnderway(harness.context, reference, NOW + 2915);
    const done = completeMovement(harness.context, reference, NOW + 3100);
    expect(done.status).toBe('completed');
    const times = findTimes(harness.temp.db, reference)!;
    expect(times.letGo).toBe(NOW + 2915);
    expect(times.allFast).toBe(NOW + 3100);
  });

  it('writes the real times back into the duty log', () => {
    harness = testContext();
    const reference = assigned();
    boardVessel(harness.context, reference, NOW + 2900);
    getUnderway(harness.context, reference, NOW + 2915);
    completeMovement(harness.context, reference, NOW + 3100);
    const duty = dutyFor(harness.temp.db, 'P02');
    expect(duty[0]?.period.from).toBe(NOW + 2900);
    expect(duty[0]?.period.to).toBe(NOW + 3100);
  });

  it('refuses to let go before the pilot has boarded', () => {
    harness = testContext();
    const reference = assigned();
    expect(() => getUnderway(harness!.context, reference, NOW + 2915)).toThrow(/cannot move from/);
  });

  it('refuses to finish before boarding', () => {
    harness = testContext();
    const reference = assigned();
    boardVessel(harness.context, reference, NOW + 2900);
    getUnderway(harness.context, reference, NOW + 2915);
    expect(() => completeMovement(harness!.context, reference, NOW + 2800)).toThrow(
      /before the pilot boarded/,
    );
  });

  it('refuses to complete a movement with no card at all', () => {
    harness = testContext();
    const reference = confirmed();
    harness.temp.db
      .prepare('update movement set status = ? where reference = ?')
      .run('underway', reference);
    expect(() => completeMovement(harness!.context, reference, NOW + 3000)).toThrow(InputError);
  });
});

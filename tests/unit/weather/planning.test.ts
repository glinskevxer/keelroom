import { afterEach, describe, expect, it } from 'vitest';
import { totalMinutes } from '../../../src/util/interval';
import { makeObservation } from '../../../src/domain/weather/observation';
import { saveObservation } from '../../../src/storage/weather-store';
import { placeOrder } from '../../../src/service/ordering';
import { conditionsFromLog, planMovement } from '../../../src/service/planning';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function order(draught = 1150): string {
  return placeOrder(harness!.context, {
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught,
    requestedFor: NOW + 2880,
  }).movement.reference;
}

describe('choosing the conditions', () => {
  it('assumes fair weather when the log is empty', () => {
    harness = testContext();
    const found = conditionsFromLog(harness.context, NOW + 2880);
    expect(found.source).toBe('assumed');
    expect(found.conditions.movement.wind).toBe(10);
  });

  it('takes the last observation before the movement', () => {
    harness = testContext();
    saveObservation(
      harness.temp.db,
      makeObservation({ at: NOW + 2820, wind: 22, visibility: 6000, swell: 150 }),
    );
    const found = conditionsFromLog(harness.context, NOW + 2880);
    expect(found.source).toBe('observed');
    expect(found.conditions.movement.wind).toBe(22);
    expect(found.conditions.transit.waveHeight).toBe(150);
  });

  it('prefers a forecast for the time she runs', () => {
    harness = testContext();
    saveObservation(harness.temp.db, makeObservation({ at: NOW, wind: 5, visibility: 9000 }));
    saveObservation(
      harness.temp.db,
      makeObservation({ at: NOW + 2880, source: 'forecast', wind: 30, visibility: 4000 }),
    );
    const found = conditionsFromLog(harness.context, NOW + 2880);
    expect(found.source).toBe('forecast');
    expect(found.conditions.movement.wind).toBe(30);
  });

  it('says when it fell back on an old reading', () => {
    harness = testContext();
    saveObservation(
      harness.temp.db,
      makeObservation({ at: NOW + 2000, wind: 12, visibility: 9000 }),
    );
    expect(conditionsFromLog(harness.context, NOW + 2880).stale).toBe(true);
  });
});

describe('planning against the log', () => {
  it('says where the weather came from', () => {
    harness = testContext();
    const reference = order();
    expect(planMovement(harness.context, { reference }).weather).toBe('assumed');
    saveObservation(
      harness.temp.db,
      makeObservation({ at: NOW + 2820, wind: 12, visibility: 9000, swell: 60 }),
    );
    expect(planMovement(harness.context, { reference }).weather).toBe('observed');
  });

  it('says so when the caller named the conditions', () => {
    harness = testContext();
    const reference = order();
    const plan = planMovement(harness.context, {
      reference,
      conditions: {
        transit: { density: 1020, waveHeight: 40, speed: 80 },
        movement: { wind: 5, visibility: 9000 },
      },
    });
    expect(plan.weather).toBe('given');
  });

  it('narrows the windows when the log says it is blowing', () => {
    harness = testContext();
    const reference = order();
    const fair = planMovement(harness.context, { reference });
    saveObservation(
      harness.temp.db,
      makeObservation({ at: NOW + 2820, wind: 20, visibility: 8000, swell: 260 }),
    );
    const rough = planMovement(harness.context, { reference });
    expect(totalMinutes(rough.result.windows)).toBeLessThan(totalMinutes(fair.result.windows));
  });

  it('blocks the movement when the log is over the ceiling', () => {
    harness = testContext();
    const reference = order(1000);
    saveObservation(
      harness.temp.db,
      makeObservation({ at: NOW + 2820, wind: 45, visibility: 9000 }),
    );
    const plan = planMovement(harness.context, { reference });
    expect(plan.result.findings.some((finding) => finding.rule === 'RES-WIND-05')).toBe(true);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { makeObservation } from '../../../src/domain/weather/observation';
import { saveObservation } from '../../../src/storage/weather-store';
import { placeOrder } from '../../../src/service/ordering';
import { confirmMovement } from '../../../src/service/planning';
import { certificateFor, isClear } from '../../../src/service/certificate';
import { NOW, testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function confirmed(draught = 1100): string {
  const reference = placeOrder(harness!.context, {
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught,
    requestedFor: NOW + 2880,
  }).movement.reference;
  confirmMovement(harness!.context, { reference });
  return reference;
}

describe('the certificate', () => {
  it('has a line for every reach on the passage', () => {
    harness = testContext();
    const certificate = certificateFor(harness.context, confirmed());
    expect(certificate.lines.map((line) => line.reach)).toEqual(['APPROACH', 'LOWER-BAR', 'UPPER']);
  });

  it('takes the tide at the time she is in each reach, not at the start', () => {
    harness = testContext();
    const certificate = certificateFor(harness.context, confirmed());
    const times = certificate.lines.map((line) => line.at);
    expect(times[0]).toBeLessThan(times[1]!);
    expect(times[1]).toBeLessThan(times[2]!);
    expect(new Set(certificate.lines.map((line) => line.tideHeight)).size).toBeGreaterThan(1);
  });

  it('carries the working: squat, heel, swell and what was required', () => {
    harness = testContext();
    const line = certificateFor(harness.context, confirmed()).lines[1]!;
    expect(line.assessment.allowances.squat).toBeGreaterThan(0);
    expect(line.assessment.allowances.heel).toBeGreaterThan(0);
    expect(line.assessment.requiredClearance).toBeGreaterThan(0);
    expect(line.assessment.margin).toBe(line.assessment.available - line.assessment.needed);
  });

  it('names the survey age and the station it used', () => {
    harness = testContext();
    const line = certificateFor(harness.context, confirmed()).lines[0]!;
    expect(line.station).toBe('NARROWS');
    expect(line.surveyAgeDays).toBeGreaterThan(0);
    expect(line.plannedDepth).toBeLessThanOrEqual(line.chartedDepth);
  });

  it('names the reach with the least margin', () => {
    harness = testContext();
    const certificate = certificateFor(harness.context, confirmed());
    const least = Math.min(...certificate.lines.map((line) => line.assessment.margin));
    expect(certificate.leastMargin).toBe(least);
    expect(certificate.leastMarginReach).toBe('LOWER-BAR');
  });

  it('says whether she clears', () => {
    harness = testContext();
    expect(isClear(certificateFor(harness.context, confirmed(1000)))).toBe(true);
  });

  it('says where the weather came from', () => {
    harness = testContext();
    expect(certificateFor(harness.context, confirmed()).weather).toBe('assumed');
    saveObservation(
      harness.temp.db,
      makeObservation({ at: NOW + 2800, wind: 15, visibility: 8000, swell: 120 }),
    );
    expect(certificateFor(harness.context, confirmed()).weather).toBe('observed');
  });

  it('takes the swell in the log into the allowances', () => {
    harness = testContext();
    const calm = certificateFor(harness.context, confirmed()).lines[0]!.assessment.allowances.wave;
    saveObservation(
      harness.temp.db,
      makeObservation({ at: NOW + 2800, wind: 15, visibility: 8000, swell: 200 }),
    );
    const rough = certificateFor(harness.context, confirmed()).lines[0]!.assessment.allowances.wave;
    expect(rough).toBeGreaterThan(calm);
  });

  it('refuses a movement with no planned time', () => {
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
    expect(() => certificateFor(harness!.context, reference)).toThrow(InputError);
  });
});

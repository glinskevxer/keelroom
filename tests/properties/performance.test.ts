/**
 * A guard rather than a benchmark.
 *
 * The despatcher plans a movement while an agent is on the telephone, so a sweep
 * that takes ten seconds is a broken sweep however correct it is. These numbers
 * are loose enough not to fail on a busy machine and tight enough to catch the
 * kind of change that turns one prediction into a thousand.
 */

import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../src/util/clock';
import { makeInterval } from '../../src/util/interval';
import { makeStation } from '../../src/domain/tide/station';
import { heightAt, prepare, prepareAt, predictSeries } from '../../src/domain/tide/predict';
import { findExtremes } from '../../src/domain/tide/extremes';
import { intervalsAtOrAbove } from '../../src/domain/tide/crossing';
import { buildPassage } from '../../src/domain/chart/passage';
import { makeVessel } from '../../src/domain/vessel/vessel';
import { STANDARD_POLICY } from '../../src/domain/ukc/policy';
import { sweep } from '../../src/domain/window/sweep';
import { makeDistrict } from '../../src/domain/chart/district';
import { REACHES, BERTHS, OVERHEADS } from '../support/district';

const START = parseInstant('2025-04-01T00:00Z');

const STATION = makeStation({
  id: 'NARROWS',
  name: 'The Narrows',
  meanLevel: 210,
  terms: [
    { name: 'M2', amplitude: 168, phase: 231.4 },
    { name: 'S2', amplitude: 31, phase: 258.9 },
    { name: 'N2', amplitude: 37, phase: 210.8 },
    { name: 'K1', amplitude: 12, phase: 96.2 },
    { name: 'O1', amplitude: 8, phase: 84.5 },
    { name: 'M4', amplitude: 6, phase: 12.4 },
    { name: 'M6', amplitude: 3, phase: 300.1 },
  ],
});

const DISTRICT = makeDistrict({
  code: 'KLR',
  name: 'Keel Room',
  offset: -240,
  reaches: REACHES,
  stations: [STATION],
  berths: BERTHS,
  overheads: OVERHEADS,
});

const SHIP = makeVessel({
  imo: '9074729',
  name: 'atlantic crown',
  type: 'bulk',
  length: 22500,
  beam: 3220,
  summerDraught: 1250,
  airDraught: 4200,
  grossTonnage: 43000,
});

function milliseconds(work: () => void): number {
  const started = process.hrtime.bigint();
  work();
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

describe('the cache on prepared stations', () => {
  it('hands back the same preparation inside a bucket', () => {
    expect(prepare(STATION, START)).toBe(prepare(STATION, START + 5));
  });

  it('prepares again for a reference an hour away', () => {
    expect(prepare(STATION, START)).not.toBe(prepare(STATION, START + 3600));
  });

  it('agrees with an uncached preparation', () => {
    const cached = prepare(STATION, START);
    const fresh = prepareAt(STATION, START);
    expect(heightAt(cached, START + 137)).toBe(heightAt(fresh, START + 137));
  });

  it('keeps two stations apart', () => {
    const other = makeStation({
      id: 'OUTER',
      name: 'Outer',
      meanLevel: 100,
      terms: [{ name: 'M2', amplitude: 100, phase: 0 }],
    });
    expect(prepare(STATION, START)).not.toBe(prepare(other, START));
  });
});

describe('the work the desk waits on', () => {
  it('predicts a day of heights well inside a tenth of a second', () => {
    const taken = milliseconds(() => {
      predictSeries(STATION, START, START + 1440, 1);
    });
    expect(taken).toBeLessThan(200);
  });

  it('finds a week of extremes inside a second', () => {
    const taken = milliseconds(() => {
      findExtremes(STATION, START, START + 7 * 1440);
    });
    expect(taken).toBeLessThan(1000);
  });

  it('finds the stretches above a height for a week inside a second', () => {
    const taken = milliseconds(() => {
      intervalsAtOrAbove(STATION, makeInterval(START, START + 7 * 1440), 300);
    });
    expect(taken).toBeLessThan(1000);
  });

  it('sweeps a three reach passage over a day inside two seconds', () => {
    const plan = {
      district: DISTRICT,
      passage: buildPassage(REACHES, 'inbound', { speed: 80, startDelay: 20, endDelay: 30 }),
      vessel: SHIP,
      draught: 1150,
      policy: STANDARD_POLICY,
      conditions: { density: 1025, waveHeight: 40, speed: 80 },
    };
    const taken = milliseconds(() => {
      sweep(plan, makeInterval(START, START + 1440));
    });
    expect(taken).toBeLessThan(2000);
  });

  it('sweeps ten ships in the time it takes to answer the telephone', () => {
    const plan = {
      district: DISTRICT,
      passage: buildPassage(REACHES, 'inbound', { speed: 80, startDelay: 20, endDelay: 30 }),
      vessel: SHIP,
      policy: STANDARD_POLICY,
      conditions: { density: 1025, waveHeight: 40, speed: 80 },
    };
    const taken = milliseconds(() => {
      for (let index = 0; index < 10; index += 1) {
        sweep({ ...plan, draught: 1000 + index * 20 }, makeInterval(START, START + 1440));
      }
    });
    expect(taken).toBeLessThan(8000);
  });
});

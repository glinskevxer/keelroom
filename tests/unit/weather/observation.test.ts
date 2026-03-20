import { afterEach, describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import {
  beaufort,
  describeObservation,
  isCrossWind,
  makeObservation,
  readingAt,
  worstOver,
} from '../../../src/domain/weather/observation';
import type { Observation } from '../../../src/domain/weather/observation';
import { migrate } from '../../../src/storage/migrate';
import {
  forgetBefore,
  latestObservation,
  saveObservation,
  weatherAround,
  weatherBetween,
} from '../../../src/storage/weather-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

const T = parseInstant('2025-05-01T06:00Z');

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

function observation(overrides: Partial<Parameters<typeof makeObservation>[0]> = {}): Observation {
  return makeObservation({
    at: T,
    wind: 12,
    direction: 240,
    visibility: 9000,
    swell: 60,
    ...overrides,
  });
}

describe('an observation', () => {
  it('keeps what it was given and defaults the rest', () => {
    const one = observation();
    expect(one.source).toBe('observed');
    expect(one.density).toBe(1025);
    expect(one.swell).toBe(60);
  });

  it('refuses a reading that is not one', () => {
    expect(() => observation({ wind: -1 })).toThrow(/not a reading/);
    expect(() => observation({ wind: 500 })).toThrow(InputError);
    expect(() => observation({ direction: 400 })).toThrow(/not a bearing/);
    expect(() => observation({ visibility: -5 })).toThrow(InputError);
    expect(() => observation({ swell: -5 })).toThrow(/not a sea state/);
    expect(() => observation({ density: 800 })).toThrow(/outside anything measurable/);
  });

  it('reads the beaufort number', () => {
    expect(beaufort(0)).toBe(0);
    expect(beaufort(12)).toBe(4);
    expect(beaufort(35)).toBe(8);
    expect(beaufort(90)).toBe(12);
  });

  it('says when the wind is across the channel', () => {
    expect(isCrossWind(observation({ direction: 240 }), 150)).toBe(true);
    expect(isCrossWind(observation({ direction: 150 }), 150)).toBe(false);
    expect(isCrossWind(observation({ direction: 330 }), 150)).toBe(false);
  });

  it('describes itself in a line', () => {
    expect(describeObservation(observation())).toBe(
      '12 kn from 240, visibility 9000 m, swell 60 cm (observed)',
    );
  });
});

describe('choosing a reading', () => {
  const log = [
    observation({ at: T - 600 }),
    observation({ at: T, wind: 20 }),
    observation({ at: T + 600, source: 'forecast', wind: 30 }),
  ];

  it('takes the forecast for a time it covers', () => {
    const found = readingAt(log, T + 600)!;
    expect(found.reading.wind).toBe(30);
    expect(found.stale).toBe(false);
  });

  it('falls back to the last observation', () => {
    const found = readingAt(log, T + 60)!;
    expect(found.reading.wind).toBe(20);
    expect(found.stale).toBe(false);
  });

  it('says when the observation it fell back on is old', () => {
    const found = readingAt(log, T + 400)!;
    expect(found.stale).toBe(true);
  });

  it('gives nothing when the log is empty or starts later', () => {
    expect(readingAt([], T)).toBeUndefined();
    expect(readingAt(log, T - 5000)).toBeUndefined();
  });

  it('takes the worst of a period', () => {
    const worst = worstOver(log, T - 1000, T + 1000)!;
    expect(worst.wind).toBe(30);
    expect(worst.visibility).toBe(9000);
    expect(worstOver(log, T + 5000, T + 6000)).toBeUndefined();
  });
});

describe('the log on disk', () => {
  function ready(): TempDatabase {
    temp = temporaryDatabase();
    migrate(temp.db);
    return temp;
  }

  it('comes back as it went in', () => {
    const one = ready();
    saveObservation(one.db, observation());
    expect(weatherBetween(one.db, T - 10, T + 10)).toEqual([observation()]);
  });

  it('keeps an observation and a forecast for the same minute apart', () => {
    const one = ready();
    saveObservation(one.db, observation());
    saveObservation(one.db, observation({ source: 'forecast', wind: 30 }));
    expect(weatherBetween(one.db, T - 10, T + 10)).toHaveLength(2);
  });

  it('updates on a second save of the same reading', () => {
    const one = ready();
    saveObservation(one.db, observation());
    saveObservation(one.db, observation({ wind: 25 }));
    expect(weatherBetween(one.db, T - 10, T + 10)[0]?.wind).toBe(25);
  });

  it('finds the last observation before a time', () => {
    const one = ready();
    saveObservation(one.db, observation({ at: T - 600 }));
    saveObservation(one.db, observation({ at: T, wind: 20 }));
    expect(latestObservation(one.db, T + 100)?.wind).toBe(20);
    expect(latestObservation(one.db, T - 1000)).toBeUndefined();
  });

  it('reads what is around a time', () => {
    const one = ready();
    saveObservation(one.db, observation({ at: T - 600 }));
    saveObservation(one.db, observation({ at: T + 5000 }));
    expect(weatherAround(one.db, T, 720)).toHaveLength(1);
  });

  it('forgets what is older than a date', () => {
    const one = ready();
    saveObservation(one.db, observation({ at: T - 600 }));
    saveObservation(one.db, observation({ at: T }));
    expect(forgetBefore(one.db, T)).toBe(1);
    expect(weatherBetween(one.db, 0, T + 10)).toHaveLength(1);
  });
});

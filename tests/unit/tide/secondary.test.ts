import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeStation } from '../../../src/domain/tide/station';
import { findExtremes } from '../../../src/domain/tide/extremes';
import { predictHeight } from '../../../src/domain/tide/predict';
import {
  correctExtreme,
  describeSecondary,
  makeSecondary,
  secondaryExtremes,
  secondaryHeight,
  secondaryRange,
} from '../../../src/domain/tide/secondary';
import type { SecondaryPort } from '../../../src/domain/tide/secondary';

const START = parseInstant('2025-04-01T00:00Z');

const STANDARD = makeStation({
  id: 'NARROWS',
  name: 'The Narrows',
  meanLevel: 210,
  terms: [
    { name: 'M2', amplitude: 168, phase: 231.4 },
    { name: 'S2', amplitude: 31, phase: 258.9 },
    { name: 'N2', amplitude: 37, phase: 210.8 },
    { name: 'K1', amplitude: 12, phase: 96.2 },
    { name: 'O1', amplitude: 8, phase: 84.5 },
  ],
});

function port(overrides: Partial<Parameters<typeof makeSecondary>[0]> = {}): SecondaryPort {
  return makeSecondary({
    id: 'UPPER-BASIN',
    name: 'Upper Basin',
    standard: 'NARROWS',
    highWaterOffset: 35,
    lowWaterOffset: 50,
    highWaterFactor: 1100,
    lowWaterFactor: 900,
    ...overrides,
  });
}

describe('building a secondary port', () => {
  it('keeps what it was given and defaults the factors', () => {
    const plain = makeSecondary({
      id: 'BASIN',
      name: 'Basin',
      standard: 'NARROWS',
      highWaterOffset: 20,
      lowWaterOffset: 20,
    });
    expect(plain.highWaterFactor).toBe(1000);
    expect(plain.datumShift).toBe(0);
  });

  it('refuses one that is not a port', () => {
    expect(() => port({ id: 'basin' })).toThrow(/upper case/);
    expect(() => port({ name: ' ' })).toThrow(/has no name/);
    expect(() => port({ highWaterOffset: 900 })).toThrow(/offset of 900/);
    expect(() => port({ lowWaterOffset: 1.5 })).toThrow(InputError);
    expect(() => port({ highWaterFactor: 0 })).toThrow(/height factor/);
    expect(() => port({ lowWaterFactor: 5000 })).toThrow(InputError);
  });

  it('describes itself the way the tables print it', () => {
    expect(describeSecondary(port())).toBe(
      'UPPER-BASIN Upper Basin on NARROWS: HW +35 min at 1.10, LW +50 min at 0.90',
    );
  });
});

describe('correcting a turn', () => {
  const highs = findExtremes(STANDARD, START, START + 1440).filter(
    (extreme) => extreme.kind === 'high',
  );
  const lows = findExtremes(STANDARD, START, START + 1440).filter(
    (extreme) => extreme.kind === 'low',
  );

  it('moves high water later and raises it', () => {
    const corrected = correctExtreme(port(), highs[0]!, STANDARD.meanLevel);
    expect(corrected.minute).toBe(highs[0]!.minute + 35);
    expect(corrected.height).toBeGreaterThan(highs[0]!.height);
  });

  it('moves low water later and lifts it towards the mean', () => {
    const corrected = correctExtreme(port(), lows[0]!, STANDARD.meanLevel);
    expect(corrected.minute).toBe(lows[0]!.minute + 50);
    expect(corrected.height).toBeGreaterThan(lows[0]!.height);
  });

  it('leaves a port with no corrections where it was', () => {
    const same = makeSecondary({
      id: 'SAME',
      name: 'Same',
      standard: 'NARROWS',
      highWaterOffset: 0,
      lowWaterOffset: 0,
    });
    expect(correctExtreme(same, highs[0]!, STANDARD.meanLevel)).toEqual(highs[0]);
  });

  it('shifts the whole curve for a different datum', () => {
    const shifted = correctExtreme(port({ datumShift: 40 }), highs[0]!, STANDARD.meanLevel);
    const plain = correctExtreme(port(), highs[0]!, STANDARD.meanLevel);
    expect(shifted.height - plain.height).toBe(40);
  });
});

describe('the secondary curve', () => {
  it('gives a height between the turns either side', () => {
    const turns = secondaryExtremes(port(), STANDARD, START, START + 1440);
    const first = turns[0]!;
    const second = turns[1]!;
    const middle = Math.round((first.minute + second.minute) / 2);
    const height = secondaryHeight(port(), STANDARD, middle)!;
    expect(height).toBeGreaterThan(Math.min(first.height, second.height));
    expect(height).toBeLessThan(Math.max(first.height, second.height));
  });

  it('meets the corrected turns at the turns themselves', () => {
    const turns = secondaryExtremes(port(), STANDARD, START, START + 1440);
    const second = turns[1]!;
    expect(secondaryHeight(port(), STANDARD, second.minute)).toBe(second.height);
  });

  it('reads higher at the basin than at the gauge on a making tide', () => {
    const turns = secondaryExtremes(port(), STANDARD, START, START + 1440);
    const high = turns.find((turn) => turn.kind === 'high')!;
    expect(high.height).toBeGreaterThan(predictHeight(STANDARD, high.minute - 35));
  });

  it('gives the turns inside the range and no others', () => {
    const turns = secondaryExtremes(port(), STANDARD, START, START + 1440);
    for (const turn of turns) {
      expect(turn.minute).toBeGreaterThanOrEqual(START);
      expect(turn.minute).toBeLessThanOrEqual(START + 1440);
    }
    expect(turns.length).toBeGreaterThanOrEqual(3);
  });

  it('reads the range between the turns', () => {
    const range = secondaryRange(port(), STANDARD, START, START + 1440);
    expect(range).toBeGreaterThan(200);
    expect(secondaryRange(port(), STANDARD, START, START + 60)).toBe(0);
  });
});

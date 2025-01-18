import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import type { TideStation } from '../../../src/domain/tide/station';
import {
  amplitudeOf,
  describeStation,
  extremeBounds,
  formNumber,
  makeStation,
  neapRange,
  orderedTerms,
  springRange,
  termFor,
  tideForm,
} from '../../../src/domain/tide/station';

const NARROWS = makeStation({
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

describe('building a station', () => {
  it('keeps what it was given', () => {
    expect(NARROWS.id).toBe('NARROWS');
    expect(NARROWS.name).toBe('The Narrows');
    expect(NARROWS.meanLevel).toBe(210);
    expect(NARROWS.terms).toHaveLength(5);
  });

  it('upper cases the constituent names', () => {
    const station = makeStation({
      id: 'BAR',
      name: 'Outer Bar',
      meanLevel: 100,
      terms: [{ name: 'm2', amplitude: 100, phase: 0 }],
    });
    expect(station.terms[0]?.name).toBe('M2');
  });

  it('trims the name', () => {
    const station = makeStation({
      id: 'BAR',
      name: '  Outer Bar  ',
      meanLevel: 100,
      terms: [{ name: 'M2', amplitude: 100, phase: 0 }],
    });
    expect(station.name).toBe('Outer Bar');
  });

  it('refuses an id that is not a station id', () => {
    const terms = [{ name: 'M2', amplitude: 100, phase: 0 }];
    expect(() => makeStation({ id: 'narrows', name: 'x', meanLevel: 0, terms })).toThrow(
      InputError,
    );
    expect(() => makeStation({ id: 'TOOLONGNAME', name: 'x', meanLevel: 0, terms })).toThrow(
      /short and upper case/,
    );
    expect(() => makeStation({ id: '2BAR', name: 'x', meanLevel: 0, terms })).toThrow(InputError);
  });

  it('refuses a station with nothing to predict from', () => {
    expect(() => makeStation({ id: 'BAR', name: 'x', meanLevel: 0, terms: [] })).toThrow(
      /no harmonic terms/,
    );
  });

  it('refuses an unknown or repeated constituent', () => {
    expect(() =>
      makeStation({
        id: 'BAR',
        name: 'x',
        meanLevel: 0,
        terms: [{ name: 'ZZ9', amplitude: 10, phase: 0 }],
      }),
    ).toThrow(/unknown constituent ZZ9/);
    expect(() =>
      makeStation({
        id: 'BAR',
        name: 'x',
        meanLevel: 0,
        terms: [
          { name: 'M2', amplitude: 10, phase: 0 },
          { name: 'm2', amplitude: 11, phase: 0 },
        ],
      }),
    ).toThrow(/carries M2 twice/);
  });

  it('refuses readings that are not measurements', () => {
    const base = { id: 'BAR', name: 'x', meanLevel: 0 };
    expect(() =>
      makeStation({ ...base, terms: [{ name: 'M2', amplitude: 10.5, phase: 0 }] }),
    ).toThrow(/whole centimetres/);
    expect(() =>
      makeStation({ ...base, terms: [{ name: 'M2', amplitude: -1, phase: 0 }] }),
    ).toThrow(/negative amplitude/);
    expect(() =>
      makeStation({ ...base, terms: [{ name: 'M2', amplitude: 10, phase: 360 }] }),
    ).toThrow(/phase outside a turn/);
    expect(() =>
      makeStation({ ...base, meanLevel: -5, terms: [{ name: 'M2', amplitude: 1, phase: 0 }] }),
    ).toThrow(/below chart datum/);
    expect(() =>
      makeStation({ ...base, name: '  ', terms: [{ name: 'M2', amplitude: 1, phase: 0 }] }),
    ).toThrow(/has no name/);
  });
});

describe('reading a station', () => {
  it('finds a term whatever the case, and zero for one it does not carry', () => {
    expect(termFor(NARROWS, 'm2')?.amplitude).toBe(168);
    expect(termFor(NARROWS, 'M4')).toBeUndefined();
    expect(amplitudeOf(NARROWS, 'M4')).toBe(0);
  });

  it('gives the spring and neap ranges', () => {
    expect(springRange(NARROWS)).toBe(398);
    expect(neapRange(NARROWS)).toBe(274);
  });

  it('never gives a negative neap range', () => {
    const odd = makeStation({
      id: 'ODD',
      name: 'Odd',
      meanLevel: 100,
      terms: [
        { name: 'M2', amplitude: 10, phase: 0 },
        { name: 'S2', amplitude: 40, phase: 0 },
      ],
    });
    expect(neapRange(odd)).toBe(0);
  });

  it('reads the form number and the classification', () => {
    expect(formNumber(NARROWS)).toBeCloseTo(0.1005, 4);
    expect(tideForm(NARROWS)).toBe('semidiurnal');
  });

  it('classifies the other three forms', () => {
    const make = (k1: number, o1: number, m2: number, s2: number): TideStation =>
      makeStation({
        id: 'XX',
        name: 'x',
        meanLevel: 100,
        terms: [
          { name: 'M2', amplitude: m2, phase: 0 },
          { name: 'S2', amplitude: s2, phase: 0 },
          { name: 'K1', amplitude: k1, phase: 0 },
          { name: 'O1', amplitude: o1, phase: 0 },
        ],
      });
    expect(tideForm(make(40, 30, 100, 40))).toBe('mixed-mainly-semidiurnal');
    expect(tideForm(make(90, 70, 60, 20))).toBe('mixed-mainly-diurnal');
    expect(tideForm(make(120, 100, 30, 20))).toBe('diurnal');
  });

  it('refuses a form number with nothing semidiurnal in it', () => {
    const diurnalOnly = makeStation({
      id: 'DD',
      name: 'd',
      meanLevel: 100,
      terms: [{ name: 'K1', amplitude: 50, phase: 0 }],
    });
    expect(() => formNumber(diurnalOnly)).toThrow(/no semidiurnal amplitude/);
  });

  it('bounds the search either side of mean level', () => {
    const bounds = extremeBounds(NARROWS);
    expect(bounds.highest).toBe(210 + 256);
    expect(bounds.lowest).toBe(210 - 256);
  });

  it('orders the terms strongest first', () => {
    expect(orderedTerms(NARROWS).map((term) => term.name)).toEqual(['M2', 'N2', 'S2', 'K1', 'O1']);
  });

  it('describes itself in one line', () => {
    expect(describeStation(NARROWS)).toBe('NARROWS The Narrows, 5 terms, spring range 398 cm');
  });
});

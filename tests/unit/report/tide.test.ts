import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeInterval } from '../../../src/util/interval';
import { makeStation } from '../../../src/domain/tide/station';
import {
  bar,
  describeTideDay,
  renderCurve,
  renderStationSummary,
  renderTideTable,
} from '../../../src/report/tide';

const OFFSET = -240;
const START = parseInstant('2025-04-01T00:00Z');

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

describe('the table', () => {
  const text = renderTideTable(NARROWS, makeInterval(START, START + 1440), { offset: OFFSET });

  it('has a row for every turn of the tide', () => {
    const rows = text.split('\n').slice(3);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBeLessThanOrEqual(4);
  });

  it('marks high and low water', () => {
    expect(text).toContain('HW');
    expect(text).toContain('LW');
  });

  it('names the station in the title', () => {
    expect(text.split('\n')[0]).toBe('NARROWS The Narrows');
  });

  it('leaves the range blank on the last row', () => {
    const rows = text.trimEnd().split('\n');
    expect(rows.at(-1)?.trimEnd().split(/\s+/)).toHaveLength(4);
  });

  it('says so when the range holds no turns', () => {
    expect(renderTideTable(NARROWS, makeInterval(START, START + 20), { offset: OFFSET })).toContain(
      'no turns of the tide',
    );
  });
});

describe('the curve', () => {
  it('has a row for every step', () => {
    const text = renderCurve(NARROWS, makeInterval(START, START + 180), {
      offset: OFFSET,
      stepMinutes: 60,
    });
    expect(text.split('\n')).toHaveLength(7);
  });

  it('draws a bar that grows with the height', () => {
    expect(bar(0)).toBe('');
    expect(bar(200).length).toBe(10);
    expect(bar(2000).length).toBe(40);
    expect(bar(-50)).toBe('');
  });

  it('takes a title of its own', () => {
    const text = renderCurve(NARROWS, makeInterval(START, START + 60), {
      offset: OFFSET,
      title: 'the bar',
    });
    expect(text.split('\n')[0]).toBe('the bar');
  });
});

describe('the one line summaries', () => {
  it('name the best water of the day', () => {
    const line = describeTideDay(NARROWS, START + 600, OFFSET);
    expect(line).toContain('NARROWS best water');
    expect(line).toMatch(/\d\.\d\d m at \d\d:\d\d/);
  });

  it('describe a station and its form', () => {
    const line = renderStationSummary(NARROWS);
    expect(line).toContain('semidiurnal');
    expect(line).toContain('springs 3.98 m');
  });
});

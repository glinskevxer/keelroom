/**
 * The edges the ordinary tests walk past.
 *
 * Every one of these is a branch that a real day reaches eventually: a report
 * with one row, a period of no length, a district with one reach, a movement
 * with every optional field absent. They are cheap to write and they are where
 * the awkward defaults live.
 */

import { describe, expect, it } from 'vitest';
import { formatDuration, formatOffset, minuteOfDay, weekdayIndex } from '../../../src/util/clock';
import { allocateCents, ceilToStep, clamp, formatMetres } from '../../../src/util/units';
import {
  atLeast,
  firstFit,
  longest,
  shift,
  shrink,
  totalMinutes,
} from '../../../src/util/interval';
import { bullet, renderPairs, renderTable, truncate, wrap } from '../../../src/util/table';
import { parseCsv, writeCsv } from '../../../src/util/csv';
import { FindingLog, sortFindings } from '../../../src/util/finding';
import { describeError, exitCodeOf } from '../../../src/util/errors';
import { format, next } from '../../../src/util/sequence';
import { makeSeries } from '../../../src/util/sequence';

describe('the clock at its edges', () => {
  it('reads midnight and the minute before it', () => {
    expect(minuteOfDay(0, 0)).toBe(0);
    expect(minuteOfDay(-1, 0)).toBe(1439);
  });

  it('reads a week from any day', () => {
    for (let day = 0; day < 7; day += 1) {
      expect(weekdayIndex(day * 1440, 0)).toBe((3 + day) % 7);
    }
  });

  it('formats a duration of exactly an hour and of nothing', () => {
    expect(formatDuration(60)).toBe('1h00');
    expect(formatDuration(0)).toBe('0h00');
  });

  it('formats an offset of nothing as plus', () => {
    expect(formatOffset(0)).toBe('+00:00');
  });
});

describe('the arithmetic at its edges', () => {
  it('allocates a total of nothing', () => {
    expect(allocateCents(0, [1, 1])).toEqual([0, 0]);
  });

  it('ceils something already on the step', () => {
    expect(ceilToStep(100, 10)).toBe(100);
    expect(ceilToStep(0, 10)).toBe(0);
  });

  it('clamps to a single point', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it('formats nothing and a whole metre', () => {
    expect(formatMetres(0)).toBe('0.00');
    expect(formatMetres(100)).toBe('1.00');
    expect(formatMetres(100, 0)).toBe('1');
  });
});

describe('intervals at their edges', () => {
  const point = { from: 100, to: 100 };

  it('handle an interval of one minute', () => {
    expect(totalMinutes([point])).toBe(0);
    expect(longest([point])).toEqual(point);
    expect(atLeast([point], 1)).toEqual([]);
    expect(atLeast([point], 0)).toEqual([point]);
  });

  it('shrink one out of existence', () => {
    expect(shrink([{ from: 0, to: 10 }], 5)).toEqual([{ from: 5, to: 5 }]);
    expect(shrink([{ from: 0, to: 10 }], 6)).toEqual([]);
  });

  it('shift by nothing', () => {
    expect(shift([point], 0)).toEqual([point]);
  });

  it('fit a run of no minutes anywhere inside', () => {
    expect(firstFit([{ from: 0, to: 10 }], 0, 5)).toBe(5);
    expect(firstFit([], 0, 5)).toBeUndefined();
  });
});

describe('the table at its edges', () => {
  it('renders a single column and a single row', () => {
    expect(renderTable([{ heading: 'a' }], [['1']])).toBe('a\n-\n1');
  });

  it('renders a row wider than its heading and the other way about', () => {
    expect(renderTable([{ heading: 'heading' }], [['1']]).split('\n')[2]).toBe('1');
  });

  it('truncates to exactly the width', () => {
    expect(truncate('abcd', 4)).toBe('abcd');
    expect(truncate('abcde', 4)).toBe('abc~');
  });

  it('wraps a single word longer than the width', () => {
    expect(wrap('antidisestablishmentarianism', 5)).toEqual(['antidisestablishmentarianism']);
  });

  it('renders pairs of one', () => {
    expect(renderPairs([['a', 'b']])).toBe('a  b');
  });

  it('bullets nothing', () => {
    expect(bullet([])).toBe('');
  });
});

describe('csv at its edges', () => {
  it('reads a file of one column and one row', () => {
    const table = parseCsv('a\n1\n');
    expect(table.rows[0]?.get('a')).toBe('1');
  });

  it('writes a table with no rows', () => {
    expect(writeCsv(['a', 'b'], [])).toBe('a,b\n');
  });

  it('reads a file with no trailing newline', () => {
    expect(parseCsv('a,b\n1,2').rows).toHaveLength(1);
  });

  it('keeps a field of only spaces', () => {
    expect(parseCsv('a\n"   "\n').rows[0]?.get('a')).toBe('   ');
  });
});

describe('findings and errors at their edges', () => {
  it('sort an empty set and a single one', () => {
    expect(sortFindings([])).toEqual([]);
    const log = new FindingLog().block('AAA-01', 'x');
    expect(sortFindings(log.all())).toHaveLength(1);
  });

  it('describe something thrown that is not an error at all', () => {
    expect(describeError(42)).toBe('42');
    expect(describeError(null)).toBe('null');
    expect(exitCodeOf(null)).toBe(3);
  });
});

describe('sequences at their edges', () => {
  const series = makeSeries('M', 4);

  it('formats the first and the last of a year', () => {
    expect(format(series, 2025, 1)).toBe('M-2025-0001');
    expect(format(series, 2025, 9999)).toBe('M-2025-9999');
  });

  it('takes the next after the last one', () => {
    expect(() => next(series, 2025, ['M-2025-9999'])).toThrow(/outside the sequence/);
  });
});

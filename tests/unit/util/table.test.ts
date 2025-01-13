import { describe, expect, it } from 'vitest';
import { bullet, pad, renderPairs, renderTable, truncate, wrap } from '../../../src/util/table';

describe('padding', () => {
  it('fills to the width on the side asked for', () => {
    expect(pad('ab', 5, 'left')).toBe('ab   ');
    expect(pad('ab', 5, 'right')).toBe('   ab');
    expect(pad('abcde', 5, 'left')).toBe('abcde');
  });

  it('truncates rather than overflowing', () => {
    expect(pad('abcdef', 5, 'left')).toBe('abcd~');
    expect(truncate('abcdef', 3)).toBe('ab~');
    expect(truncate('abcdef', 1)).toBe('a');
    expect(truncate('abcdef', 0)).toBe('');
    expect(truncate('ab', 5)).toBe('ab');
  });
});

describe('tables', () => {
  const columns = [
    { heading: 'reach' },
    { heading: 'depth', align: 'right' as const },
    { heading: 'note' },
  ];

  it('sizes each column to its widest cell', () => {
    const text = renderTable(columns, [
      ['LOWER-BAR', '1240', 'surveyed'],
      ['CUT-A', '980', ''],
    ]);
    expect(text.split('\n')).toEqual([
      'reach      depth  note',
      '---------  -----  --------',
      'LOWER-BAR   1240  surveyed',
      'CUT-A        980',
    ]);
  });

  it('prints the title above the table', () => {
    const text = renderTable(columns, [['A', '1', '']], { title: 'reaches' });
    expect(text.split('\n')[0]).toBe('reaches');
  });

  it('prints the empty line instead of a header when there are no rows', () => {
    expect(renderTable(columns, [], { empty: 'no reaches' })).toBe('no reaches');
    expect(renderTable(columns, [])).toBe('(nothing to show)');
    expect(renderTable(columns, [], { title: 'reaches', empty: 'none' })).toBe('reaches\nnone');
  });

  it('honours a fixed width', () => {
    const text = renderTable([{ heading: 'reach', width: 4 }], [['LOWER-BAR']]);
    expect(text.split('\n')[2]).toBe('LOW~');
  });

  it('honours the gap', () => {
    const text = renderTable([{ heading: 'a' }, { heading: 'b' }], [['1', '2']], { gap: 4 });
    expect(text.split('\n')[2]).toBe('1    2');
  });

  it('refuses a table with no columns', () => {
    expect(() => renderTable([], [])).toThrow(/at least one column/);
  });

  it('pads a short row rather than failing', () => {
    const text = renderTable(columns, [['A']]);
    expect(text.split('\n')[2]).toBe('A');
  });
});

describe('pairs and prose', () => {
  it('aligns the labels', () => {
    const text = renderPairs([
      ['vessel', 'ATLANTIC CROWN'],
      ['draught', '11.80'],
    ]);
    expect(text.split('\n')).toEqual(['vessel   ATLANTIC CROWN', 'draught  11.80']);
  });

  it('indents when asked', () => {
    expect(renderPairs([['a', 'b']], { indent: 2 })).toBe('  a  b');
    expect(renderPairs([])).toBe('');
  });

  it('wraps on spaces only', () => {
    expect(wrap('the tide is making and the bar is passable', 20)).toEqual([
      'the tide is making',
      'and the bar is',
      'passable',
    ]);
    expect(wrap('   ', 10)).toEqual([]);
    expect(wrap('supercalifragilistic', 5)).toEqual(['supercalifragilistic']);
  });

  it('refuses a width of zero', () => {
    expect(() => wrap('x', 0)).toThrow(/width must be positive/);
  });

  it('bullets a list', () => {
    expect(bullet(['one', 'two'])).toBe('- one\n- two');
    expect(bullet(['one'], '*')).toBe('* one');
  });
});

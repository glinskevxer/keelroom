import { describe, expect, it } from 'vitest';
import {
  escapeField,
  parseCsv,
  requireEnum,
  requireInteger,
  writeCsv,
} from '../../../src/util/csv';
import { InputError } from '../../../src/util/errors';

describe('reading', () => {
  it('reads a header and its rows', () => {
    const table = parseCsv('imo,name\n9312345,ATLANTIC CROWN\n9400001,BAY TRADER\n');
    expect(table.columns).toEqual(['imo', 'name']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.get('name')).toBe('ATLANTIC CROWN');
    expect(table.rows[1]?.line).toBe(3);
  });

  it('takes carriage returns and a byte order mark', () => {
    const table = parseCsv('﻿imo,name\r\n9312345,ATLANTIC CROWN\r\n');
    expect(table.columns).toEqual(['imo', 'name']);
    expect(table.rows[0]?.get('imo')).toBe('9312345');
  });

  it('reads a quoted field with a comma and a newline in it', () => {
    const table = parseCsv('ref,note\nM-1,"held for tide, then sailed"\nM-2,"two\nlines"\n');
    expect(table.rows[0]?.get('note')).toBe('held for tide, then sailed');
    expect(table.rows[1]?.get('note')).toBe('two\nlines');
  });

  it('reads a doubled quote as one quote', () => {
    const table = parseCsv('ref,note\nM-1,"the ""bar"" reach"\n');
    expect(table.rows[0]?.get('note')).toBe('the "bar" reach');
  });

  it('keeps the line number a row came from when a field wrapped', () => {
    const table = parseCsv('ref,note\nM-1,"two\nlines"\nM-2,plain\n');
    expect(table.rows[1]?.line).toBe(4);
  });

  it('ignores a trailing blank line but not a blank field', () => {
    const table = parseCsv('ref,note\nM-1,\n\n');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.get('note')).toBe('');
    expect(table.rows[0]?.optional('note')).toBeUndefined();
  });

  it('refuses a row that is not the width of the header', () => {
    expect(() => parseCsv('a,b,c\n1,2\n')).toThrow(/has 2 fields/);
    expect(() => parseCsv('a,b\n1,2,3\n')).toThrow(InputError);
  });

  it('refuses a repeated or blank column name', () => {
    expect(() => parseCsv('a,a\n1,2\n')).toThrow(/repeats the column a/);
    expect(() => parseCsv('a,\n1,2\n')).toThrow(/blank column name/);
  });

  it('refuses an empty document and an unterminated quote', () => {
    expect(() => parseCsv('')).toThrow(/is empty/);
    expect(() => parseCsv('a\n"open\n')).toThrow(/inside a quoted field/);
    expect(() => parseCsv('a,b\nx"y",2\n')).toThrow(/opens a quote inside a field/);
  });

  it('names the source in its complaints', () => {
    expect(() => parseCsv('a,b\n1\n', { source: 'vessels.csv' })).toThrow(/vessels.csv line 2/);
  });

  it('answers about a column it does not have', () => {
    const table = parseCsv('a\n1\n');
    const row = table.rows[0]!;
    expect(row.has('b')).toBe(false);
    expect(row.optional('b')).toBeUndefined();
    expect(() => row.get('b')).toThrow(/has no column b/);
  });
});

describe('typed reads', () => {
  const table = parseCsv('kind,draught\ninbound,1180\noutbound,not a number\n');

  it('takes a value from a known set', () => {
    expect(requireEnum(table.rows[0]!, 'kind', ['inbound', 'outbound'])).toBe('inbound');
  });

  it('refuses a value outside the set and says what was allowed', () => {
    expect(() => requireEnum(table.rows[0]!, 'kind', ['shift', 'anchorage'])).toThrow(
      /expected one of shift, anchorage/,
    );
  });

  it('reads a whole number', () => {
    expect(requireInteger(table.rows[0]!, 'draught')).toBe(1180);
    expect(() => requireInteger(table.rows[1]!, 'draught')).toThrow(/not a whole number/);
  });
});

describe('writing', () => {
  it('quotes only what needs it', () => {
    expect(escapeField('plain')).toBe('plain');
    expect(escapeField('with,comma')).toBe('"with,comma"');
    expect(escapeField('with"quote')).toBe('"with""quote"');
  });

  it('round trips through the reader', () => {
    const text = writeCsv(
      ['ref', 'note'],
      [
        ['M-1', 'held, then sailed'],
        ['M-2', 'plain'],
      ],
    );
    const table = parseCsv(text);
    expect(table.rows.map((row) => row.get('note'))).toEqual(['held, then sailed', 'plain']);
  });

  it('refuses a row of the wrong width', () => {
    expect(() => writeCsv(['a', 'b'], [['1']])).toThrow(/against 2 columns/);
  });
});

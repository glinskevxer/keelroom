/**
 * The port authority, the agents and the survey office all send csv, and none
 * of them send the same csv. The reader is therefore strict about structure and
 * forgiving about presentation: it takes any line ending, tolerates a byte order
 * mark, trims a header name, and refuses a row whose width does not match the
 * header, because a short row is how a column silently shifts.
 */

import { InputError } from './errors';

export interface CsvRow {
  readonly line: number;
  readonly values: readonly string[];
  get(column: string): string;
  optional(column: string): string | undefined;
  has(column: string): boolean;
}

export interface CsvTable {
  readonly columns: readonly string[];
  readonly rows: readonly CsvRow[];
}

const BOM = '﻿';

export function parseCsv(text: string, options: { source?: string } = {}): CsvTable {
  const source = options.source ?? 'csv';
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const records = splitRecords(body, source);
  const first = records.shift();
  if (first === undefined) {
    throw new InputError(`${source} is empty`);
  }
  const columns = first.values.map((value) => value.trim());
  const seen = new Set<string>();
  for (const column of columns) {
    if (column === '') {
      throw new InputError(`${source} has a blank column name`);
    }
    if (seen.has(column)) {
      throw new InputError(`${source} repeats the column ${column}`);
    }
    seen.add(column);
  }
  const index = new Map(columns.map((column, position) => [column, position]));
  const rows = records
    .filter((record) => !(record.values.length === 1 && record.values[0] === ''))
    .map((record) => {
      if (record.values.length !== columns.length) {
        throw new InputError(
          `${source} line ${record.line} has ${record.values.length} fields, the header has ${columns.length}`,
        );
      }
      return makeRow(record.line, record.values, index, source);
    });
  return { columns, rows };
}

function makeRow(
  line: number,
  values: readonly string[],
  index: ReadonlyMap<string, number>,
  source: string,
): CsvRow {
  return {
    line,
    values,
    has(column: string): boolean {
      return index.has(column);
    },
    optional(column: string): string | undefined {
      const at = index.get(column);
      if (at === undefined) {
        return undefined;
      }
      const value = values[at] ?? '';
      return value === '' ? undefined : value;
    },
    get(column: string): string {
      const at = index.get(column);
      if (at === undefined) {
        throw new InputError(`${source} has no column ${column}`, { line });
      }
      return values[at] ?? '';
    },
  };
}

interface Record_ {
  readonly line: number;
  readonly values: string[];
}

function splitRecords(text: string, source: string): Record_[] {
  const records: Record_[] = [];
  let values: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      if (char === '\n') {
        line += 1;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      if (field !== '') {
        throw new InputError(`${source} line ${line} opens a quote inside a field`);
      }
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      values.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }
    if (char === '\n') {
      values.push(field);
      records.push({ line: recordLine, values });
      values = [];
      field = '';
      line += 1;
      recordLine = line;
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }
  if (quoted) {
    throw new InputError(`${source} ends inside a quoted field`);
  }
  if (field !== '' || values.length > 0) {
    values.push(field);
    records.push({ line: recordLine, values });
  }
  return records;
}

export function writeCsv(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [columns.map(escapeField).join(',')];
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new InputError(`a row has ${row.length} fields against ${columns.length} columns`);
    }
    lines.push(row.map(escapeField).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function escapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Read a column that has to be there and has to be one of a known set. */
export function requireEnum<T extends string>(
  row: CsvRow,
  column: string,
  allowed: readonly T[],
): T {
  const value = row.get(column).trim();
  if (!allowed.includes(value as T)) {
    throw new InputError(
      `line ${row.line}: ${column} is ${JSON.stringify(value)}, expected one of ${allowed.join(', ')}`,
    );
  }
  return value as T;
}

export function requireInteger(row: CsvRow, column: string): number {
  const value = row.get(column).trim();
  if (!/^-?\d+$/.test(value)) {
    throw new InputError(
      `line ${row.line}: ${column} is not a whole number: ${JSON.stringify(value)}`,
    );
  }
  return Number(value);
}

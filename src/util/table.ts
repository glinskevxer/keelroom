/**
 * The despatcher reads the console output on a fixed width terminal in the
 * pilot station, so the text renderings are plain columns rather than anything
 * that needs a wide window. Numbers go right, everything else goes left, and a
 * column that is too wide for the terminal is truncated rather than wrapped.
 */

export type Align = 'left' | 'right';

export interface Column {
  readonly heading: string;
  readonly align?: Align;
  readonly width?: number;
}

export interface TableOptions {
  /** Printed above the table when it has rows. */
  readonly title?: string;
  /** Printed instead of the table when it has none. */
  readonly empty?: string;
  readonly gap?: number;
}

export function renderTable(
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
  options: TableOptions = {},
): string {
  if (columns.length === 0) {
    throw new Error('a table needs at least one column');
  }
  const lines: string[] = [];
  if (options.title !== undefined) {
    lines.push(options.title);
  }
  if (rows.length === 0) {
    lines.push(options.empty ?? '(nothing to show)');
    return lines.join('\n');
  }
  const gap = ' '.repeat(options.gap ?? 2);
  const widths = columns.map((column, index) => {
    const fixed = column.width;
    if (fixed !== undefined) {
      return fixed;
    }
    const cells = rows.map((row) => (row[index] ?? '').length);
    return Math.max(column.heading.length, ...cells);
  });
  const heading = columns
    .map((column, index) => pad(column.heading, widths[index] ?? 0, 'left'))
    .join(gap)
    .trimEnd();
  lines.push(heading);
  lines.push(widths.map((width) => '-'.repeat(width)).join(gap));
  for (const row of rows) {
    const line = columns
      .map((column, index) => pad(row[index] ?? '', widths[index] ?? 0, column.align ?? 'left'))
      .join(gap)
      .trimEnd();
    lines.push(line);
  }
  return lines.join('\n');
}

export function pad(value: string, width: number, align: Align): string {
  const text = value.length > width ? truncate(value, width) : value;
  const fill = ' '.repeat(Math.max(0, width - text.length));
  return align === 'right' ? fill + text : text + fill;
}

export function truncate(value: string, width: number): string {
  if (width <= 0) {
    return '';
  }
  if (value.length <= width) {
    return value;
  }
  if (width === 1) {
    return value.slice(0, 1);
  }
  return `${value.slice(0, width - 1)}~`;
}

/** A two column list, for the detail views where a table would be one row. */
export function renderPairs(
  pairs: readonly (readonly [string, string])[],
  options: { indent?: number } = {},
): string {
  if (pairs.length === 0) {
    return '';
  }
  const indent = ' '.repeat(options.indent ?? 0);
  const width = Math.max(...pairs.map(([label]) => label.length));
  return pairs
    .map(([label, value]) => `${indent}${pad(label, width, 'left')}  ${value}`)
    .join('\n');
}

/** Wrap prose at a column, breaking on spaces only. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) {
    throw new Error('wrap width must be positive');
  }
  const words = text.split(/\s+/).filter((word) => word !== '');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current !== '') {
    lines.push(current);
  }
  return lines;
}

export function bullet(lines: readonly string[], marker = '-'): string {
  return lines.map((line) => `${marker} ${line}`).join('\n');
}

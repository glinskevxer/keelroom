/**
 * Where the command line writes.
 *
 * Everything goes through this rather than through console, so the tests can
 * read what a command printed without capturing the process streams, and so a
 * command that supports json has one place that decides which it is emitting.
 */

export interface Io {
  write(line: string): void;
  fail(line: string): void;
}

export function consoleIo(): Io {
  return {
    write(line: string): void {
      console.log(line);
    },
    fail(line: string): void {
      console.error(line);
    },
  };
}

export interface Recorder extends Io {
  readonly out: string[];
  readonly err: string[];
  text(): string;
  errorText(): string;
}

export function recordingIo(): Recorder {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    write(line: string): void {
      out.push(line);
    },
    fail(line: string): void {
      err.push(line);
    },
    text(): string {
      return out.join('\n');
    },
    errorText(): string {
      return err.join('\n');
    },
  };
}

export type Format = 'text' | 'json';

export function readFormat(value: unknown): Format {
  return value === 'json' ? 'json' : 'text';
}

/** Emit either the rendered text or the object, whichever was asked for. */
export function emit(io: Io, format: Format, text: string, data: unknown): void {
  if (format === 'json') {
    io.write(JSON.stringify(data, null, 2));
    return;
  }
  io.write(text);
}

export function emitLines(io: Io, lines: readonly string[]): void {
  for (const line of lines) {
    io.write(line);
  }
}

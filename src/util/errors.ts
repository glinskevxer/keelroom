/**
 * Four exit codes and one error type per reason a run can end. The cli maps an
 * error to its code in one place, so a new failure mode cannot invent a code of
 * its own.
 */

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;
export const EXIT_INTERNAL = 3;

export type ExitCode =
  | typeof EXIT_CLEAN
  | typeof EXIT_FINDINGS
  | typeof EXIT_USAGE
  | typeof EXIT_INTERNAL;

export abstract class KeelroomError extends Error {
  abstract readonly exitCode: ExitCode;

  constructor(
    message: string,
    readonly detail: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }

  /** The line the cli prints. Detail is appended in a stable order. */
  describe(): string {
    const keys = Object.keys(this.detail).sort();
    if (keys.length === 0) {
      return this.message;
    }
    const parts = keys.map((key) => `${key}=${String(this.detail[key])}`);
    return `${this.message} (${parts.join(' ')})`;
  }
}

/** The operator asked for something that is not a command, or left an argument out. */
export class UsageError extends KeelroomError {
  readonly exitCode = EXIT_USAGE;
}

/** Input that reached us is not what it claims to be. */
export class InputError extends KeelroomError {
  readonly exitCode = EXIT_USAGE;
}

/** The request is well formed and the district's rules refuse it. */
export class RuleError extends KeelroomError {
  readonly exitCode = EXIT_FINDINGS;
}

/** A record that has to exist does not. */
export class NotFoundError extends KeelroomError {
  readonly exitCode = EXIT_FINDINGS;

  constructor(kind: string, reference: string) {
    super(`no ${kind} with reference ${reference}`, { kind, reference });
  }
}

/** A state transition the lifecycle does not allow. */
export class TransitionError extends KeelroomError {
  readonly exitCode = EXIT_FINDINGS;

  constructor(
    readonly from: string,
    readonly to: string,
    reason: string,
  ) {
    super(`cannot move from ${from} to ${to}: ${reason}`, { from, to });
  }
}

/** Something the code believed could not happen. */
export class InternalError extends KeelroomError {
  readonly exitCode = EXIT_INTERNAL;
}

export function exitCodeOf(error: unknown): ExitCode {
  if (error instanceof KeelroomError) {
    return error.exitCode;
  }
  return EXIT_INTERNAL;
}

export function describeError(error: unknown): string {
  if (error instanceof KeelroomError) {
    return error.describe();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Narrow an unknown to a thrown error, so a catch block reads as one shape. */
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function fail(message: string, detail?: Record<string, string | number>): never {
  throw new InternalError(message, detail);
}

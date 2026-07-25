/**
 * The find-or-throw pair every store was writing out.
 *
 * Nine stores had their own `requireX` beside their `findX`, and the bodies had
 * drifted: two of them threw a bare Error rather than a NotFoundError, so the
 * cli gave them the internal exit code instead of the findings one, and one
 * reported the wrong kind in the message. This is that pattern once.
 */

import { NotFoundError } from '../util/errors';

/** Throw a NotFoundError naming the kind and the reference, or hand back the row. */
export function orNotFound<T>(found: T | undefined, kind: string, reference: string): T {
  if (found === undefined) {
    throw new NotFoundError(kind, reference);
  }
  return found;
}

/** Turn a finder into a requirer, which is what every store wanted. */
export function requiring<Args extends unknown[], T>(
  find: (...args: Args) => T | undefined,
  kind: string,
  reference: (...args: Args) => string,
): (...args: Args) => T {
  return (...args: Args): T => orNotFound(find(...args), kind, reference(...args));
}

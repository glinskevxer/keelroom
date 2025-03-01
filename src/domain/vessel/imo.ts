/**
 * An imo number is seven digits with a check digit, and the agents get it wrong
 * often enough that checking it is worth the twenty lines. The first six digits
 * are weighted seven down to two, summed, and the last digit of the sum is the
 * seventh digit.
 */

import { InputError } from '../../util/errors';

const SEVEN_DIGITS = /^\d{7}$/;

export function imoCheckDigit(firstSix: string): number {
  if (!/^\d{6}$/.test(firstSix)) {
    throw new InputError(`an imo number starts with six digits, got ${JSON.stringify(firstSix)}`);
  }
  let total = 0;
  for (let index = 0; index < 6; index += 1) {
    total += Number(firstSix[index]) * (7 - index);
  }
  return total % 10;
}

export function isValidImo(candidate: string): boolean {
  const trimmed = candidate.trim().replace(/^IMO[\s-]*/i, '');
  if (!SEVEN_DIGITS.test(trimmed)) {
    return false;
  }
  return imoCheckDigit(trimmed.slice(0, 6)) === Number(trimmed[6]);
}

/** Take an imo number in any of the forms an agent writes it and return the digits. */
export function normaliseImo(candidate: string): string {
  const trimmed = candidate.trim().replace(/^IMO[\s-]*/i, '');
  if (!SEVEN_DIGITS.test(trimmed)) {
    throw new InputError(`not an imo number: ${JSON.stringify(candidate)}`);
  }
  if (imoCheckDigit(trimmed.slice(0, 6)) !== Number(trimmed[6])) {
    throw new InputError(`imo number ${trimmed} fails its check digit`);
  }
  return trimmed;
}

export function formatImo(digits: string): string {
  return `IMO ${normaliseImo(digits)}`;
}

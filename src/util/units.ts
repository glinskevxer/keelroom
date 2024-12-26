/**
 * Everything measurable in this system is an integer. Depths, draughts and tide
 * heights are centimetres, money is cents, and a rate is basis points. Floats
 * turn up only when a formula genuinely needs one, and they never reach a
 * record.
 */

/** A length in whole centimetres. Negative values are legal for a tide height. */
export type Cm = number;

/** An amount of money in whole cents. */
export type Cents = number;

/** One hundredth of a percent. 250 bps is 2.5 percent. */
export type Bps = number;

const TWO_DP = /^-?\d+(\.\d{1,2})?$/;
const MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitError';
  }
}

export function isInteger(value: number): boolean {
  return Number.isFinite(value) && Math.trunc(value) === value;
}

export function assertCm(value: number, what: string): Cm {
  if (!isInteger(value)) {
    throw new UnitError(`${what} must be whole centimetres, got ${value}`);
  }
  return value;
}

export function assertCents(value: number, what: string): Cents {
  if (!isInteger(value)) {
    throw new UnitError(`${what} must be whole cents, got ${value}`);
  }
  return value;
}

/**
 * Round half away from zero. Javascript's Math.round rounds half up, which
 * gives -2.5 the value -2, and every tolerance in this system is symmetric
 * about zero.
 */
export function roundHalf(value: number): number {
  if (!Number.isFinite(value)) {
    throw new UnitError(`cannot round ${value}`);
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Round to the nearest multiple of step, half away from zero. */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) {
    throw new UnitError(`step must be positive, got ${step}`);
  }
  return roundHalf(value / step) * step;
}

/** Round away from zero to the next multiple of step. */
export function ceilToStep(value: number, step: number): number {
  if (step <= 0) {
    throw new UnitError(`step must be positive, got ${step}`);
  }
  return value < 0 ? -Math.ceil(-value / step) * step : Math.ceil(value / step) * step;
}

export function metresToCm(metres: number): Cm {
  if (!Number.isFinite(metres)) {
    throw new UnitError(`cannot convert ${metres} metres`);
  }
  return roundHalf(metres * 100);
}

export function cmToMetres(cm: Cm): number {
  return cm / 100;
}

export function feetToCm(feet: number): Cm {
  return roundHalf(feet * 30.48);
}

export function cmToFeet(cm: Cm): number {
  return cm / 30.48;
}

/**
 * Parse a decimal metre reading of at most two places. Anything finer is a
 * transcription error rather than a measurement, so it is rejected instead of
 * being silently rounded.
 */
export function parseMetres(text: string, what = 'length'): Cm {
  const trimmed = text.trim();
  if (!TWO_DP.test(trimmed)) {
    throw new UnitError(`${what} is not a metre reading: ${JSON.stringify(text)}`);
  }
  const [whole, fraction = ''] = trimmed.replace('-', '').split('.');
  const padded = (fraction + '00').slice(0, 2);
  const magnitude = Number(whole) * 100 + Number(padded);
  return trimmed.startsWith('-') ? -magnitude : magnitude;
}

export function formatMetres(cm: Cm, places = 2): string {
  if (places < 0 || places > 2) {
    throw new UnitError(`metre formatting takes 0 to 2 places, got ${places}`);
  }
  const scaled = places === 2 ? cm : roundToStep(cm, places === 1 ? 10 : 100);
  const sign = scaled < 0 ? '-' : '';
  const magnitude = Math.abs(scaled);
  const whole = Math.trunc(magnitude / 100);
  const rest = magnitude % 100;
  if (places === 0) {
    return `${sign}${whole}`;
  }
  const fraction = String(rest).padStart(2, '0').slice(0, places);
  return `${sign}${whole}.${fraction}`;
}

export function parseMoney(text: string, what = 'amount'): Cents {
  const trimmed = text.trim().replace(/,/g, '');
  if (!MONEY.test(trimmed)) {
    throw new UnitError(`${what} is not an amount: ${JSON.stringify(text)}`);
  }
  const [whole, fraction = ''] = trimmed.replace('-', '').split('.');
  const padded = (fraction + '00').slice(0, 2);
  const magnitude = Number(whole) * 100 + Number(padded);
  return trimmed.startsWith('-') ? -magnitude : magnitude;
}

export function formatMoney(cents: Cents, options: { grouped?: boolean } = {}): string {
  const sign = cents < 0 ? '-' : '';
  const magnitude = Math.abs(assertCents(cents, 'amount'));
  const whole = Math.trunc(magnitude / 100);
  const rest = String(magnitude % 100).padStart(2, '0');
  const grouped = options.grouped === true ? group(whole) : String(whole);
  return `${sign}${grouped}.${rest}`;
}

function group(value: number): string {
  const digits = String(value);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) {
      out += ',';
    }
  }
  return out;
}

/** Apply a basis point rate to an amount, rounding half away from zero. */
export function applyBps(amount: Cents, rate: Bps): Cents {
  assertCents(amount, 'amount');
  if (!isInteger(rate)) {
    throw new UnitError(`rate must be whole basis points, got ${rate}`);
  }
  return roundHalf((amount * rate) / 10_000);
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((total, value) => total + assertCents(value, 'amount'), 0);
}

export function clamp(value: number, low: number, high: number): number {
  if (low > high) {
    throw new UnitError(`clamp bounds are inverted: ${low} > ${high}`);
  }
  return Math.min(Math.max(value, low), high);
}

/**
 * Split an amount across weights so the parts add back to the total exactly.
 * The largest remainder goes to the largest fractional part, and ties break on
 * position so the result does not depend on sort stability.
 */
export function allocateCents(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total, 'total');
  if (weights.length === 0) {
    throw new UnitError('cannot allocate across no weights');
  }
  if (weights.some((weight) => weight < 0)) {
    throw new UnitError('allocation weights cannot be negative');
  }
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal === 0) {
    throw new UnitError('allocation weights sum to zero');
  }
  const exact = weights.map((weight) => (total * weight) / weightTotal);
  const floors = exact.map((value) => Math.trunc(value));
  let remainder = total - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.trunc(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const step = remainder < 0 ? -1 : 1;
  let cursor = 0;
  while (remainder !== 0) {
    const slot = order[cursor % order.length];
    if (slot === undefined) {
      throw new UnitError('allocation ran out of slots');
    }
    floors[slot.index] = (floors[slot.index] ?? 0) + step;
    remainder -= step;
    cursor += 1;
  }
  return floors;
}

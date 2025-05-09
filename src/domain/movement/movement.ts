/**
 * A movement is one job: one ship, from somewhere to somewhere, with a pilot on
 * board.
 *
 * The record is deliberately flat and deliberately dull. Everything that can be
 * derived is derived elsewhere; what is stored is what somebody typed or what
 * actually happened. The reference is the district's own, and it is the thing
 * the agents, the tugs and the invoice all quote, so it is generated once and
 * never reissued.
 */

import { InputError } from '../../util/errors';
import type { Minute } from '../../util/clock';
import { localDate } from '../../util/clock';
import type { Cm } from '../../util/units';
import { assertCm } from '../../util/units';

export type MovementKind = 'arrival' | 'departure' | 'shift' | 'anchorage' | 'swing';

export type MovementStatus =
  | 'ordered'
  | 'confirmed'
  | 'assigned'
  | 'boarded'
  | 'underway'
  | 'completed'
  | 'cancelled'
  | 'refused';

export interface Movement {
  readonly reference: string;
  readonly kind: MovementKind;
  readonly status: MovementStatus;
  /** The ship, by imo number. */
  readonly vessel: string;
  readonly agent: string;
  readonly from: string;
  readonly to: string;
  /** Draught the agent declared, in centimetres. */
  readonly draught: Cm;
  /** When the order was placed. */
  readonly orderedAt: Minute;
  /** The time the agent asked for. */
  readonly requestedFor: Minute;
  /** The time the district offered, once it has offered one. */
  readonly plannedFor: Minute | undefined;
  readonly pilot: string | undefined;
  readonly tugs: number;
  readonly notes: readonly string[];
}

const REFERENCE = /^M-\d{4}-\d{4}$/;
const AGENT = /^[A-Z][A-Z0-9-]{1,11}$/;

/** Build the reference for the nth movement of a year. */
export function makeReference(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw new InputError(`${year} is not a year this system issues references for`);
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new InputError(`${sequence} is outside the sequence a year can hold`);
  }
  return `M-${year}-${String(sequence).padStart(4, '0')}`;
}

export function referenceYear(reference: string): number {
  if (!REFERENCE.test(reference)) {
    throw new InputError(`not a movement reference: ${JSON.stringify(reference)}`);
  }
  return Number(reference.slice(2, 6));
}

export function referenceSequence(reference: string): number {
  if (!REFERENCE.test(reference)) {
    throw new InputError(`not a movement reference: ${JSON.stringify(reference)}`);
  }
  return Number(reference.slice(7));
}

/** The next reference after the ones already issued in a year. */
export function nextReference(year: number, issued: readonly string[]): string {
  const highest = issued
    .filter((reference) => REFERENCE.test(reference) && referenceYear(reference) === year)
    .reduce((worst, reference) => Math.max(worst, referenceSequence(reference)), 0);
  return makeReference(year, highest + 1);
}

export function makeMovement(input: {
  reference: string;
  kind: MovementKind;
  vessel: string;
  agent: string;
  from: string;
  to: string;
  draught: number;
  orderedAt: Minute;
  requestedFor: Minute;
  status?: MovementStatus;
  plannedFor?: Minute;
  pilot?: string;
  tugs?: number;
  notes?: readonly string[];
}): Movement {
  if (!REFERENCE.test(input.reference)) {
    throw new InputError(`not a movement reference: ${JSON.stringify(input.reference)}`);
  }
  if (!AGENT.test(input.agent)) {
    throw new InputError(`agent code must be upper case, got ${JSON.stringify(input.agent)}`);
  }
  const draught = assertCm(input.draught, 'declared draught');
  if (draught <= 0) {
    throw new InputError(`movement ${input.reference} has no declared draught`);
  }
  if (input.from === input.to && input.kind !== 'swing') {
    throw new InputError(`movement ${input.reference} starts and ends in the same place`);
  }
  if (input.requestedFor < input.orderedAt) {
    throw new InputError(`movement ${input.reference} is wanted before it was ordered`);
  }
  const tugs = input.tugs ?? 0;
  if (!Number.isInteger(tugs) || tugs < 0) {
    throw new InputError(`movement ${input.reference} has an impossible number of tugs`);
  }
  return {
    reference: input.reference,
    kind: input.kind,
    status: input.status ?? 'ordered',
    vessel: input.vessel,
    agent: input.agent,
    from: input.from,
    to: input.to,
    draught,
    orderedAt: input.orderedAt,
    requestedFor: input.requestedFor,
    plannedFor: input.plannedFor,
    pilot: input.pilot,
    tugs,
    notes: [...(input.notes ?? [])],
  };
}

/** Hours of notice the agent gave, which the cancellation and rate rules read. */
export function noticeHours(movement: Movement): number {
  return Math.floor((movement.requestedFor - movement.orderedAt) / 60);
}

export function isOpen(movement: Movement): boolean {
  return (
    movement.status !== 'completed' &&
    movement.status !== 'cancelled' &&
    movement.status !== 'refused'
  );
}

export function isInbound(movement: Movement): boolean {
  return movement.kind === 'arrival';
}

export function withNote(movement: Movement, note: string): Movement {
  const trimmed = note.trim();
  if (trimmed === '') {
    throw new InputError('an empty note is not a note');
  }
  return { ...movement, notes: [...movement.notes, trimmed] };
}

export function describeMovement(movement: Movement, offset: number): string {
  const when = movement.plannedFor ?? movement.requestedFor;
  return (
    `${movement.reference} ${movement.kind} ${movement.vessel} ` +
    `${movement.from} to ${movement.to} on ${localDate(when, offset)} (${movement.status})`
  );
}

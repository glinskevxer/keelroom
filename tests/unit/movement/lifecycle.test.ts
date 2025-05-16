import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { TransitionError } from '../../../src/util/errors';
import { makeMovement } from '../../../src/domain/movement/movement';
import type { Movement } from '../../../src/domain/movement/movement';
import {
  apply,
  canMove,
  isTerminal,
  nextStates,
  replan,
  statusRank,
  STATUS_ORDER,
} from '../../../src/domain/movement/lifecycle';

const ORDERED = parseInstant('2025-05-01T09:00Z');
const WANTED = parseInstant('2025-05-03T06:00Z');
const PLANNED = parseInstant('2025-05-03T07:20Z');

function movement(overrides: Partial<Parameters<typeof makeMovement>[0]> = {}): Movement {
  return makeMovement({
    reference: 'M-2025-0004',
    kind: 'arrival',
    vessel: '9074729',
    agent: 'SEAWAY',
    from: 'SEA',
    to: 'GRAIN-3',
    draught: 1150,
    orderedAt: ORDERED,
    requestedFor: WANTED,
    ...overrides,
  });
}

describe('the transitions that exist', () => {
  it('allows the ordinary run through', () => {
    expect(canMove('ordered', 'confirmed')).toBe(true);
    expect(canMove('confirmed', 'assigned')).toBe(true);
    expect(canMove('assigned', 'boarded')).toBe(true);
    expect(canMove('boarded', 'underway')).toBe(true);
    expect(canMove('underway', 'completed')).toBe(true);
  });

  it('refuses to skip a step', () => {
    expect(canMove('ordered', 'boarded')).toBe(false);
    expect(canMove('confirmed', 'underway')).toBe(false);
  });

  it('refuses to move out of a closed movement', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('refused')).toBe(true);
    expect(isTerminal('ordered')).toBe(false);
    expect(nextStates('completed')).toEqual([]);
  });

  it('allows a cancellation up to the moment she is underway', () => {
    expect(canMove('ordered', 'cancelled')).toBe(true);
    expect(canMove('boarded', 'cancelled')).toBe(true);
    expect(canMove('underway', 'cancelled')).toBe(false);
  });

  it('ranks the statuses in board order', () => {
    expect(statusRank('ordered')).toBe(0);
    expect(statusRank('completed')).toBeGreaterThan(statusRank('boarded'));
    expect(STATUS_ORDER).toHaveLength(8);
  });
});

describe('applying a transition', () => {
  it('confirms against a planned time', () => {
    const confirmed = apply(movement(), { to: 'confirmed', plannedFor: PLANNED });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.plannedFor).toBe(PLANNED);
  });

  it('assigns a pilot to a confirmed movement', () => {
    const confirmed = apply(movement(), { to: 'confirmed', plannedFor: PLANNED });
    const assigned = apply(confirmed, { to: 'assigned', pilot: 'P07' });
    expect(assigned.pilot).toBe('P07');
    expect(assigned.status).toBe('assigned');
  });

  it('refuses to assign without a planned time', () => {
    const odd = { ...movement(), status: 'confirmed' as const };
    expect(() => apply(odd, { to: 'assigned', pilot: 'P07' })).toThrow(/no planned time/);
  });

  it('refuses to board without a pilot', () => {
    const odd = { ...movement(), status: 'assigned' as const, plannedFor: PLANNED };
    expect(() => apply(odd, { to: 'boarded', at: PLANNED })).toThrow(/no pilot/);
  });

  it('runs the whole job through', () => {
    let current = movement();
    current = apply(current, { to: 'confirmed', plannedFor: PLANNED });
    current = apply(current, { to: 'assigned', pilot: 'P07' });
    current = apply(current, { to: 'boarded', at: PLANNED });
    current = apply(current, { to: 'underway', at: PLANNED + 20 });
    current = apply(current, { to: 'completed', at: PLANNED + 200 });
    expect(current.status).toBe('completed');
  });

  it('records the reason on a cancellation and a refusal', () => {
    const cancelled = apply(movement(), { to: 'cancelled', reason: 'ship delayed' });
    expect(cancelled.notes).toEqual(['cancelled: ship delayed']);
    const refused = apply(movement(), { to: 'refused', reason: 'no window in the range' });
    expect(refused.notes[0]).toContain('refused:');
  });

  it('refuses a transition the lifecycle does not have', () => {
    expect(() => apply(movement(), { to: 'boarded', at: PLANNED })).toThrow(TransitionError);
    const done = apply(
      apply(
        apply(
          apply(apply(movement(), { to: 'confirmed', plannedFor: PLANNED }), {
            to: 'assigned',
            pilot: 'P07',
          }),
          { to: 'boarded', at: PLANNED },
        ),
        { to: 'underway', at: PLANNED },
      ),
      { to: 'completed', at: PLANNED + 100 },
    );
    expect(() => apply(done, { to: 'cancelled', reason: 'too late' })).toThrow(/closed/);
  });

  it('leaves the movement it was given alone', () => {
    const one = movement();
    apply(one, { to: 'confirmed', plannedFor: PLANNED });
    expect(one.status).toBe('ordered');
  });
});

describe('replanning', () => {
  it('keeps the movement confirmed and takes the pilot off', () => {
    const assigned = apply(apply(movement(), { to: 'confirmed', plannedFor: PLANNED }), {
      to: 'assigned',
      pilot: 'P07',
    });
    const again = replan(assigned, PLANNED + 360);
    expect(again.status).toBe('confirmed');
    expect(again.plannedFor).toBe(PLANNED + 360);
    expect(again.pilot).toBeUndefined();
  });

  it('refuses to replan a movement that has sailed', () => {
    const odd = { ...movement(), status: 'underway' as const };
    expect(() => replan(odd, PLANNED)).toThrow(/cannot be replanned/);
  });
});

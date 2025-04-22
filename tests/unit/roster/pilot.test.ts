import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import {
  bySeniority,
  describePilot,
  GRADE_LIMITS,
  hasEndorsement,
  makePilot,
  promote,
  withEndorsement,
  withoutEndorsement,
} from '../../../src/domain/roster/pilot';
import type { Pilot } from '../../../src/domain/roster/pilot';

function pilot(overrides: Partial<Parameters<typeof makePilot>[0]> = {}): Pilot {
  return makePilot({
    id: 'P07',
    name: 'A Ferrier',
    grade: 'unlimited',
    seniority: 3,
    endorsements: ['NIGHT', 'GRAIN-3'],
    ...overrides,
  });
}

describe('building a pilot', () => {
  it('keeps what it was given and sorts the endorsements', () => {
    const one = pilot();
    expect(one.id).toBe('P07');
    expect(one.endorsements).toEqual(['GRAIN-3', 'NIGHT']);
    expect(one.active).toBe(true);
  });

  it('takes the limits from the grade', () => {
    expect(pilot({ grade: 'limited' }).limits).toEqual(GRADE_LIMITS.limited);
    expect(pilot({ grade: 'apprentice' }).limits.draught).toBe(700);
  });

  it('takes a licence tighter than the grade', () => {
    expect(pilot({ grade: 'unlimited', limits: { draught: 1200 } }).limits.draught).toBe(1200);
  });

  it('refuses a licence wider than the grade', () => {
    expect(() => pilot({ grade: 'limited', limits: { draught: 1500 } })).toThrow(
      /wider than the grade allows/,
    );
    expect(() => pilot({ grade: 'apprentice', limits: { units: 900 } })).toThrow(InputError);
  });

  it('drops a repeated endorsement', () => {
    expect(pilot({ endorsements: ['NIGHT', 'NIGHT'] }).endorsements).toEqual(['NIGHT']);
  });

  it('refuses a pilot who is not one', () => {
    expect(() => pilot({ id: 'seven' })).toThrow(/look like P07/);
    expect(() => pilot({ name: ' ' })).toThrow(/has no name/);
    expect(() => pilot({ seniority: 0 })).toThrow(/no seniority number/);
    expect(() => pilot({ endorsements: ['night'] })).toThrow(/not one/);
    expect(() => pilot({ limits: { draught: 0 } })).toThrow(/limit of nothing/);
  });
});

describe('endorsements', () => {
  it('answers whether one is held', () => {
    expect(hasEndorsement(pilot(), 'NIGHT')).toBe(true);
    expect(hasEndorsement(pilot(), 'GAS')).toBe(false);
  });

  it('adds one and keeps the list sorted', () => {
    expect(withEndorsement(pilot(), 'GAS').endorsements).toEqual(['GAS', 'GRAIN-3', 'NIGHT']);
  });

  it('adding one twice changes nothing', () => {
    const once = withEndorsement(pilot(), 'GAS');
    expect(withEndorsement(once, 'GAS')).toBe(once);
  });

  it('removes one', () => {
    expect(withoutEndorsement(pilot(), 'NIGHT').endorsements).toEqual(['GRAIN-3']);
    expect(withoutEndorsement(pilot(), 'GAS').endorsements).toEqual(['GRAIN-3', 'NIGHT']);
  });

  it('refuses to add something that is not an endorsement', () => {
    expect(() => withEndorsement(pilot(), 'gas')).toThrow(/is not an endorsement/);
  });
});

describe('promotion', () => {
  it('widens the licence to the new grade', () => {
    const promoted = promote(pilot({ grade: 'limited' }), 'unlimited');
    expect(promoted.grade).toBe('unlimited');
    expect(promoted.limits).toEqual(GRADE_LIMITS.unlimited);
  });

  it('refuses to narrow a licence', () => {
    expect(() => promote(pilot({ grade: 'unlimited' }), 'limited')).toThrow(/would narrow/);
  });

  it('leaves the endorsements alone', () => {
    expect(promote(pilot({ grade: 'limited' }), 'unlimited').endorsements).toEqual([
      'GRAIN-3',
      'NIGHT',
    ]);
  });
});

describe('the board order', () => {
  it('puts the most senior first', () => {
    const pilots = [
      pilot({ id: 'P07', seniority: 3 }),
      pilot({ id: 'P02', seniority: 1 }),
      pilot({ id: 'P11', seniority: 2 }),
    ];
    expect(bySeniority(pilots).map((one) => one.id)).toEqual(['P02', 'P11', 'P07']);
  });

  it('breaks a tie on the id so two runs agree', () => {
    const pilots = [pilot({ id: 'P09', seniority: 1 }), pilot({ id: 'P02', seniority: 1 })];
    expect(bySeniority(pilots).map((one) => one.id)).toEqual(['P02', 'P09']);
  });

  it('does not disturb the input', () => {
    const pilots = [pilot({ id: 'P07', seniority: 3 }), pilot({ id: 'P02', seniority: 1 })];
    bySeniority(pilots);
    expect(pilots[0]?.id).toBe('P07');
  });

  it('describes a pilot in one line', () => {
    expect(describePilot(pilot())).toBe('P07 A Ferrier, unlimited, seniority 3');
    expect(describePilot(pilot({ active: false }))).toContain('(inactive)');
  });
});

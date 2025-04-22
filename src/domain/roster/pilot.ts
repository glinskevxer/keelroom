/**
 * A pilot as the roster knows him or her: a licence with limits on it, a set of
 * endorsements, and a seniority number that decides the turn board.
 *
 * The licence limits are the interesting part. A pilot holds a grade, and the
 * grade carries a draught limit and a size limit that the district raises as
 * the pilot gains trips. An endorsement is narrower than a grade: it names a
 * berth, a night qualification, or a class of ship the district will not let
 * anybody take without it.
 */

import { InputError } from '../../util/errors';
import type { Cm } from '../../util/units';
import { assertCm } from '../../util/units';

export type Grade = 'apprentice' | 'limited' | 'unlimited';

export interface LicenceLimits {
  /** Deepest draught the pilot may take, in centimetres. */
  readonly draught: Cm;
  /** Most pilotage units the pilot may take. */
  readonly units: number;
}

export const GRADE_LIMITS: Record<Grade, LicenceLimits> = {
  apprentice: { draught: 700, units: 150 },
  limited: { draught: 1100, units: 500 },
  unlimited: { draught: 9999, units: 99999 },
};

export interface Pilot {
  readonly id: string;
  readonly name: string;
  readonly grade: Grade;
  /** Lower is more senior, and the turn board reads it. */
  readonly seniority: number;
  /** Berths, night work and ship classes the pilot is signed off for. */
  readonly endorsements: readonly string[];
  /** Limits from the licence, which may be tighter than the grade allows. */
  readonly limits: LicenceLimits;
  readonly active: boolean;
}

const PILOT_ID = /^P[0-9]{2,4}$/;
const ENDORSEMENT = /^[A-Z][A-Z0-9-]{1,15}$/;

export function makePilot(input: {
  id: string;
  name: string;
  grade: Grade;
  seniority: number;
  endorsements?: readonly string[];
  limits?: Partial<LicenceLimits>;
  active?: boolean;
}): Pilot {
  if (!PILOT_ID.test(input.id)) {
    throw new InputError(`pilot id must look like P07, got ${JSON.stringify(input.id)}`);
  }
  if (input.name.trim() === '') {
    throw new InputError(`pilot ${input.id} has no name`);
  }
  if (!Number.isInteger(input.seniority) || input.seniority < 1) {
    throw new InputError(`pilot ${input.id} has no seniority number`);
  }
  const endorsements = [...(input.endorsements ?? [])];
  for (const endorsement of endorsements) {
    if (!ENDORSEMENT.test(endorsement)) {
      throw new InputError(`pilot ${input.id} carries an endorsement that is not one`, {
        endorsement,
      });
    }
  }
  const fromGrade = GRADE_LIMITS[input.grade];
  const draught = assertCm(input.limits?.draught ?? fromGrade.draught, 'draught limit');
  const units = input.limits?.units ?? fromGrade.units;
  if (draught <= 0 || units <= 0) {
    throw new InputError(`pilot ${input.id} has a licence limit of nothing`);
  }
  if (draught > fromGrade.draught || units > fromGrade.units) {
    throw new InputError(`pilot ${input.id} has a licence wider than the grade allows`, {
      grade: input.grade,
    });
  }
  return {
    id: input.id,
    name: input.name.trim(),
    grade: input.grade,
    seniority: input.seniority,
    endorsements: [...new Set(endorsements)].sort(),
    limits: { draught, units },
    active: input.active ?? true,
  };
}

export function hasEndorsement(pilot: Pilot, endorsement: string): boolean {
  return pilot.endorsements.includes(endorsement);
}

export function withEndorsement(pilot: Pilot, endorsement: string): Pilot {
  if (!ENDORSEMENT.test(endorsement)) {
    throw new InputError(`${endorsement} is not an endorsement`);
  }
  if (hasEndorsement(pilot, endorsement)) {
    return pilot;
  }
  return { ...pilot, endorsements: [...pilot.endorsements, endorsement].sort() };
}

export function withoutEndorsement(pilot: Pilot, endorsement: string): Pilot {
  return {
    ...pilot,
    endorsements: pilot.endorsements.filter((held) => held !== endorsement),
  };
}

/** Promotion widens the licence to the new grade's limits, never narrower. */
export function promote(pilot: Pilot, grade: Grade): Pilot {
  const current = GRADE_LIMITS[pilot.grade];
  const next = GRADE_LIMITS[grade];
  if (next.draught < current.draught || next.units < current.units) {
    throw new InputError(`promoting ${pilot.id} to ${grade} would narrow the licence`);
  }
  return { ...pilot, grade, limits: { draught: next.draught, units: next.units } };
}

export function describePilot(pilot: Pilot): string {
  const state = pilot.active ? '' : ' (inactive)';
  return `${pilot.id} ${pilot.name}, ${pilot.grade}, seniority ${pilot.seniority}${state}`;
}

/** Most senior first, which is the order the board is drawn up in. */
export function bySeniority(pilots: readonly Pilot[]): Pilot[] {
  return [...pilots].sort((a, b) => a.seniority - b.seniority || a.id.localeCompare(b.id));
}

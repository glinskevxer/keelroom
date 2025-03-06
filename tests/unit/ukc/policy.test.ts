import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import type { Vessel } from '../../../src/domain/vessel/vessel';
import {
  densityAllowance,
  describePolicy,
  heelAllowance,
  makePolicy,
  requiredNetClearance,
  STANDARD_POLICY,
  waveAllowance,
} from '../../../src/domain/ukc/policy';

function vessel(overrides: Partial<Parameters<typeof makeVessel>[0]> = {}): Vessel {
  return makeVessel({
    imo: '9074729',
    name: 'atlantic crown',
    type: 'bulk',
    length: 22500,
    beam: 3220,
    summerDraught: 1180,
    airDraught: 4200,
    grossTonnage: 43000,
    ...overrides,
  });
}

describe('building a policy', () => {
  it('starts from the standard one', () => {
    const policy = makePolicy({ id: 'BAR' });
    expect(policy.minimumNet).toBe(STANDARD_POLICY.minimumNet);
    expect(policy.percentOfDraught).toBe(100);
  });

  it('takes an override', () => {
    expect(makePolicy({ id: 'BAR', minimumNet: 90 }).minimumNet).toBe(90);
  });

  it('refuses a policy that is not one', () => {
    expect(() => makePolicy({ id: 'bar' })).toThrow(/upper case/);
    expect(() => makePolicy({ id: 'BAR', percentOfDraught: 900 })).toThrow(/impossible percentage/);
    expect(() => makePolicy({ id: 'BAR', minimumNet: -1 })).toThrow(/negative clearance/);
    expect(() => makePolicy({ id: 'BAR', waveResponse: 1200 })).toThrow(/wave response/);
    expect(() => makePolicy({ id: 'BAR', plannedHeel: 200 })).toThrow(/no ship would survive/);
    expect(() => makePolicy({ id: 'BAR', reportingStep: 0 })).toThrow(/no reporting step/);
    expect(() => makePolicy({ id: 'BAR', minimumNet: 1.5 })).toThrow(/whole centimetres/);
  });
});

describe('the clearance the district requires', () => {
  const policy = STANDARD_POLICY;

  it('takes the percentage when it is the greater', () => {
    const demand = requiredNetClearance(policy, vessel(), 1180);
    expect(demand.required).toBe(118);
    expect(demand.reasons).toContain('UKC-PCT-01');
  });

  it('takes the floor when the percentage falls under it', () => {
    const demand = requiredNetClearance(policy, vessel(), 500);
    expect(demand.required).toBe(60);
    expect(demand.reasons).toContain('UKC-MIN-02');
    expect(demand.reasons).not.toContain('UKC-PCT-01');
  });

  it('adds the bar extra on a hard bottom', () => {
    const demand = requiredNetClearance(policy, vessel(), 1180, { hardBottom: true });
    expect(demand.required).toBe(148);
    expect(demand.reasons).toContain('UKC-BAR-03');
  });

  it('adds the cargo extra for a tanker and stacks it with the bar', () => {
    const tanker = vessel({ type: 'tanker' });
    expect(requiredNetClearance(policy, tanker, 1180).required).toBe(138);
    expect(requiredNetClearance(policy, tanker, 1180, { hardBottom: true }).required).toBe(168);
    expect(requiredNetClearance(policy, tanker, 1180).reasons).toContain('UKC-CARGO-04');
  });

  it('rounds up to the reporting step', () => {
    const stepped = makePolicy({ id: 'STEP', reportingStep: 5 });
    expect(requiredNetClearance(stepped, vessel(), 1180).required).toBe(120);
  });

  it('refuses a draught that is not one', () => {
    expect(() => requiredNetClearance(policy, vessel(), 0)).toThrow(/not a draught/);
  });

  it('describes itself in one line', () => {
    expect(describePolicy(STANDARD_POLICY)).toBe(
      'STANDARD: 10.0% of draught or 60 cm, whichever is greater',
    );
  });
});

describe('the allowances', () => {
  it('takes half the beam through the planned heel', () => {
    expect(heelAllowance(STANDARD_POLICY, vessel())).toBe(28);
    expect(heelAllowance(STANDARD_POLICY, vessel({ beam: 1600 }))).toBe(14);
    expect(heelAllowance(makePolicy({ id: 'FLAT', plannedHeel: 0 }), vessel())).toBe(0);
  });

  it('counts half a swell in the open and less in a cut', () => {
    expect(waveAllowance(STANDARD_POLICY, 200, 'open')).toBe(100);
    expect(waveAllowance(STANDARD_POLICY, 200, 'restricted')).toBe(50);
    expect(waveAllowance(STANDARD_POLICY, 200, 'canal')).toBe(0);
    expect(waveAllowance(STANDARD_POLICY, 0, 'open')).toBe(0);
  });

  it('refuses a negative sea', () => {
    expect(() => waveAllowance(STANDARD_POLICY, -10, 'open')).toThrow(/not a sea state/);
  });

  it('sinks a ship in fresh water and not in salt', () => {
    expect(densityAllowance(1180, 1025)).toBe(0);
    expect(densityAllowance(1180, 1000)).toBe(29);
    expect(densityAllowance(1180, 1005)).toBe(23);
  });

  it('never credits a ship for floating in something heavier', () => {
    expect(densityAllowance(1180, 1030)).toBe(0);
  });

  it('refuses water that is not water', () => {
    expect(() => densityAllowance(1180, 800)).toThrow(/outside anything measurable/);
    expect(() => densityAllowance(1180, 1500)).toThrow(InputError);
  });
});

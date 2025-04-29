import { describe, expect, it } from 'vitest';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import type { Vessel } from '../../../src/domain/vessel/vessel';
import { makePilot } from '../../../src/domain/roster/pilot';
import type { Pilot } from '../../../src/domain/roster/pilot';
import {
  endorsementsWanted,
  qualifiedPilots,
  qualifies,
  tightestQualified,
} from '../../../src/domain/roster/qualification';
import type { JobDemand } from '../../../src/domain/roster/qualification';

function vessel(overrides: Partial<Parameters<typeof makeVessel>[0]> = {}): Vessel {
  return makeVessel({
    imo: '9074729',
    name: 'atlantic crown',
    type: 'bulk',
    length: 12000,
    beam: 1800,
    summerDraught: 800,
    airDraught: 3600,
    grossTonnage: 12000,
    ...overrides,
  });
}

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

function demand(overrides: Partial<JobDemand> = {}): JobDemand {
  return { vessel: vessel(), draught: 800, night: false, ...overrides };
}

describe('the licence limits', () => {
  it('qualifies a pilot inside them', () => {
    const result = qualifies(pilot(), demand());
    expect(result.qualified).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('refuses a ship deeper than the licence', () => {
    const result = qualifies(pilot({ grade: 'limited' }), demand({ draught: 1200 }));
    expect(result.qualified).toBe(false);
    expect(result.findings.map((finding) => finding.rule)).toContain('PIL-DEEP-01');
  });

  it('refuses a ship bigger than the licence', () => {
    const big = vessel({ length: 22500, beam: 3220, summerDraught: 1180 });
    const result = qualifies(pilot({ grade: 'limited' }), demand({ vessel: big, draught: 1000 }));
    expect(result.findings.map((finding) => finding.rule)).toContain('PIL-UNITS-02');
  });

  it('reports the headroom either way', () => {
    const result = qualifies(pilot({ grade: 'limited' }), demand({ draught: 900 }));
    expect(result.draughtHeadroom).toBe(200);
    expect(result.unitHeadroom).toBeGreaterThan(0);
  });

  it('warns when the job is close to the limit', () => {
    const result = qualifies(pilot({ grade: 'limited' }), demand({ draught: 1090 }));
    expect(result.qualified).toBe(true);
    expect(result.findings.map((finding) => finding.rule)).toContain('PIL-TIGHT-08');
  });

  it('refuses a pilot off the active list', () => {
    const result = qualifies(pilot({ active: false }), demand());
    expect(result.findings.map((finding) => finding.rule)).toContain('PIL-OFF-06');
  });
});

describe('endorsements', () => {
  it('refuses a night job to a pilot without the sign off', () => {
    const result = qualifies(pilot({ endorsements: [] }), demand({ night: true }));
    expect(result.findings.map((finding) => finding.rule)).toContain('PIL-NIGHT-03');
    expect(qualifies(pilot(), demand({ night: true })).qualified).toBe(true);
  });

  it('refuses a berth the pilot is not signed off for', () => {
    expect(
      qualifies(pilot(), demand({ berth: 'OIL-1' })).findings.map((finding) => finding.rule),
    ).toContain('PIL-BERTH-04');
    expect(qualifies(pilot(), demand({ berth: 'GRAIN-3' })).qualified).toBe(true);
  });

  it('refuses a gas carrier to a pilot without the class', () => {
    const gas = vessel({ type: 'gas' });
    expect(
      qualifies(pilot(), demand({ vessel: gas })).findings.map((finding) => finding.rule),
    ).toContain('PIL-CLASS-05');
    expect(qualifies(pilot({ endorsements: ['GAS'] }), demand({ vessel: gas })).qualified).toBe(
      true,
    );
  });

  it('refuses an extra endorsement the job asked for', () => {
    const result = qualifies(pilot(), demand({ extraEndorsements: ['ICE'] }));
    expect(result.findings.map((finding) => finding.rule)).toContain('PIL-EXTRA-07');
  });

  it('lists everything a job wants', () => {
    expect(
      endorsementsWanted(
        demand({
          night: true,
          berth: 'OIL-1',
          vessel: vessel({ type: 'tanker' }),
          extraEndorsements: ['ICE'],
        }),
      ),
    ).toEqual(['GAS', 'ICE', 'NIGHT', 'OIL-1']);
    expect(endorsementsWanted(demand())).toEqual([]);
  });
});

describe('choosing among pilots', () => {
  const pilots = [
    pilot({ id: 'P02', grade: 'unlimited', seniority: 1 }),
    pilot({ id: 'P07', grade: 'limited', seniority: 2 }),
    pilot({ id: 'P11', grade: 'apprentice', seniority: 3 }),
  ];

  it('filters to those who qualify', () => {
    const able = qualifiedPilots(pilots, demand({ draught: 900 }));
    expect(able.map((one) => one.id)).toEqual(['P02', 'P07']);
  });

  it('picks the tightest licence that still qualifies', () => {
    const launch = vessel({ length: 8000, beam: 1300, summerDraught: 600 });
    expect(tightestQualified(pilots, demand({ vessel: launch, draught: 600 }))?.id).toBe('P11');
    expect(tightestQualified(pilots, demand({ draught: 900 }))?.id).toBe('P07');
  });

  it('gives nothing when nobody qualifies', () => {
    const gas = vessel({ type: 'gas' });
    expect(qualifiedPilots(pilots, demand({ vessel: gas }))).toEqual([]);
    expect(tightestQualified(pilots, demand({ vessel: gas }))).toBeUndefined();
  });
});

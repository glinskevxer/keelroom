import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import { makeReach } from '../../../src/domain/chart/reach';
import type { Reach } from '../../../src/domain/chart/reach';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import type { Vessel } from '../../../src/domain/vessel/vessel';
import { makePolicy, STANDARD_POLICY } from '../../../src/domain/ukc/policy';
import {
  assessReach,
  describeAssessment,
  largestAllowance,
  totalAllowances,
} from '../../../src/domain/ukc/assessment';
import type { ReachAssessment, TransitConditions } from '../../../src/domain/ukc/assessment';

const SURVEYED = parseInstant('2025-01-15T00:00Z');
const AT = parseInstant('2025-04-01T06:00Z');

const BAR: Reach = makeReach({
  id: 'LOWER-BAR',
  name: 'Lower Bar',
  chartedDepth: 1310,
  length: 5600,
  width: 180,
  channel: 'restricted',
  station: 'NARROWS',
  surveyed: SURVEYED,
  shoalingRate: 24,
  speedLimit: 100,
});

const SHIP: Vessel = makeVessel({
  imo: '9074729',
  name: 'atlantic crown',
  type: 'bulk',
  length: 22500,
  beam: 3220,
  summerDraught: 1180,
  airDraught: 4200,
  grossTonnage: 43000,
});

const CONDITIONS: TransitConditions = {
  density: 1020,
  waveHeight: 80,
  speed: 80,
};

function assess(overrides: {
  draught?: number;
  tideHeight?: number;
  conditions?: Partial<TransitConditions>;
  vessel?: Vessel;
  reach?: Reach;
}): ReachAssessment {
  return assessReach({
    reach: overrides.reach ?? BAR,
    vessel: overrides.vessel ?? SHIP,
    draught: overrides.draught ?? 1180,
    policy: STANDARD_POLICY,
    at: AT,
    tideHeight: overrides.tideHeight ?? 200,
    conditions: { ...CONDITIONS, ...overrides.conditions },
  });
}

describe('the two sides of the sum', () => {
  it('adds the tide to the planned depth', () => {
    const assessment = assess({ tideHeight: 200 });
    expect(assessment.plannedDepth).toBe(1295);
    expect(assessment.available).toBe(1495);
  });

  it('adds every allowance and the requirement to the draught', () => {
    const assessment = assess({});
    const allowances = totalAllowances(assessment.allowances);
    expect(assessment.needed).toBe(1180 + allowances + assessment.requiredClearance);
    expect(assessment.margin).toBe(assessment.available - assessment.needed);
  });

  it('counts every allowance separately', () => {
    const assessment = assess({});
    expect(assessment.allowances.squat).toBeGreaterThan(0);
    expect(assessment.allowances.heel).toBe(28);
    expect(assessment.allowances.wave).toBe(20);
    expect(assessment.allowances.density).toBe(6);
  });

  it('reports the net clearance before the requirement is applied', () => {
    const assessment = assess({});
    expect(assessment.netClearance).toBe(
      assessment.available - 1180 - totalAllowances(assessment.allowances),
    );
    expect(assessment.netClearance).toBeGreaterThan(assessment.margin);
  });
});

describe('the tide changes the squat, not only the water', () => {
  it('reads less squat on more tide', () => {
    const low = assess({ tideHeight: 60 });
    const high = assess({ tideHeight: 400 });
    expect(high.allowances.squat).toBeLessThan(low.allowances.squat);
  });

  it('gains more margin than it gains tide', () => {
    const low = assess({ tideHeight: 60 });
    const high = assess({ tideHeight: 400 });
    expect(high.margin - low.margin).toBeGreaterThan(340);
  });

  it('reads more squat at a higher speed', () => {
    const slow = assess({ conditions: { speed: 50 } });
    const fast = assess({ conditions: { speed: 100 } });
    expect(fast.allowances.squat).toBeGreaterThan(slow.allowances.squat);
    expect(fast.margin).toBeLessThan(slow.margin);
  });
});

describe('findings', () => {
  it('passes a ship with water to spare and says nothing', () => {
    const assessment = assess({ tideHeight: 400 });
    expect(assessment.passable).toBe(true);
    expect(assessment.findings.filter((finding) => finding.severity === 'block')).toHaveLength(0);
  });

  it('blocks a ship with no water and says how short she is', () => {
    const assessment = assess({ tideHeight: 0, draught: 1250 });
    expect(assessment.passable).toBe(false);
    const blocked = assessment.findings.find((finding) => finding.rule === 'UKC-NET-01');
    expect(blocked?.detail?.shortBy).toBe(-assessment.margin);
  });

  it('warns when the margin is thin rather than absent', () => {
    let tide = 0;
    while (tide < 600) {
      const assessment = assess({ tideHeight: tide });
      if (assessment.margin >= 0 && assessment.margin < 20) {
        expect(assessment.findings.some((finding) => finding.rule === 'UKC-THIN-05')).toBe(true);
        return;
      }
      tide += 1;
    }
    throw new Error('no thin margin was found to test');
  });

  it('blocks a ship that touches before any clearance is counted', () => {
    const assessment = assess({ tideHeight: -200, draught: 1400 });
    expect(assessment.findings.some((finding) => finding.rule === 'UKC-GROUND-06')).toBe(true);
  });

  it('notes when squat alone beats the requirement', () => {
    const assessment = assess({ conditions: { speed: 100 }, draught: 700 });
    expect(assessment.findings.some((finding) => finding.rule === 'UKC-SQUAT-07')).toBe(true);
  });

  it('carries the reason the requirement came out as it did', () => {
    const assessment = assess({});
    expect(assessment.findings.some((finding) => finding.rule === 'UKC-PCT-01')).toBe(true);
  });

  it('adds the cargo extra for a tanker', () => {
    const tanker = assess({
      vessel: makeVessel({
        imo: '9074729',
        name: 'gulf runner',
        type: 'tanker',
        length: 22500,
        beam: 3220,
        summerDraught: 1180,
        airDraught: 4200,
        grossTonnage: 43000,
      }),
    });
    expect(tanker.requiredClearance).toBe(assess({}).requiredClearance + 20);
  });
});

describe('reading an assessment', () => {
  it('names the allowance that took the most water', () => {
    expect(largestAllowance(assess({}).allowances)).toBe('squat');
    const calm = assess({ conditions: { speed: 10, waveHeight: 400, density: 1025 } });
    expect(largestAllowance(calm.allowances)).toBe('wave');
  });

  it('describes itself in one line', () => {
    const assessment = assess({ tideHeight: 400 });
    expect(describeAssessment(assessment)).toContain('LOWER-BAR passable');
    expect(describeAssessment(assess({ tideHeight: 0, draught: 1300 }))).toContain('blocked');
  });

  it('honours a policy with a bigger floor', () => {
    const strict = makePolicy({ id: 'STRICT', minimumNet: 200, percentOfDraught: 200 });
    const assessment = assessReach({
      reach: BAR,
      vessel: SHIP,
      draught: 1180,
      policy: strict,
      at: AT,
      tideHeight: 200,
      conditions: CONDITIONS,
    });
    expect(assessment.requiredClearance).toBe(236);
    expect(assessment.margin).toBeLessThan(assess({}).margin);
  });
});

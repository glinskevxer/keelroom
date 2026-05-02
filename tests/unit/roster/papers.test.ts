import { afterEach, describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, parseInstant } from '../../../src/util/clock';
import { expiringPapers, makePilot, papersInDate } from '../../../src/domain/roster/pilot';
import type { Pilot } from '../../../src/domain/roster/pilot';
import { qualifies } from '../../../src/domain/roster/qualification';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import { migrate } from '../../../src/storage/migrate';
import { findPilot, savePilot } from '../../../src/storage/roster-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

const T = parseInstant('2025-05-01T00:00Z');

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

function pilot(overrides: Partial<Parameters<typeof makePilot>[0]> = {}): Pilot {
  return makePilot({
    id: 'P07',
    name: 'A Ferrier',
    grade: 'unlimited',
    seniority: 3,
    endorsements: ['NIGHT'],
    licenceExpires: T + 90 * MINUTES_PER_DAY,
    medicalExpires: T + 30 * MINUTES_PER_DAY,
    ...overrides,
  });
}

const SHIP = makeVessel({
  imo: '9074729',
  name: 'atlantic crown',
  type: 'bulk',
  length: 12000,
  beam: 1800,
  summerDraught: 800,
  airDraught: 3600,
  grossTonnage: 12000,
});

describe('the papers', () => {
  it('are in date until they are not', () => {
    expect(papersInDate(pilot(), T)).toBe(true);
    expect(papersInDate(pilot(), T + 40 * MINUTES_PER_DAY)).toBe(false);
    expect(papersInDate(pilot(), T + 100 * MINUTES_PER_DAY)).toBe(false);
  });

  it('are in date for ever when the district does not record them', () => {
    const undated = pilot({ licenceExpires: undefined, medicalExpires: undefined });
    expect(papersInDate(undated, T + 10000 * MINUTES_PER_DAY)).toBe(true);
  });

  it('list what is running out, soonest first', () => {
    const found = expiringPapers([pilot()], T, 100);
    expect(found.map((each) => each.paper)).toEqual(['medical', 'licence']);
    expect(expiringPapers([pilot()], T, 10)).toEqual([]);
  });
});

describe('a job against the papers', () => {
  const demand = { vessel: SHIP, draught: 800, night: false };

  it('is refused when the medical has run out', () => {
    const result = qualifies(pilot(), { ...demand, at: T + 40 * MINUTES_PER_DAY });
    expect(result.qualified).toBe(false);
    expect(result.findings.map((finding) => finding.rule)).toContain('PIL-PAPER-09');
  });

  it('is allowed while they are in date', () => {
    expect(qualifies(pilot(), { ...demand, at: T }).qualified).toBe(true);
  });

  it('is not checked when the job carries no time', () => {
    expect(qualifies(pilot(), demand).qualified).toBe(true);
  });
});

describe('the dates through the store', () => {
  it('come back as they went in', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    savePilot(temp.db, pilot());
    const loaded = findPilot(temp.db, 'P07')!;
    expect(loaded.licenceExpires).toBe(T + 90 * MINUTES_PER_DAY);
    expect(loaded.medicalExpires).toBe(T + 30 * MINUTES_PER_DAY);
  });

  it('stay absent for a pilot with no dates recorded', () => {
    temp = temporaryDatabase();
    migrate(temp.db);
    savePilot(temp.db, pilot({ licenceExpires: undefined, medicalExpires: undefined }));
    const loaded = findPilot(temp.db, 'P07')!;
    expect(loaded.licenceExpires).toBeUndefined();
    expect(loaded.medicalExpires).toBeUndefined();
  });
});

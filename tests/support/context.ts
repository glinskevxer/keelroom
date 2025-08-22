import { parseInstant } from '../../src/util/clock';
import { makeVessel } from '../../src/domain/vessel/vessel';
import type { Vessel } from '../../src/domain/vessel/vessel';
import { makeAccount } from '../../src/domain/billing/account';
import { migrate } from '../../src/storage/migrate';
import { saveDistrict } from '../../src/storage/district-store';
import { saveAccount, saveVessel } from '../../src/storage/fleet-store';
import { savePilot, saveBoard } from '../../src/storage/roster-store';
import { makePilot } from '../../src/domain/roster/pilot';
import type { Pilot } from '../../src/domain/roster/pilot';
import { makeBoard } from '../../src/domain/roster/board';
import { defaultConfig } from '../../src/service/config';
import type { DistrictConfig } from '../../src/service/config';
import { contextFrom } from '../../src/service/context';
import type { Context } from '../../src/service/context';
import { temporaryDatabase } from './database';
import type { TempDatabase } from './database';
import { POSITION, testDistrict } from './district';

export const NOW = parseInstant('2025-04-01T08:00Z');

export const CROWN: Vessel = makeVessel({
  imo: '9074729',
  name: 'atlantic crown',
  type: 'bulk',
  length: 22500,
  beam: 3220,
  summerDraught: 1250,
  airDraught: 4200,
  grossTonnage: 43000,
  deadweight: 76000,
});

export const LAUNCH: Vessel = makeVessel({
  imo: '9074705',
  name: 'bay trader',
  type: 'general',
  length: 9000,
  beam: 1400,
  summerDraught: 600,
  airDraught: 2600,
  grossTonnage: 4200,
});

export const PILOTS: Pilot[] = [
  makePilot({
    id: 'P02',
    name: 'A Ferrier',
    grade: 'unlimited',
    seniority: 1,
    endorsements: ['NIGHT', 'GRAIN-3', 'ANCH-A', 'GAS'],
  }),
  makePilot({
    id: 'P07',
    name: 'B Mate',
    grade: 'unlimited',
    seniority: 2,
    endorsements: ['NIGHT', 'GRAIN-3', 'ANCH-A'],
  }),
  makePilot({
    id: 'P11',
    name: 'C Cadet',
    grade: 'limited',
    seniority: 3,
    endorsements: ['GRAIN-3'],
  }),
];

export interface TestContext {
  readonly context: Context;
  readonly temp: TempDatabase;
  close(): void;
}

export function testContext(overrides: Partial<DistrictConfig> = {}): TestContext {
  const temp = temporaryDatabase();
  migrate(temp.db);
  saveDistrict(temp.db, { district: testDistrict(), position: POSITION });
  saveVessel(temp.db, CROWN);
  saveVessel(temp.db, LAUNCH);
  saveAccount(
    temp.db,
    makeAccount({ agent: 'SEAWAY', name: 'Seaway Agencies', creditLimit: 5000000 }),
  );
  saveAccount(temp.db, makeAccount({ agent: 'NORTH', name: 'Northern Agents' }));
  for (const pilot of PILOTS) {
    savePilot(temp.db, pilot);
  }
  saveBoard(temp.db, makeBoard(PILOTS));
  const config = { ...defaultConfig('KLR'), ...overrides };
  const context = contextFrom(temp.db, config, { now: () => NOW });
  return {
    context,
    temp,
    close(): void {
      temp.close();
    },
  };
}

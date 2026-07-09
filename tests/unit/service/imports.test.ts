import { afterEach, describe, expect, it } from 'vitest';
import { allVessels, findVessel, findAccount } from '../../../src/storage/fleet-store';
import { loadDistrict } from '../../../src/storage/district-store';
import { findMovement } from '../../../src/storage/movement-store';
import { parseInstant } from '../../../src/util/clock';
import { confirmMovement } from '../../../src/service/planning';
import {
  importAccounts,
  importEtas,
  importOrders,
  readEtas,
  readOrders,
  importHarmonics,
  importSurveys,
  importVessels,
  readHarmonics,
  readSurveys,
  readVessels,
} from '../../../src/service/imports';
import { testContext } from '../../support/context';
import type { TestContext } from '../../support/context';

let harness: TestContext | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

const VESSELS = `imo,name,type,length_cm,beam_cm,summer_draught_cm,air_draught_cm,gross_tonnage,deadweight,bow_thruster
9319466,ore monarch,bulk,30000,5000,1750,5000,180000,320000,no
9074717,coastal star,container,17000,2700,1050,3800,22000,28000,yes
`;

describe('ships', () => {
  it('read every row', () => {
    const ships = readVessels(VESSELS);
    expect(ships).toHaveLength(2);
    expect(ships[0]?.name).toBe('ORE MONARCH');
    expect(ships[1]?.bowThruster).toBe(true);
  });

  it('take the block coefficient from the type when the file has none', () => {
    expect(readVessels(VESSELS)[0]?.blockCoefficient).toBe(830);
  });

  it('write them all', () => {
    harness = testContext();
    const summary = importVessels(harness.temp.db, VESSELS);
    expect(summary.written).toBe(2);
    expect(findVessel(harness.temp.db, '9074717')?.name).toBe('COASTAL STAR');
  });

  it('update a ship already on the books', () => {
    harness = testContext();
    const before = allVessels(harness.temp.db).length;
    importVessels(
      harness.temp.db,
      `imo,name,type,length_cm,beam_cm,summer_draught_cm,air_draught_cm,gross_tonnage
9074729,atlantic crown,bulk,22500,3220,1300,4200,43000
`,
    );
    expect(allVessels(harness.temp.db)).toHaveLength(before);
    expect(findVessel(harness.temp.db, '9074729')?.summerDraught).toBe(1300);
  });

  it('refuse the whole file for one bad row', () => {
    harness = testContext();
    const bad = `${VESSELS}9999999,broken,bulk,1,1,1,1,1,1,no\n`;
    expect(() => importVessels(harness!.temp.db, bad)).toThrow(/check digit/);
    expect(findVessel(harness.temp.db, '9074717')).toBeUndefined();
  });

  it('refuse a type nobody carries', () => {
    expect(() =>
      readVessels(
        `imo,name,type,length_cm,beam_cm,summer_draught_cm,air_draught_cm,gross_tonnage
9319466,x,submarine,1,1,1,1,1
`,
      ),
    ).toThrow(/expected one of/);
  });
});

describe('accounts', () => {
  const ACCOUNTS = `agent,name,terms_days,discount_bps,credit_limit,stopped
COASTLINE,Coastline Marine,45,500,2000000,no
HARBOURCO,Harbour Company,,,,yes
`;

  it('read and write with their defaults', () => {
    harness = testContext();
    importAccounts(harness.temp.db, ACCOUNTS);
    expect(findAccount(harness.temp.db, 'COASTLINE')?.discount).toBe(500);
    const second = findAccount(harness.temp.db, 'HARBOURCO')!;
    expect(second.termsDays).toBe(30);
    expect(second.stopped).toBe(true);
  });

  it('refuse an agent code that is not one', () => {
    harness = testContext();
    expect(() =>
      importAccounts(harness!.temp.db, 'agent,name\ncoastline,Coastline Marine\n'),
    ).toThrow(/upper case/);
  });
});

describe('harmonic constants', () => {
  const HARMONICS = `station,constituent,amplitude_cm,phase_degrees
NARROWS,M2,171,232.1
NARROWS,S2,29,259.5
`;

  it('replace the terms of the station they name', () => {
    harness = testContext();
    const summary = importHarmonics(harness.temp.db, HARMONICS);
    expect(summary.written).toBe(2);
    const station = loadDistrict(harness.temp.db, 'KLR').district.stations[0]!;
    expect(station.terms).toHaveLength(2);
    expect(station.terms.find((term) => term.name === 'M2')?.amplitude).toBe(171);
  });

  it('refuse a constituent nobody carries', () => {
    expect(() =>
      readHarmonics('station,constituent,amplitude_cm,phase_degrees\nNARROWS,ZZ9,10,0\n'),
    ).toThrow(/not a constituent/);
  });

  it('refuse a phase outside a turn or a negative amplitude', () => {
    expect(() =>
      readHarmonics('station,constituent,amplitude_cm,phase_degrees\nNARROWS,M2,10,400\n'),
    ).toThrow(/single turn/);
    expect(() =>
      readHarmonics('station,constituent,amplitude_cm,phase_degrees\nNARROWS,M2,-1,10\n'),
    ).toThrow(/negative amplitude/);
  });

  it('refuse a station the district does not have', () => {
    harness = testContext();
    expect(() =>
      importHarmonics(
        harness!.temp.db,
        'station,constituent,amplitude_cm,phase_degrees\nNOWHERE,M2,100,0\n',
      ),
    ).toThrow(/no tide station NOWHERE/);
  });
});

describe('surveys', () => {
  const SURVEYS = `reach,charted_depth_cm,surveyed_at,tolerance_cm
LOWER-BAR,1265,2025-03-20T00:00Z,15
`;

  it('change the charted depth and the survey date', () => {
    harness = testContext();
    const summary = importSurveys(harness.temp.db, SURVEYS);
    expect(summary.written).toBe(1);
    const reach = loadDistrict(harness.temp.db, 'KLR').district.reaches.find(
      (each) => each.id === 'LOWER-BAR',
    )!;
    expect(reach.chartedDepth).toBe(1265);
    expect(reach.surveyTolerance).toBe(15);
  });

  it('refuse a reach the district does not have', () => {
    harness = testContext();
    expect(() =>
      importSurveys(
        harness!.temp.db,
        'reach,charted_depth_cm,surveyed_at\nNOWHERE,1200,2025-03-20T00:00Z\n',
      ),
    ).toThrow(/no reach NOWHERE/);
  });

  it('refuse a depth of nothing', () => {
    expect(() =>
      readSurveys('reach,charted_depth_cm,surveyed_at\nLOWER-BAR,0,2025-03-20T00:00Z\n'),
    ).toThrow(/closed reach/);
  });

  it('refuse a date that is not one', () => {
    expect(() =>
      readSurveys('reach,charted_depth_cm,surveyed_at\nLOWER-BAR,1200,last tuesday\n'),
    ).toThrow(/not an iso timestamp/);
  });

  it('leave the depth alone when one row of the file is bad', () => {
    harness = testContext();
    const bad = `${SURVEYS}NOWHERE,1200,2025-03-20T00:00Z,10\n`;
    expect(() => importSurveys(harness!.temp.db, bad)).toThrow(/no reach NOWHERE/);
    const reach = loadDistrict(harness.temp.db, 'KLR').district.reaches.find(
      (each) => each.id === 'LOWER-BAR',
    )!;
    expect(reach.chartedDepth).toBe(1290);
  });
});

describe('orders', () => {
  const ORDERS = `imo,agent,kind,from,to,draught_cm,requested_for,note
9074729,SEAWAY,arrival,SEA,GRAIN-3,1100,2025-04-03T06:00Z,grain for the mill
9074705,SEAWAY,arrival,SEA,GRAIN-3,600,2025-04-05T06:00Z,
`;

  it('read every row', () => {
    const rows = readOrders(ORDERS);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.kind).toBe('arrival');
    expect(rows[0]?.note).toBe('grain for the mill');
    expect(rows[1]?.note).toBeUndefined();
  });

  it('take a week of calls and give back the references', () => {
    harness = testContext();
    const summary = importOrders(harness.context, ORDERS);
    expect(summary.written).toBe(2);
    expect(summary.references[0]).toBe('M-2025-0001');
    expect(findMovement(harness.temp.db, 'M-2025-0002')?.vessel).toBe('9074705');
  });

  it('refuse the whole file when one order is refused', () => {
    harness = testContext();
    const bad = `${ORDERS}9074729,SEAWAY,arrival,SEA,NOWHERE,1100,2025-04-07T06:00Z,\n`;
    expect(() => importOrders(harness!.context, bad)).toThrow(/no such berth/);
    expect(findMovement(harness.temp.db, 'M-2025-0001')).toBeUndefined();
  });

  it('refuse a kind nobody orders', () => {
    expect(() =>
      readOrders(
        'imo,agent,kind,from,to,draught_cm,requested_for\n9074729,SEAWAY,towage,SEA,GRAIN-3,1100,2025-04-03T06:00Z\n',
      ),
    ).toThrow(/expected one of/);
  });
});

describe('revised times', () => {
  const ORDERS = `imo,agent,kind,from,to,draught_cm,requested_for
9074729,SEAWAY,arrival,SEA,GRAIN-3,1100,2025-04-03T06:00Z
9074705,SEAWAY,arrival,SEA,GRAIN-3,600,2025-04-05T06:00Z
`;

  it('read every row', () => {
    const rows = readEtas(
      'reference,requested_for,draught_cm\nM-2025-0001,2025-04-04T06:00Z,1050\n',
    );
    expect(rows[0]?.reference).toBe('M-2025-0001');
    expect(rows[0]?.draught).toBe(1050);
  });

  it('amend the movements they name', () => {
    harness = testContext();
    importOrders(harness.context, ORDERS);
    const summary = importEtas(
      harness.context,
      'reference,requested_for\nM-2025-0001,2025-04-04T09:00Z\n',
    );
    expect(summary.written).toBe(1);
    expect(findMovement(harness.temp.db, 'M-2025-0001')?.requestedFor).toBe(
      parseInstant('2025-04-04T09:00Z'),
    );
  });

  it('drop the planned time so she comes back onto the list', () => {
    harness = testContext();
    importOrders(harness.context, ORDERS);
    confirmMovement(harness.context, { reference: 'M-2025-0001' });
    importEtas(harness.context, 'reference,requested_for\nM-2025-0001,2025-04-04T09:00Z\n');
    const movement = findMovement(harness.temp.db, 'M-2025-0001')!;
    expect(movement.plannedFor).toBeUndefined();
    expect(movement.status).toBe('ordered');
  });

  it('refuse the whole file for one bad row', () => {
    harness = testContext();
    importOrders(harness.context, ORDERS);
    const before = findMovement(harness.temp.db, 'M-2025-0001')?.requestedFor;
    expect(() =>
      importEtas(
        harness!.context,
        'reference,requested_for\nM-2025-0001,2025-04-04T09:00Z\nM-2025-9999,2025-04-04T09:00Z\n',
      ),
    ).toThrow(/no movement with reference/);
    expect(findMovement(harness.temp.db, 'M-2025-0001')?.requestedFor).toBe(before);
  });
});

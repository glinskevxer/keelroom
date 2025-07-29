import { afterEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../src/util/errors';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import type { Vessel } from '../../../src/domain/vessel/vessel';
import { makeAccount, withStop } from '../../../src/domain/billing/account';
import { migrate } from '../../../src/storage/migrate';
import {
  allAccounts,
  allVessels,
  deleteVessel,
  findAccount,
  findVessel,
  requireAccount,
  requireVessel,
  saveAccount,
  saveVessel,
  stoppedAccounts,
  vesselsNamed,
} from '../../../src/storage/fleet-store';
import { temporaryDatabase } from '../../support/database';
import type { TempDatabase } from '../../support/database';

let temp: TempDatabase | undefined;

afterEach(() => {
  temp?.close();
  temp = undefined;
});

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
    deadweight: 76000,
    bowThruster: true,
    ...overrides,
  });
}

function ready(): TempDatabase {
  temp = temporaryDatabase();
  migrate(temp.db);
  return temp;
}

describe('ships', () => {
  it('come back exactly as they went in', () => {
    const one = ready();
    saveVessel(one.db, vessel());
    expect(findVessel(one.db, '9074729')).toEqual(vessel());
  });

  it('keep the thruster flag through the round trip', () => {
    const one = ready();
    saveVessel(one.db, vessel({ bowThruster: false }));
    expect(findVessel(one.db, '9074729')?.bowThruster).toBe(false);
    saveVessel(one.db, vessel({ bowThruster: true }));
    expect(findVessel(one.db, '9074729')?.bowThruster).toBe(true);
  });

  it('update rather than duplicate on a second save', () => {
    const one = ready();
    saveVessel(one.db, vessel());
    saveVessel(one.db, vessel({ summerDraught: 1200 }));
    expect(allVessels(one.db)).toHaveLength(1);
    expect(findVessel(one.db, '9074729')?.summerDraught).toBe(1200);
  });

  it('give nothing for a ship nobody has', () => {
    const one = ready();
    expect(findVessel(one.db, '9074720')).toBeUndefined();
    expect(() => requireVessel(one.db, '9074720')).toThrow(NotFoundError);
  });

  it('search by the start of the name', () => {
    const one = ready();
    saveVessel(one.db, vessel());
    saveVessel(one.db, vessel({ imo: '9319466', name: 'atlantic dawn' }));
    saveVessel(one.db, vessel({ imo: '9074705', name: 'bay trader' }));
    expect(vesselsNamed(one.db, 'atlantic').map((ship) => ship.name)).toEqual([
      'ATLANTIC CROWN',
      'ATLANTIC DAWN',
    ]);
    expect(vesselsNamed(one.db, 'zz')).toEqual([]);
  });

  it('list in name order', () => {
    const one = ready();
    saveVessel(one.db, vessel({ imo: '9074705', name: 'bay trader' }));
    saveVessel(one.db, vessel());
    expect(allVessels(one.db).map((ship) => ship.name)).toEqual(['ATLANTIC CROWN', 'BAY TRADER']);
  });

  it('delete and say whether anything went', () => {
    const one = ready();
    saveVessel(one.db, vessel());
    expect(deleteVessel(one.db, '9074729')).toBe(true);
    expect(deleteVessel(one.db, '9074729')).toBe(false);
    expect(allVessels(one.db)).toEqual([]);
  });
});

describe('accounts', () => {
  const account = makeAccount({
    agent: 'SEAWAY',
    name: 'Seaway Shipping Agencies',
    termsDays: 45,
    discount: 750,
    creditLimit: 5000000,
  });

  it('come back exactly as they went in', () => {
    const one = ready();
    saveAccount(one.db, account);
    expect(findAccount(one.db, 'SEAWAY')).toEqual(account);
  });

  it('update on a second save', () => {
    const one = ready();
    saveAccount(one.db, account);
    saveAccount(one.db, withStop(account, true));
    expect(findAccount(one.db, 'SEAWAY')?.stopped).toBe(true);
    expect(allAccounts(one.db)).toHaveLength(1);
  });

  it('give nothing for an agent nobody has', () => {
    const one = ready();
    expect(findAccount(one.db, 'NOBODY')).toBeUndefined();
    expect(() => requireAccount(one.db, 'NOBODY')).toThrow(/no account with reference/);
  });

  it('list the stopped ones', () => {
    const one = ready();
    saveAccount(one.db, account);
    saveAccount(one.db, withStop(makeAccount({ agent: 'NORTH', name: 'Northern' }), true));
    expect(stoppedAccounts(one.db).map((held) => held.agent)).toEqual(['NORTH']);
  });
});

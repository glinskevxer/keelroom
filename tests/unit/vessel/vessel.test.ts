import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import type { Vessel } from '../../../src/domain/vessel/vessel';
import {
  carriesDangerousCargo,
  describeVessel,
  displacement,
  makeVessel,
  pilotageUnits,
  sizeClass,
  slenderness,
  unitsAtDraught,
} from '../../../src/domain/vessel/vessel';

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
    ...overrides,
  });
}

describe('building a vessel', () => {
  it('normalises the name and the imo number', () => {
    const ship = vessel();
    expect(ship.name).toBe('ATLANTIC CROWN');
    expect(ship.imo).toBe('9074729');
  });

  it('takes the default block coefficient for the type', () => {
    expect(vessel().blockCoefficient).toBe(830);
    expect(vessel({ type: 'container' }).blockCoefficient).toBe(680);
    expect(vessel({ blockCoefficient: 795 }).blockCoefficient).toBe(795);
  });

  it('defaults the thruster and the deadweight', () => {
    const ship = makeVessel({
      imo: '9074729',
      name: 'x',
      type: 'general',
      length: 10000,
      beam: 1600,
      summerDraught: 700,
      airDraught: 3000,
      grossTonnage: 5000,
    });
    expect(ship.bowThruster).toBe(false);
    expect(ship.deadweight).toBe(0);
  });

  it('refuses a ship that could not exist', () => {
    expect(() => vessel({ name: '  ' })).toThrow(/has no name/);
    expect(() => vessel({ length: 0 })).toThrow(/dimension of zero/);
    expect(() => vessel({ beam: 30000 })).toThrow(/wider than she is long/);
    expect(() => vessel({ summerDraught: 30000 })).toThrow(/deeper than she is long/);
    expect(() => vessel({ grossTonnage: 0 })).toThrow(/no gross tonnage/);
    expect(() => vessel({ deadweight: -1 })).toThrow(/impossible deadweight/);
    expect(() => vessel({ blockCoefficient: 1200 })).toThrow(/outside anything that floats/);
    expect(() => vessel({ summerDraught: 11.5 })).toThrow(/whole centimetres/);
  });

  it('refuses a bad imo number', () => {
    expect(() => vessel({ imo: '9074720' })).toThrow(InputError);
  });
});

describe('measuring a vessel', () => {
  const ship = vessel();

  it('computes pilotage units from the three dimensions', () => {
    expect(pilotageUnits(ship)).toBe(855);
  });

  it('never gives less than one unit', () => {
    const launch = vessel({ length: 1500, beam: 400, summerDraught: 120 });
    expect(pilotageUnits(launch)).toBeGreaterThanOrEqual(1);
  });

  it('scales the units with a declared draught', () => {
    expect(unitsAtDraught(ship, 1180)).toBe(pilotageUnits(ship));
    expect(unitsAtDraught(ship, 590)).toBe(427);
    expect(() => unitsAtDraught(ship, 0)).toThrow(/not a draught/);
  });

  it('estimates displacement from the block coefficient', () => {
    expect(displacement(ship)).toBe(72731);
    expect(displacement(ship, 590)).toBeLessThan(displacement(ship));
  });

  it('reads slenderness in hundredths', () => {
    expect(slenderness(ship)).toBe(699);
  });

  it('bands the size', () => {
    expect(sizeClass(vessel({ length: 6000, beam: 1000, summerDraught: 400 }))).toBe('small');
    expect(sizeClass(vessel({ length: 10000, beam: 1600, summerDraught: 500 }))).toBe('handy');
    expect(sizeClass(vessel({ length: 12000, beam: 1800, summerDraught: 600 }))).toBe('panamax');
    expect(sizeClass(vessel({ length: 16000, beam: 2500, summerDraught: 700 }))).toBe('large');
    expect(sizeClass(vessel({ length: 22500, beam: 3220, summerDraught: 1180 }))).toBe(
      'very-large',
    );
  });

  it('knows which types carry dangerous cargo', () => {
    expect(carriesDangerousCargo(vessel({ type: 'tanker' }))).toBe(true);
    expect(carriesDangerousCargo(vessel({ type: 'gas' }))).toBe(true);
    expect(carriesDangerousCargo(vessel({ type: 'bulk' }))).toBe(false);
  });

  it('describes itself in one line', () => {
    expect(describeVessel(ship)).toBe('ATLANTIC CROWN (9074729), bulk, 225 m by 32.2 m, 855 units');
  });
});

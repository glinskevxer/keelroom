import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../../src/util/clock';
import {
  couldShare,
  describeGround,
  makeBoat,
  makeGround,
  planBoarding,
  tripPeriod,
  tripsFor,
} from '../../../src/domain/boat/boarding';
import type { Trip } from '../../../src/domain/boat/boarding';

const T = parseInstant('2025-04-03T06:00Z');

const GROUND = makeGround({
  id: 'SEA-BUOY',
  name: 'Sea Buoy',
  passageMinutes: 25,
  swellLimit: 200,
});

const BOAT = makeBoat({ id: 'B1', name: 'Narrows Pilot', swellLimit: 250, berths: 2 });

function request(
  overrides: Partial<Parameters<typeof planBoarding>[0]> = {},
): Parameters<typeof planBoarding>[0] {
  return {
    movement: 'M-2025-0001',
    pilot: 'P02',
    boat: BOAT,
    ground: GROUND,
    boards: T,
    swell: 80,
    night: false,
    booked: [],
    ...overrides,
  };
}

describe('the grounds and the boats', () => {
  it('keep what they were given', () => {
    expect(GROUND.nightBoarding).toBe(true);
    expect(BOAT.berths).toBe(2);
    expect(describeGround(GROUND)).toBe('SEA-BUOY Sea Buoy, 25 min out, 200 cm limit');
  });

  it('refuse what is not one', () => {
    expect(() =>
      makeGround({ id: 'buoy', name: 'x', passageMinutes: 10, swellLimit: 100 }),
    ).toThrow(/upper case/);
    expect(() =>
      makeGround({ id: 'BUOY', name: ' ', passageMinutes: 10, swellLimit: 100 }),
    ).toThrow(/has no name/);
    expect(() => makeGround({ id: 'BUOY', name: 'x', passageMinutes: 0, swellLimit: 100 })).toThrow(
      /no distance/,
    );
    expect(() => makeGround({ id: 'BUOY', name: 'x', passageMinutes: 10, swellLimit: 0 })).toThrow(
      /never be workable/,
    );
    expect(() => makeBoat({ id: 'boat', name: 'x', swellLimit: 100 })).toThrow(/look like B1/);
    expect(() => makeBoat({ id: 'B1', name: 'x', swellLimit: 100, berths: 0 })).toThrow(
      /carries nobody/,
    );
    expect(() => makeBoat({ id: 'B1', name: 'x', swellLimit: 1.5 })).toThrow(/whole centimetres/);
  });
});

describe('planning a trip', () => {
  it('works the launch backwards from the boarding time', () => {
    const offer = planBoarding(request());
    expect(offer.trip?.departs).toBe(T - 25);
    expect(offer.trip?.boards).toBe(T);
    expect(offer.trip?.returns).toBe(T + 25);
    expect(tripPeriod(offer.trip!)).toEqual({ from: T - 25, to: T + 25 });
  });

  it('refuses a swell over the tighter of the two limits', () => {
    const offer = planBoarding(request({ swell: 220 }));
    expect(offer.refusal).toBe('swell');
    expect(offer.detail).toContain('limit of 200 cm');
  });

  it('takes the boat limit when it is the tighter one', () => {
    const small = makeBoat({ id: 'B2', name: 'Small', swellLimit: 120 });
    expect(planBoarding(request({ boat: small, swell: 150 })).refusal).toBe('swell');
  });

  it('refuses a night boarding at a ground that does not take one', () => {
    const exposed = makeGround({
      id: 'OUTER',
      name: 'Outer',
      passageMinutes: 40,
      swellLimit: 300,
      nightBoarding: false,
    });
    expect(planBoarding(request({ ground: exposed, night: true })).refusal).toBe('night');
    expect(planBoarding(request({ ground: exposed, night: false })).refusal).toBeUndefined();
  });

  it('refuses a boat that is laid up', () => {
    const laid = makeBoat({ id: 'B3', name: 'Spare', swellLimit: 200, active: false });
    expect(planBoarding(request({ boat: laid })).refusal).toBe('boat-laid-up');
  });

  it('refuses a boat that is already out', () => {
    const booked: Trip[] = [
      {
        boat: 'B1',
        ground: 'SEA-BUOY',
        movement: 'M-2025-0002',
        pilot: 'P07',
        departs: T - 30,
        boards: T - 5,
        returns: T + 20,
      },
    ];
    const offer = planBoarding(request({ booked }));
    expect(offer.refusal).toBe('boat-busy');
    expect(offer.detail).toContain('M-2025-0002');
  });

  it('lets another boat take her instead', () => {
    const booked: Trip[] = [
      {
        boat: 'B1',
        ground: 'SEA-BUOY',
        movement: 'M-2025-0002',
        pilot: 'P07',
        departs: T - 30,
        boards: T - 5,
        returns: T + 20,
      },
    ];
    const spare = makeBoat({ id: 'B2', name: 'Second', swellLimit: 250 });
    expect(planBoarding(request({ booked, boat: spare })).refusal).toBeUndefined();
  });
});

describe('sharing a trip', () => {
  const first = planBoarding(request()).trip!;
  const second = planBoarding(
    request({ movement: 'M-2025-0003', pilot: 'P07', boards: T + 10 }),
  ).trip!;

  it('runs two pilots out together when the times are close', () => {
    expect(couldShare(first, second, BOAT)).toBe(true);
  });

  it('will not share when the times are far apart', () => {
    const late = planBoarding(request({ boards: T + 200 })).trip!;
    expect(couldShare(first, late, BOAT)).toBe(false);
  });

  it('will not share a boat with one berth', () => {
    const single = makeBoat({ id: 'B4', name: 'Single', swellLimit: 250, berths: 1 });
    expect(couldShare(first, second, single)).toBe(false);
  });

  it('lists the trips one boat has', () => {
    expect(tripsFor([first, second], 'B1')).toHaveLength(2);
    expect(tripsFor([first, second], 'B2')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import type { Vessel } from '../../../src/domain/vessel/vessel';
import {
  barrassSquat,
  blockageFactor,
  computeSquat,
  fastestSpeedWithin,
  millwardSquat,
} from '../../../src/domain/vessel/squat';

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

const OPEN = {
  vessel: SHIP,
  draught: 1180,
  depth: 2000,
  width: 400,
  channel: 'open' as const,
};

const CUT = {
  vessel: SHIP,
  draught: 1180,
  depth: 1400,
  width: 180,
  channel: 'restricted' as const,
};

describe('blockage', () => {
  it('reads the hull against the channel cross section', () => {
    expect(blockageFactor({ ...OPEN, speed: 100 })).toBe(47);
    expect(blockageFactor({ ...CUT, speed: 100 })).toBe(151);
  });

  it('grows as the channel narrows and shallows', () => {
    const narrow = blockageFactor({ ...CUT, width: 120, speed: 100 });
    expect(narrow).toBeGreaterThan(blockageFactor({ ...CUT, speed: 100 }));
  });

  it('refuses a channel with no cross section', () => {
    expect(() => blockageFactor({ ...CUT, depth: 0, speed: 100 })).toThrow(InputError);
  });
});

describe('barrass', () => {
  it('grows faster than linearly with speed', () => {
    const slow = barrassSquat({ ...CUT, speed: 60 });
    const fast = barrassSquat({ ...CUT, speed: 120 });
    expect(fast / slow).toBeGreaterThan(2);
    expect(fast / slow).toBeLessThan(5);
  });

  it('reads a confined channel worse than an open one', () => {
    const confined = barrassSquat({ ...OPEN, channel: 'canal', speed: 100 });
    const open = barrassSquat({ ...OPEN, speed: 100 });
    expect(confined).toBeGreaterThanOrEqual(open);
    expect(barrassSquat({ ...CUT, speed: 100 })).toBeGreaterThan(open);
  });

  it('gives a realistic squat for a loaded bulker at ten knots', () => {
    expect(barrassSquat({ ...OPEN, speed: 100 })).toBeCloseTo(0.83, 2);
    expect(barrassSquat({ ...CUT, speed: 100 })).toBeCloseTo(1.079, 2);
  });

  it('treats a blocked open reach as confined anyway', () => {
    const blocked = barrassSquat({ ...OPEN, width: 90, speed: 100 });
    const clear = barrassSquat({ ...OPEN, speed: 100 });
    expect(blocked).toBeGreaterThan(clear);
  });

  it('refuses a ship that is not moving', () => {
    expect(() => barrassSquat({ ...CUT, speed: 0 })).toThrow(/not moving/);
  });
});

describe('millward', () => {
  it('grows with speed and with shallower water', () => {
    const deep = millwardSquat({ ...CUT, depth: 1600, speed: 100 });
    const shallow = millwardSquat({ ...CUT, depth: 1300, speed: 100 });
    expect(shallow).toBeGreaterThan(deep);
  });

  it('refuses a froude number outside the formula', () => {
    expect(() => millwardSquat({ ...CUT, depth: 1300, speed: 250 })).toThrow(/froude depth number/);
    expect(() => millwardSquat({ ...CUT, speed: 0 })).toThrow(/not moving/);
    expect(() => millwardSquat({ ...CUT, depth: 0, speed: 100 })).toThrow(InputError);
  });
});

describe('choosing a method', () => {
  it('takes barrass alone where the channel is open enough', () => {
    const result = computeSquat({ ...OPEN, speed: 100 });
    expect(result.method).toBe('barrass');
    expect(result.blockage).toBeLessThan(200);
  });

  it('takes the worse of the two where the hull blocks a fifth of the channel', () => {
    const blocked = { ...CUT, width: 100, depth: 1600 };
    const result = computeSquat({ ...blocked, speed: 100 });
    expect(result.blockage).toBeGreaterThanOrEqual(200);
    const barrass = barrassSquat({ ...blocked, speed: 100 }) * 100;
    const millward = millwardSquat({ ...blocked, speed: 100 }) * 100;
    expect(result.rawSquat).toBeCloseTo(Math.max(barrass, millward), 6);
  });

  it('takes the worse of the two in shallow water however wide the channel', () => {
    const shallow = { ...CUT, width: 300, depth: 1250, channel: 'restricted' as const };
    const result = computeSquat({ ...shallow, speed: 120 });
    expect(result.blockage).toBeLessThan(200);
    expect(result.method).toBe('millward');
    expect(result.rawSquat).toBeGreaterThan(barrassSquat({ ...shallow, speed: 120 }) * 100);
  });

  it('honours a method that was asked for by name', () => {
    const barrass = computeSquat({ ...CUT, speed: 100 }, 'barrass');
    const millward = computeSquat({ ...CUT, speed: 100 }, 'millward');
    expect(barrass.method).toBe('barrass');
    expect(millward.method).toBe('millward');
    expect(barrass.squat).not.toBe(millward.squat);
  });

  it('rounds to whole centimetres and never credits less than five', () => {
    const crawl = computeSquat({ ...OPEN, speed: 10 });
    expect(crawl.squat).toBe(5);
    expect(Number.isInteger(computeSquat({ ...CUT, speed: 100 }).squat)).toBe(true);
  });
});

describe('working backwards to a speed', () => {
  it('finds the fastest speed inside a squat limit', () => {
    const speed = fastestSpeedWithin(CUT, 40, 140)!;
    expect(computeSquat({ ...CUT, speed }).squat).toBeLessThanOrEqual(40);
    expect(computeSquat({ ...CUT, speed: speed + 1 }).squat).toBeGreaterThan(40);
  });

  it('gives the ceiling when even that is inside the limit', () => {
    expect(fastestSpeedWithin(CUT, 500, 120)).toBe(120);
  });

  it('gives nothing when no speed will do', () => {
    expect(fastestSpeedWithin(CUT, 1, 140)).toBeUndefined();
  });

  it('refuses a ceiling that is not whole tenths of a knot', () => {
    expect(() => fastestSpeedWithin(CUT, 40, 0)).toThrow(/whole tenths/);
  });
});

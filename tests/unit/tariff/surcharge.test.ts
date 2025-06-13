import { describe, expect, it } from 'vitest';
import { parseLocal } from '../../../src/util/clock';
import { InputError } from '../../../src/util/errors';
import { makeVessel } from '../../../src/domain/vessel/vessel';
import type { Vessel } from '../../../src/domain/vessel/vessel';
import { makeCalendar } from '../../../src/domain/tariff/calendar';
import {
  assessSurcharges,
  makeSurchargeRules,
  periodSurcharge,
  STANDARD_SURCHARGES,
  surchargeChangesAt,
  totalRate,
} from '../../../src/domain/tariff/surcharge';
import type { SurchargeContext } from '../../../src/domain/tariff/surcharge';

const OFFSET = -240;
const CAL = makeCalendar({ holidays: ['2025-07-01'] });
const at = (text: string): number => parseLocal(text, OFFSET);
const BASE = 200000;

function vessel(overrides: Partial<Parameters<typeof makeVessel>[0]> = {}): Vessel {
  return makeVessel({
    imo: '9074729',
    name: 'atlantic crown',
    type: 'bulk',
    length: 22500,
    beam: 3220,
    summerDraught: 1250,
    airDraught: 4200,
    grossTonnage: 43000,
    ...overrides,
  });
}

function context(overrides: Partial<SurchargeContext> = {}): SurchargeContext {
  return {
    vessel: vessel(),
    draught: 1100,
    at: at('2025-05-07T14:00'),
    offset: OFFSET,
    calendar: CAL,
    noticeHours: 48,
    ...overrides,
  };
}

describe('the rules', () => {
  it('start from the standard ones', () => {
    expect(makeSurchargeRules().night).toBe(STANDARD_SURCHARGES.night);
    expect(makeSurchargeRules({ night: 3000 }).night).toBe(3000);
  });

  it('refuse anything that is not a whole rate', () => {
    expect(() => makeSurchargeRules({ night: -1 })).toThrow(InputError);
    expect(() => makeSurchargeRules({ night: 1.5 })).toThrow(/whole number/);
    expect(() => makeSurchargeRules({ holiday: 30000 })).toThrow(/not a surcharge/);
  });
});

describe('the period surcharge', () => {
  it('charges nothing on a weekday afternoon', () => {
    expect(periodSurcharge(STANDARD_SURCHARGES, context()).rate).toBe(0);
    expect(assessSurcharges(STANDARD_SURCHARGES, BASE, context())).toEqual([]);
  });

  it('charges the night rate in the small hours', () => {
    const lines = assessSurcharges(
      STANDARD_SURCHARGES,
      BASE,
      context({ at: at('2025-05-07T02:00') }),
    );
    expect(lines[0]?.code).toBe('NIGHT');
    expect(lines[0]?.amount).toBe(50000);
  });

  it('charges only the dearest when the night falls at a weekend', () => {
    const lines = assessSurcharges(
      STANDARD_SURCHARGES,
      BASE,
      context({ at: at('2025-05-10T02:00') }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.code).toBe('WEEKEND');
    expect(lines[0]?.amount).toBe(60000);
  });

  it('charges the holiday rate over both', () => {
    const lines = assessSurcharges(
      STANDARD_SURCHARGES,
      BASE,
      context({ at: at('2025-07-01T02:00') }),
    );
    expect(lines[0]?.code).toBe('HOLIDAY');
    expect(lines[0]?.amount).toBe(100000);
  });

  it('says when moving the job would change the rate', () => {
    const evening = context({ at: at('2025-05-07T17:30') });
    expect(surchargeChangesAt(STANDARD_SURCHARGES, evening, at('2025-05-07T18:30'))).toBe(true);
    expect(surchargeChangesAt(STANDARD_SURCHARGES, evening, at('2025-05-07T17:45'))).toBe(false);
  });
});

describe('the surcharges that stack', () => {
  it('charges deep draught over the threshold', () => {
    const lines = assessSurcharges(STANDARD_SURCHARGES, BASE, context({ draught: 1200 }));
    expect(lines.map((line) => line.code)).toEqual(['DEEP']);
    expect(lines[0]?.amount).toBe(30000);
  });

  it('does not charge it at the threshold itself', () => {
    expect(assessSurcharges(STANDARD_SURCHARGES, BASE, context({ draught: 1150 }))).toEqual([]);
  });

  it('charges dangerous cargo', () => {
    const lines = assessSurcharges(
      STANDARD_SURCHARGES,
      BASE,
      context({ vessel: vessel({ type: 'gas' }) }),
    );
    expect(lines.map((line) => line.code)).toEqual(['HAZARD']);
  });

  it('charges a dead ship the most of any of them', () => {
    const lines = assessSurcharges(STANDARD_SURCHARGES, BASE, context({ deadShip: true }));
    expect(lines[0]?.code).toBe('DEADSHIP');
    expect(lines[0]?.amount).toBe(200000);
  });

  it('charges short notice', () => {
    const lines = assessSurcharges(STANDARD_SURCHARGES, BASE, context({ noticeHours: 6 }));
    expect(lines.map((line) => line.code)).toEqual(['SHORTNOTICE']);
  });

  it('adds them all against the same base rather than compounding', () => {
    const heavy = context({
      at: at('2025-07-01T02:00'),
      draught: 1300,
      vessel: vessel({ type: 'tanker' }),
      noticeHours: 4,
    });
    const lines = assessSurcharges(STANDARD_SURCHARGES, BASE, heavy);
    expect(lines.map((line) => line.code)).toEqual(['HOLIDAY', 'DEEP', 'HAZARD', 'SHORTNOTICE']);
    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    expect(total).toBe(100000 + 30000 + 40000 + 50000);
    expect(totalRate(STANDARD_SURCHARGES, heavy)).toBe(5000 + 1500 + 2000 + 2500);
  });

  it('leaves out a surcharge the district has set to nothing', () => {
    const rules = makeSurchargeRules({ deep: 0, dangerous: 0 });
    const lines = assessSurcharges(
      rules,
      BASE,
      context({ draught: 1300, vessel: vessel({ type: 'gas' }) }),
    );
    expect(lines).toEqual([]);
  });
});

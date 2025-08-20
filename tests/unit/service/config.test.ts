import { describe, expect, it } from 'vitest';
import { InputError } from '../../../src/util/errors';
import { STANDARD_POLICY } from '../../../src/domain/ukc/policy';
import { STANDARD_REST } from '../../../src/domain/roster/duty';
import { defaultConfig, parseConfig, parseConfigText } from '../../../src/service/config';

describe('the defaults', () => {
  it('need only the district code', () => {
    const config = defaultConfig('KLR');
    expect(config.district).toBe('KLR');
    expect(config.databasePath).toBe('district.sqlite');
    expect(config.clearance).toEqual(STANDARD_POLICY);
    expect(config.rest).toEqual(STANDARD_REST);
  });

  it('carry the standing orders and the standard tariff rules', () => {
    const config = defaultConfig('KLR');
    expect(config.restrictions.tugsAvailable).toBeGreaterThan(0);
    expect(config.surcharges.night).toBeGreaterThan(0);
    expect(config.penalties.steps.length).toBeGreaterThan(0);
    expect(config.calendar.weekendDays).toEqual([5, 6]);
  });
});

describe('overriding', () => {
  it('takes one setting and leaves the rest alone', () => {
    const config = parseConfig({ district: 'KLR', clearance: { minimumNet: 90 } });
    expect(config.clearance.minimumNet).toBe(90);
    expect(config.clearance.percentOfDraught).toBe(STANDARD_POLICY.percentOfDraught);
  });

  it('takes the whole cancellation scale', () => {
    const config = parseConfig({
      district: 'KLR',
      penalties: {
        steps: [
          { noticeHours: 12, rate: 0 },
          { noticeHours: 0, rate: 10000 },
        ],
      },
    });
    expect(config.penalties.steps).toHaveLength(2);
  });

  it('takes holidays and the night hours', () => {
    const config = parseConfig({
      district: 'KLR',
      calendar: { holidays: ['2025-07-01'], nightFrom: 1200, nightTo: 300 },
    });
    expect(config.calendar.holidays).toEqual(['2025-07-01']);
    expect(config.calendar.nightFrom).toBe(1200);
  });
});

describe('refusing bad settings', () => {
  it('needs a district code that is one', () => {
    expect(() => parseConfig({})).toThrow(InputError);
    expect(() => parseConfig({ district: 'klr' })).toThrow(/not valid/);
  });

  it('refuses a setting nobody knows', () => {
    expect(() => parseConfig({ district: 'KLR', nonsense: true })).toThrow(/not valid/);
    expect(() => parseConfig({ district: 'KLR', clearance: { nonsense: 1 } })).toThrow(InputError);
  });

  it('refuses a number that should be whole', () => {
    expect(() => parseConfig({ district: 'KLR', clearance: { minimumNet: 12.5 } })).toThrow(
      /not valid/,
    );
    expect(() => parseConfig({ district: 'KLR', transitSpeed: 0 })).toThrow(InputError);
  });

  it('refuses a rate outside its range', () => {
    expect(() => parseConfig({ district: 'KLR', taxRate: 9000 })).toThrow(InputError);
    expect(() => parseConfig({ district: 'KLR', penalties: { afterBoarding: 20000 } })).toThrow(
      InputError,
    );
  });

  it('names the setting that was wrong', () => {
    expect(() => parseConfig({ district: 'KLR', calendar: { nightFrom: 2000 } })).toThrow(
      /calendar.nightFrom/,
    );
  });

  it('refuses a holiday that is not a date', () => {
    expect(() => parseConfig({ district: 'KLR', calendar: { holidays: ['christmas'] } })).toThrow(
      InputError,
    );
  });
});

describe('reading a file', () => {
  it('parses json', () => {
    const config = parseConfigText('{"district":"KLR","transitSpeed":100}');
    expect(config.transitSpeed).toBe(100);
  });

  it('says which file was not json', () => {
    expect(() => parseConfigText('{oops', 'keelroom.json')).toThrow(/keelroom.json is not json/);
  });
});
